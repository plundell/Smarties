'use strict';
//simpleSourceMap=/my_modules/smart.class.js
//simpleSourceMap2=/lib/smart.class.js
/*
* @module smarties
* @author plundell
* @license Apache-2.0 
* @description Create objects and arrays that are 'smart'. Mainly they emit when you change something on them, 
*              but they can also control what is set on them, as well as return to previous states.
*
* @depends libbetter {BetterLog,BetterEvents,BetterUtil}
*
* @exports {function} Call this function with an object containing the dependencies. It returns an object with props: 
*                        Object, Array, isSmart, create, autoLinkUniSoc. 
* @protip: ctrl+f '@exported' to see the definitions of the exported. 
* @protip: In the browser you can load this file after its dependency 'libbetter' to automatically initialize it on 
*          the window, like so:
*                <script src="path/to/libbetter.js">
*                <script src="path/to/smarties.js">
*      
*/



(function(){
    
    //Export if possible
    if(typeof module==='object' && module.exports){
        module.exports = exportSmarties
    }

	//Set on window if it exists and hasn't already been set
    if(typeof window=='object' && window && !window.Smarties){

	    //Create a getter on the window which runs the exporter as soon as all dependencies are
	    //available OR throws a clear error if we try to access it too early
	    Object.defineProperty(window,'Smarties',{enumerable:true, configurable:true
	    	,get:()=>{
	    		if(window.BetterLog && window.BetterEvents && window.BetterUtil){ 
	    			return window.Smarties=exportSmarties(window);
	    		}else{
	    			throw new Error("E_DEPENDENCY. Smarties depends on libbetter which should be set on the window.");
	    		}
	    	}
	    	//This setter allows^ the whole thing to easily be undone/overwritten
	    	,set:(val)=>{
	    		Object.defineProperty(window,'Smarties',{value:val,enumerable:true,writable:true,configurable:true}); 
	    		return val;
	    	} 
	    })
    }
   

	function exportSmarties(dep={}){
		
		function missingDependency(which){throw new Error("Missing dependency for smarties.js: "+which);}
		const BetterLog = dep.BetterLog        || missingDependency('BetterLog');
		const BetterEvents = dep.BetterEvents  || missingDependency('BetterEvents');
		const BetterUtil = dep.BetterUtil      || missingDependency('BetterUtil');
		const cX=(BetterUtil.cX ? BetterUtil.cX : BetterUtil);
// console.log('AAAAAAAAAAAAAAAAAAAAAAA');
// console.log(BetterEvents);

		//A token passed around internally to tell a function not to log it's actions (because the calling function 
		//has already done so)
		const NO_LOG_TOKEN={}


		/*
		* @return string|undefined  	'SmartArray' or 'SmartObject' if it is, else undefined
		* @exported
		*/
		function isSmart(x){
			x=x||this;
			if(x && typeof x=='object'){
				while(x.__proto__){
					x=x.__proto__;
					if(x.constructor.name=='SmartObject')
						return 'SmartObject'
					else if(x.constructor.name=='SmartArray')
						return 'SmartArray';
				}
			}
			return undefined
		}

		/********************************* SmartProto (not exported) **************************/


		SmartProto.defaultOptions={
		//Used by SmartProto
			defaultValues:null 	//Default values which are set by .reset() (which is called by constructor). Will be ignored if
								  //$meta is passed
			,meta:null 			//An object, if passed when creating an object it will run .init() at the end of the constructor. 
								  //Keys are default keys created by constructor, values are rules about that prop
			,onlyMeta:false 	//If true, only keys from $meta are allowed

			,constantType:false //If true, when a key is set, it can only be changed to the same type or deleted

			,delayedSnapshot:0 	  //If set to number>0, a copy of all the data on the object will be emitted that many ms after 
								  //any event
			,children:'primitive' //accepted 'complex'=> allow obj/arr children (they should not be smart), 'smart'=> children 
								  //may be smart (either passed in or converted when setting) and their events extended 
								  //('new'/'delete' on child becomes 'change' on parent). Alternatively you can pass 'string',
								  //'number' or 'boolean' to limit primitive children further
			
			,addGetters:true    //if true, enumerable getters and setters will be added/removed when keys are set/deleted

			,assignmentWarn:true //Default true => if you write props directly on smarty without using .set(), warn! Use a number
								 //to have a check be performed on an interval 

			,getLive:false      //if true, get() will return a 'live' value (only relevant if children=complex)

		//Used if sending the smarty over a uniSoc, truthy => send/receive
			,Tx:undefined 	//local changes will be sent over uniSoc if this prop is set
			,Rx:undefined   //changes coming from the other side of a uniSoc will be applied to the local object

	//TODO 2020-02-27: We probably want to disable .set() if a linked object is created where we only
	//					receive changes... otherwise the two objects can become out-of-sync which at
	//					worst will cause an error when replicating a change (will only happen after
	//					we've implemented our other TODO which calls for replicating nested changes)
			
			,bubbleType:'local' /*What type of events are propogated when bubbled from a smart child? Allowed values are:
									'local' - Default. Events reflect what happened to the local smarty, ie. if a child smarty
									 		  gets a new key then this smarty will emit
									 				{evt:'change',key:local,value:child}
									'nested' - Events try to be as precise as possible, only appending the local key to the
											   array childs key. This may be more efficient when changing single details
											   on nested smarties (especially when linking smarties via uniSoc)
											   		{evt:'new',key:nested, value:nested}
								*/
			,valueLookup:false 	//Checking if an object/array has a value can be very slow. By setting this to true a second
								//private data is created and kept in sync with the original, but keys and values are reversed
								//2020-03-21: Not started implementing

			,debounce:0 	//If >0, .set() will be delayed by that many ms, and any additional calls during that time will
							//push the delay further and .set() will only be called with the last value.

			,throttle:0 	//If >0, .set() will ignore calls for this many ms after a call. NOTE: The last value will still be
							//set after the timeout


		};




		/*
		* @constructor SmartProto 	Prototype for several objects in this folder
		*/
		function SmartProto(_options){	

			//Combine default options
			var options=Object.assign({},SmartProto.defaultOptions,this.constructor.defaultOptions,_options); 

			//Grab the options relating to BetterEvents and call that constructor (to setup inheritence)
			let beOptions=cX.subObj(options,Object.keys(BetterEvents.defaultOptions),'excludeMissing');
			BetterEvents.call(this,beOptions);


			//Set private variable that holds everything we need to access in various prototype methods, 
			//without making it enumerable so it doesn't show up when logging
			Object.defineProperty(this,'_private',{enumerable:false,value:{ 
				data:(this.isSmart=='SmartObject' ? {} : [])					
				,options:options
			}}); 


			//Setup log, passing along the options ^^
			let logOptions=cX.subObj(options,Object.keys(BetterLog.defaultOptions),'excludeMissing');
			// console.log({options,logOptions})
			let log=new BetterLog(this,logOptions);
			Object.defineProperty(this,'_log',{enumerable:false,value:log});
			this._log.makeEntry('trace',`Creating smarty '${this._log.name}'`,_options).changeWhere(2).exec();
			this._betterEvents.onerror=log.error;



			//Add snapshot if opted
			let d=this._private.options.delayedSnapshot;
			if(typeof d=='number' && d>0){
				this.setupSnapshot(d);
			}else if(d!==0){
				this._log.warn("Bad value for option 'delayedSnapshot':",d,this);
			}



			//Prepare for different children types
			switch(this._private.options.children){
				case 'string':
				case 'number':
				case 'boolean':
				case 'primitive':
					this._private.expectedTypes=[['string','number'],this._private.options.children];
					this._private.options.children='primitive';
					break;
				case 'smart':
					this._private.childListeners=new Map();
					this._private.deleteSmartChild=deleteSmartChild.bind(this)
					//no break
				case 'complex':
				case 'any':
					this._private.expectedTypes=[['string','number','array'],['primitive','array','object']];
					if(this._private.options.children=='any')
						this._private.expectedTypes[1]='any';
					break;
				default:
					this._log.throw("BUGBUG: invalid valud for option 'children': ",this._private.options.children,this);
			}



			//"states" are pre-defined objects which can be assigned using only a keyword 
			this._private.states={}



			//If we're using a lookup table...
			if(this._private.options.valueLookup){
		//2020-03-21: Not started implementing
				//For now this only works with primitive children
				if(this._private.options.children!='primitive'){
					this._log.warn("options.valueLookup only works if options.children=='primitive'");
					this._private.options.valueLookup='illegal';
				}else{
					this._private.lookup=Map();
				}

			}


			//If we want to debounce set() for this instance all we have to do is supercede prototype.set 
			//with a debounced version on 'this'. 
			if(this._private.options.debounce){

				if(this._private.options.throttle){
					this._log.warn("You can't use both 'debounce' and 'throttle', disabling the latter");
					delete this._private.options.throttle;
				}

				Object.defineProperty(this,'set',{
					enumerable:true
					,configurable:true
					,value:cX.betterTimeout(this._private.options.debounce,this.set).debounce.bind(this)
				})
			}else if(this._private.options.throttle){
				Object.defineProperty(this,'set',{
					enumerable:true
					,configurable:true
					,value:cX.betterTimeout(this._private.options.throttle,this.set).throttle.bind(this)
				})
			}
			//REMEMBER: If you want to revert you just have to remove this.set



			//During normal circumstances chances are good that we want all enumerable props to be getters (ie. that
			//we don't intend for anyone to "accidentally" use an assignment operator for a new prop, but instead
			//use .set()), so unless told not to we check the object a few seconds after it's been created and warn 
			//if that is the case
			let a=this._private.options.assignmentWarn
			if(a){
				let stack=(new Error()).stack
				let check=()=>{
					Object.entries(Object.getOwnPropertyDescriptors(this)).forEach(([prop,desc])=>{
						if(desc.enumerable && !desc.get){
							this._log.makeEntryRaw('warn',`Prop '${prop}' was not set using .set(), ie. it will NOT be monitored.`
								,undefined,stack).exec();
						}
					})
				}
				//Allow a number to set an interval, while truthy just checks once...
				if(typeof a=='number')
					setInterval(check,a);
				else 
					setTimeout(check,3000);
			}



			//For the sake of not confusing which takes presidence, meta[key].default or defaultValues[key] we simply
			//don't allow both to be passed
			if(cX.isEmpty(this._private.options.meta))this._private.options.meta=null
			if(cX.isEmpty(this._private.options.defaultValues))this._private.options.defaultValues=null
			if(this._private.options.meta && this._private.options.defaultValues)
				this._log.makeError("You cannot set both options.meta & options.defaultValues. options:",this._private.options).throw('EINVAL')
			else if(this._private.options.meta && typeof this._private.options.meta!='object')
				this._log.throwType("options.meta to be object/array",this._private.options.meta);
			else if(this._private.options.defaultValues && typeof this._private.options.defaultValues!='object')
				this._log.throwType("options.defaultValues to be object/array",this._private.options.defaultValues);


			//If we got meta...
			if(this._private.options.meta){
				this._private.options.defaultValues={};
				
				//Get the default of defaults
				let d=this.getMeta('*');
				d=(d && d.hasOwnProperty('default')?d.default:null);

				for(let key of Object.keys(this._private.options.meta)){
					let meta=this._private.options.meta[key];
					//Set the default value on...
					this._private.options.defaultValues[key]=(meta.hasOwnProperty('default') ? meta.default : d);

					//Make sure that some props are correct/work together
						if(meta.prepend){
							if(meta.type && meta.type!='string')
								this._log.makeError("If using meta.prepend then meta.type needs to be string, not:",meta.type).throw('EMISMATCH');
							meta.type='string';
						}

						cX.checkType(['undefined','function'],meta.cleanFunc);
				}
			}

			//Now check for defaults (which may just have been set ^)
			try{
				if(this._private.options.defaultValues){
					this._log.debug('Initializing default values:',this._private.options.defaultValues);
					for(let key of Object.keys(this._private.options.defaultValues)){
						this.set(key,this._private.options.defaultValues[key]);
					  	  //^this will emit events, but since this function is run from constructor, no listeners have been added yet
					  	  //^any bad default values will make .set() throw like normal (.meta restrictions are applied by .set)
					}
				}
			}catch(err){
				this._log.makeError('Failed to init default values.',err).throw();
			}



		}
		//Inheritence step 2: 
		// 		https://developer.mozilla.org/en-US/docs/Learn/JavaScript/Objects/Inheritance
		// 		https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/create
		//  By using Oject.create() we set our constructors prototype to an empty object who's '__proto__' property is set
		//  to the parent's prototype. REMEMBER: Functions have 'prototype', everybody has '__proto__' and inheritence 
		//  happens via '__proto__' which is set on a 'new' object to equal its constructor's 'prototype'
		SmartProto.prototype=Object.create(BetterEvents.prototype); 
		Object.defineProperty(SmartProto.prototype, 'constructor', {value: SmartProto, writable: true }); //2018-12-03: they do it on mozilla, don't know why




		SmartProto.prototype.keys=function(){
			return Object.keys(this._private.data);
		}
		SmartProto.prototype.values=function(){
			if(this._private.options.children=='primitive') //for a little extra speed...
				return Object.values(this._private.data);
			else
				return Object.values(this.get()); //in order to maintain possible live children
		}	

		SmartProto.prototype.entries=function(){
			if(this._private.options.children=='primitive') //for a little extra speed...
				return Object.entries(this._private.data);
			else
				return Object.entries(this.get()); //in order to maintain possible live children
		}

		/*
		* If this object is to be serialized, only serialize the data
		*/
		SmartProto.prototype.toJSON=function(){
			return this._private.data
		}

		/*
		* The string version of a smarty is a JSON string
		*/
		SmartProto.prototype.toString=function(){
			if(!isSmart(this)){
				throw new Error('SmartProto.toString() called in wrong context. this.constructor.name: '+this.constructor.name);
			}
			return JSON.stringify(this._private.data);
		}




		SmartProto.prototype.instanceof=function(x){
			return isSmart(x)==this.constructor.name;
		}


	//2020-03-31: Needs extra work to implement, since we trust in throwing to end execution sometimes
		// SmartProto.prototype.emitOrThrow=function(err){
		// 	err=this._log.makeError(err);
		// 	//If we have a specific handler for the error code, use that
		// 	if(err.code && this.hasListener(err.code))
		// 		this.emit(err.code,err)
		// 	else if(this.hasAnyListeners('error'))
		// 		this.emit('error',err);
		// 	else
		// 		err.throw();
		// }


		/*
		* Create a smarty based on data that's passed in
		*
		* @param object|array data
		* @opt object options
		*
		* @return <SmartArray>|<SmartObject> 
		* @exported
		*/
		function createSmarty(data,options){
			var smarty;
			switch(cX.checkType(['array','object','<SmartObject>','<SmartArray>'],data)){
				case '<SmartObject>':
				case 'object':
					smarty=new SmartObject(options); 
					break;
				case '<SmartArray>':
				case 'array':
					smarty=new SmartyArray(options);
			}
			
			smarty.assign(cX.copy(data));

			return smarty;
		}



		/*
		* Get the type of a value in the context of this class
		*
		* @param any x
		*
		* @return string 	One of: smart, complex, primitive  or empty string if $x==undefined
		*/
		function smartType(x){
			if(isSmart(x))
				return 'smart'
			else if(x && typeof x=='object')
				return 'complex'
			else if(x==undefined)
				return '';
			else
				return 'primitive';
		}




		/*
		* Make sure key and value are the correct types for set() function, taking into account option 'children'
		*
		*
		* @param mixed 	key 	String, number or array. Limited if @add!=undefined to number/array
		* @param mixed 	value 	The value to set. Limited by _private.options.children
		* @param bool 	add 	Only for arrays (NOTE: also used to determine if keys have to be numerical)
		*
		* @throws TypeError
		* @return object|false 	If false then .set() should return $event immediately. Object should be passed on to commonSet
		*
		* @sets event.key*2(in begining & final at end), event.old (final), event.value (temp, reset by commonSet)
		* @call(<SmartArray>|<SmartObject>)
		*/
		function commonPrepareSet(key,value,event){
			// this._log.traceFunc(arguments);
			try{
				//Start by checking basic types
				var [kType,vType]=cX.checkTypes(this._private.expectedTypes,[key,value])
				
				//If further meta options have been set, apply those too (yes, this may do a second type check but otherwise
				//we would have to check if a meta[key].default was set, else use expectedTypes, and we'd have to worry about
				//setting vType... just make it easy on ourselves)
				if(this._private.options.meta){
					value=applyMeta.call(this,key,value);
				}

				//Now that we have clean ones, set key/value on the event...
				Object.assign(event,{key,value}); 

				//Then get the old value (which is undefined if we're an array and adding a new value) 
				var oldValue = event.old = (event.add ? undefined : this.get(key)); //gets the nested value if @key is array
				
				//Then check if anything has changed, in which case we return early
				if(!event.add && cX.sameValue(oldValue,value)){
					//^if we're adding we NEVER return here because this.set() will then end with evt='none'

					//2019-06-28: This log is good when figuring out why event is not firing. ie. don't add NO_LOG_TOKEN here, 
					//				if you don't want to see it, then don't print it
					this._log.trace(`Ignoring same value on '${kType=='array' ? key.join('.') : key}': `,value);
					return false; //false => same value
					
					//NOTE: if (typeof value=='object') then oldValue!==value, which is why we return oldValue
				}

				//Determine if value is smart object
				if(smartType(value)=='smart'){
					vType='smart';
				}
//TODO: 2020-04-25: We don't want or need both x and event... just store the important stuff on event
				var x={
					children:this._private.options.children //set here so it's included when logging x vv
					
					,localKey:key
					,localValue:oldValue //the current local value (value at localKey)
					
					,nestedKeys:undefined //if key is non-array or single item array...
					,fullKey:undefined //set vv, used for emitting...
					,oldValue:oldValue //the current (possibly nested) value (value at fullKey)
					
					,valType:vType
					,newValue:value
					
					,keyStr:undefined //set vv, for logging
				};

				//For array keys
				if(kType=='array'){

					if(key.length>1)
						x.nestedKeys=key.slice(1); //if key is multi-item array...
					x.localKey=key[0];
					kType=cX.checkType(['string','number'],x.localKey);
				}



				//If the key should be numerical
				if(event.add!=undefined && kType=='string'){ //if arg#2 is passed at all, we assume it's an array with numerical keys
					x.localKey=cX.forceType('number',x.localKey); //throws on fail
					kType='number'; 
				}


				if(x.nestedKeys){
					x.fullKey=[x.localKey].concat(x.nestedKeys); //localKey is not proper type, see ^
					x.keyStr=x.fullKey.join('.');
					x.localValue=this._private.data[x.localKey]; 
				}else{
					x.fullKey=x.localKey;
					x.keyStr=String(x.localKey);
				}

				event.key=x.fullKey;
				return x;

			}catch(err){
				// event.evt='error';//2020-03-31: Either we do this everywhere or nowhere... ie. not implemented yet
				this._log.throw('Failed to set.',err,this);
			}
		}


		/*
		* Get the meta for a specific key, or the "global meta" (ie. key '*' when creating smarty with options.meta:{*:{}})
		*
		* @return object|undefined
		*/
		SmartProto.prototype.getMeta=function(key){
			if(this._private.options.meta){
				if(this._private.options.meta.hasOwnProperty(key)){
					return this._private.options.meta[key];
				}else{
					return this._private.options.meta['*']; //this could be undefined;
				}
			}
			return undefined;
		}

		/*
		* Get the default value for a key, or the "global default" (ie. key '*' when creating smarty with options.defaultValues:{*:foo})
		*
		* @param string|number key
		*
		* @return any|undefined 	The default value, or undefined if none exists
		*/
		SmartProto.prototype.getDefault=function(key){
			if(this._private.options.defaultValues){
				if(!key){
					let d=cX.copy(this._private.options.defaultValues);
					delete d['*'];
					return d;
				}else{
					if(this._private.options.defaultValues.hasOwnProperty(key)){
						return this._private.options.defaultValues[key];
					}else{
						return this._private.options.defaultValues['*']; //this could be undefined;
					}
				}
			}
			return undefined;
		}


		/*
		* Apply meta restrictions on a key/value
		*
		* @param mixed key
		* @param mixed value
		*
		* @throw <ble EINVAL>
		*
		* @return mixed 			The cleaned up version of $value
		* @call <SmartProto>
		*/
		function applyMeta(key,value){
			//Is there meta for this key?
			let meta=this.getMeta(key);
			if(!meta){
				if(this._private.options.onlyMeta){
					this._log.makeError("Smarty only allowing pre-defined keys and this is not one: "+key).throw("EINVAL");
				}else{
					return value;
				}
			}

			//REMEMBER: The default value is always allowed UNLESS it's "empty" and meta.required==true (see below)
			try{
				if(value!==this.getDefault(key)){

					//If there's a list of acceptable values... null is always accepted
					if(meta.accepted && !meta.accepted.includes(value)){
						this._log.makeError(`Value not among approved values for '${key}':`,value).throw("EINVAL");
					}

					//Ff type is specified, try forcing it (ie. '3' => 3)
					if(meta.type){ 
						try{
							value=cX.forceType(meta.type,value);
						}catch(err){
							this._log.makeTypeError(`${meta.type} for key '${key}'`,value).throw();
						}
					}
					
					//If value should start with something...
					if(meta.prepend){ 
						//.init() has made sure meta.type=='string', which was checked ^
						let l=meta.prepend.length;
						// log.note('PREPEND:',l,value.substring(0,l),);
						if(value.substring(0,l)!=meta.prepend)
							value=meta.prepend+value;
						
					}
					
					if(meta.cleanFunc){
						try{
							//.init() made sure it's a func
							value=meta.cleanFunc.call(this,value,key,meta);
							 	//protip: cleanFunc can be bound if need be...
						}catch(err){
							console.log(this._private.options);
							throw err;
						}
					}
					
				}
				
				//Finally, if it's required, make sure we have *something* at this point 
				//NOTE: this may fail a default==null prop
				if(meta.required && cX.isEmpty(value)){
					this._log.makeError(`'${key}' cannot be empty: `+cX.logVar(value)).throw('EEMPTY');
				}
				
				//NOTE: we check meta.constant in commonSet() since we want to know if the evt=='change' which 
				//		for arrays we determine after this function
			}catch(err){
				this._log.makeError(`Failed meta-validation for key '${key}'`,err).throw();
			}


			return value;
		}


		/*
		* Handle setting or changing private data, depending on the new/old values, the type of children etc.
		*
		* @param object x 		The object returned from commonPrepareSet. NOTE: gets manipulated
		* @param object event 	The event object we're going to emit and return. NOTE: gets manipulated
		*
		* @throw <ble>
		*
		* @return boolean 		True => the local smarty.set() should emit, false => a child smarty will take
		*						  care of emitting
		*
		* @sets event.value 	If a new smarty is created, else the value from commonPrepareSet() remains
		* @call(<SmartArray>|<SmartObject>)
		*/
		function commonSet(x,event){
			//Apply some restrictions for change events
			if(event.evt=='change'){
				//Last .meta check...
				let meta=this.getMeta(event.key);
				if(meta && meta.constant){
					//If the prop is constant it's not allowed to change UNLESS it's changing away from the default (this is useful
					//when the default was not explicitly specified and we intend to change it once only)
					if(!cX.sameValue(event.old,this.getDefault(event.key))){
						throw this._log.makeError(`Cannot change constant prop '${event.key}': ${cX.logVar(event.old)} --> ${cX.logVar(event.value)}`);
					}
				}

				if(this._private.options.constantType && cX.varType(event.old)!=cX.varType(event.value)){
					throw this._log.makeError(`Cannot change type any prop, incl. '${event.key}': ${cX.logVar(event.old)} --> ${cX.logVar(event.value)}`);
				}
			}

			try{
				var errMsg='Failed to '
				var c=this._private.options.children; //shortcut

				if(event.evt=='new'){
					if(arguments[2]!=NO_LOG_TOKEN)
						this._log.trace(`Setting new key '${x.keyStr}' to: ${cX.logVar(x.newValue)}`);

					if(c=='smart'){
						errMsg+='create smarty on key '
						event.value=_newSmart.call(this,x); 

					
					}else if(x.nestedKeys){
						errMsg+='set nested key '
						cX.nestedSet(x.localValue,x.nestedKeys,x.newValue,true); //true==create path if needed.
					
					}else{ 
						errMsg+='set key '
						this._private.data[x.localKey]=x.newValue;
					}

				}else{ //evt=='change'
					errMsg+='change '
					if(arguments[2]!=NO_LOG_TOKEN)
						this._log.trace(`Changing key '${x.keyStr}': ${cX.logVar(x.oldValue)} --> ${cX.logVar(x.newValue)}`);

					if(x.nestedKeys){ //chaning smth non-local
						errMsg+='nested '
						if(c=='smart'){
							errMsg+='smarty '

							//Recursively .set() on the local smart child...
							x.localValue.set(x.nestedKeys,x.newValue,event,NO_LOG_TOKEN); //we've already logged ^^

							//...then return false to prevent .set() from emitting anything since the last child will emit
							//and then that event bubbles up through us getting changed on the way
							return false; 

						}else{//c=='complex' 
							errMsg+='complex '
							//Change the nested value of the live local object
							cX.nestedSet(x.localValue,x.nestedKeys,x.newValue,true); //true==create path if needed.
						}

					}else{//changing something local
						errMsg+=`local ${smartType(x.localValue)} prop`
						if(c=='smart'){
							x.newValue=_changeSmart.call(this,x);
						}else{ //both primitive and complex children work the same when setting a local value, even if said value is complex
							this._private.data[x.localKey]=x.newValue;
						}
					}

				}
			}catch(err){
				var keyStr=x.keyStr; delete x.keyStr;
				this._log.throw(`${errMsg}'${keyStr}':`,x,err);
			}

			return true;
		}



		/*
		* Set a new local smart child. Works for both SmartArr and SmartObject.
		*
		* @param object x 		The object returned from commonPrepareSet(). 
		*
		* @return mixed 		The newValue
		*/
		function _newSmart(x){

			if(x.nestedKeys){
				//Determine if the first key is a number or string, choosing arr/obj accordingly
				var childConstructor=(isNaN(Number(x.nestedKeys[0]))?SmartObject:SmartArray);

		//TODO 2019-06-27: not sure about this one working correct... check
				//Recursively create new objects
				return setSmartChild.call(this,x.localKey,childConstructor).set(x.nestedKeys,x.newValue); 
			}

			//The following 2 cases we'll have to create a new child, set data on it, then start listening to it,
			//so just determine the constructor for now...
			if(x.valType=='array'){
				return setSmartChild.call(this,x.localKey,SmartArray, x.newValue);

			}else if(x.valType=='object'){
				return setSmartChild.call(this,x.localKey,SmartObject, x.newValue);


			//The value is already a smarty, no need to create, just set and listen
			}else if(x.valType=='smart'){
				return setSmartChild.call(this,x.localKey,x.newValue); 

			}else{
				this._private.data[x.localKey]=x.newValue; //Set primitive value direct on this object
				return x.newValue;
			}
		}

		/*
		* Change an existing local smart child
		*
		* @param object x 		The object returned from commonPrepareSet()
		*
		* @return mixed 		The newValue	
		*/
		function _changeSmart(x){
			switch(x.valType){	
				//If we get a regular object we have to create a new smart object
				case 'object':
				case 'array':
					var child;
					//If the old value used to be the wrong kind of smart, delete it
					var childConstructor=(x.valType=='object'?SmartObject:SmartArray);
					if(isSmart(x.oldValue)){ 
						if(x.valType!=(x.oldValue instanceof SmartObject ? 'object' : 'array')){
							this._log.note(`Replacing existing ${x.oldValue.constructor.name} with ${childConstructor.name} on key '${x.localKey}'`)
							this._private.deleteSmartChild(x.localKey,x.oldValue); 
						}else{
							child=this.get(x.localKey)
						}
					}
					
					//In 2 of 3 cases ^^ we want to...
					if(!child){
						// ...create a new child and set all the values on it
						return setSmartChild.call(this,x.localKey,childConstructor,x.newValue); 
						
					}else{
						//Change the content of the existing smarty
						x.oldValue=child.replace(x.newValue);
						return child; 
					}



				//If we get a smart object we set that here, even if that means removing the existing one
				case 'smart':
					if(isSmart(x.oldValue)){//implies smart since options.children==smart
						this._log.note(`Replacing existing ${x.oldValue.constructor.name} with passed in ${x.newValue.constructor.name} on key '${x.localKey}'`)
						this._private.deleteSmartChild(x.localKey,x.oldValue); 
					}
					return setSmartChild.call(this,x.localKey,x.newValue);

				default: //this should be any primitive value
					this._private.data[x.localKey]=x.newValue;
					return x.newValue;
			}

		}


		/*
		* Prepare a smart child by (optionally creating it), and set it locally
		*
		* NOTE: This method DOES NOT start listening to it (extending it's events)
		*
		* @param string|number key 			
		* @param function|object child 		A child constructor, or a child object
		* @param bool listen 				Default false. Listen to child events. This is optional since we may want to delay it
		*									 to set data on it first
		*
		* @return <SmartObject>|<SmartArr>
		*/
		function setSmartChild(key,child,data){

			//Create child if necessary
			if(cX.checkType(['<SmartArray>','<SmartObject>','function'],child)=='function'){		
				this._log.debug(`Creating nested ${child.name} on key '${key}'`);

				//Copy the options from this object (so they aren't ref'd together). 
				var options=cX.copy(this._private.options);
				
				//Default and meta we only pass on stuff intended for that key/child
				options.defaultValues=this.getDefault(key);
				cX.isEmpty(options.defaultValues)
					options.defaultValues=null;
				let meta=this.getMeta(key);
				options.meta=meta?meta.meta||null:null; //meta for key/child is not the same as meta for the grandchildren...

				//If a name is on this, then the name of the child should have the key appended
				if(options.name)
					options.name+='.'+key;

				child=new child(options);
			}else{
				this._log.debug(`Setting existing ${child.constructor.name} on local key '${key}'`);

			}

			//If we got data to set, do so before we start listening to it...
			if(data)
				child.assign(data);


			//First listen to changes from the child. This listener changes the live event object so we... vv
			var childListener=(event)=>{
				//First we need to get the local key, which is straighforward for objects, but may have changed for arrays
				let localKey= (this._private.data[key]==child ? key : this.findIndex(child))

				//Now check what type of bubbling we do
				if(this._private.options.bubbleType=='nested'){

					//Just prepend the local key to the key array (making one if needed)
					if(Array.isArray(event.key))
						event.key.unshift(localKey)
					else
						event.key=[localKey,event.key]

					//NOTE: In the case of a 'move' event, .toKey is left unchanged, which is what move() expects

				}else{ //implies 'local'

					//Any event in a child is deemed a 'change' at this level, and current state of the child is the changed-to value.
					Object.assign(event,{evt:'change',key:localKey, value:child});

						//^ One issue with this is that we can't know the previous value of the child, so the 'change' event
						//  will look a little different than usual
				}
				tripleEmit.call(this,event);

			}

			//...set it to run AFTER any listeners on the child itself
			child.addListener('event',childListener,'+'); //+ => run at defaultIndex+1

			//Then create a way to ignore the child. Since the child may be set on multiple parents, we'll store the listener
			//method locally, mapped to the child itself
			this._private.childListeners.set(child,childListener);
			

			//Now save the child locally and return it
			this._private.data[key]=child;
			return child;
		}



		/*
		* Stop listening to a smart child and remove it from local data.
		*
		* @param string|number key 
		* @secret NO_LOG_TOKEN 			If passed this function will not log
		*
		* @return <SmartProto> 				The child we just removed/ignored 	
		*/
		function deleteSmartChild(key){
			var child=this.get(key);
			if(isSmart(!child)){
				this._log.throw(`Key '${key}' is not a smart child:`,child);		
			}
			
			if(arguments[1]!=NO_LOG_TOKEN)
				this._log.info(`Deleting ${child.constructor.name} from local key '${key}'`);
			
			child.removeListener(this._private.childListeners.get(child));

			delete this._private.data[key];

			return child;
		}








		/*
		* Emits 3 events instead of one, so users can easily listen the way the want 
		*
		*
		* @param object event 		An object with all the details about the event
		*
		* @emit 'event'
		* @emit 'new'
		* @emit 'change'
		* @emit 'delete'
		* @emit '_foo' 		Where foo is the named of the effected prop
		* @emit '_foo.bar'	Like ^ but a nested prop, ie. only exists if children==smart
		*
		* @return void 			  
		* @call(<SmartProto>)
		*/
		function tripleEmit(event){
			if(Array.isArray(event.key))
				event.key.toString=function(){return this.join('.')}; //So we can always handle like string

			this.emit.call(this,event.evt,event);
			this.emit.call(this,'event',event);
			
			let key='_'+event.key;//leading '_' in case keys have unsuitable names like 'change' or 'new'
			this.emit.call(this,key,event); 
			return;
		}











		SmartProto.prototype.hasSnapshot=function(){
			return this._private.snapshot ? true : false
		}

		SmartProto.prototype.stopSnapshot=function(){
			if(this.hasSnapshot()){
				this.off('event',this._private.snapshot.listener)
				delete this._private.snapshot;
			}
			return;
		}

		SmartProto.prototype.setupSnapshot=function(delay){
			cX.checkType('number',delay);

			delay=delay||1; //The delay has to be something... because i say so

			//If a snapshot is already setup...
			var s=this._private.snapshot
			if(s){
				let o=s.emitter_.betterEvents.options;
				if(o.bufferDelay!=delay){
					this._log.debug(`Changing existing snapshot delay from ${o.bufferDelay} => ${delay}`)
					o.bufferDelay=delay;
				}
			}else{
				s=this._private.snapshot={};

				//Create seperate emitter so we can control what goes out from this smarty
				s.emitter=new BetterEvents({bufferDelay:delay});
				
				//Then create and store a listener so we can remove it. The listener triggers the delay and 
				//registers the keys affected...
				s.listener=(evt,key,value)=>{
					switch(typeof key){
						case 'object':
							key=key[0];
						case 'number':
						case 'string':
							s.emitter.bufferEvent(String(key)); break;
					}
				}
				
				//...and when it times out: emit with the affected keys
				s.emitter.on('_buffer',(affected)=>{
					this.emit('snapshot',Object.keys(affected)); 
				});

				//Now finally register the listener locally. It's this that needs to be removed if we
				//stop the snapshot
				this.on('event',s.listener);
			}


			return;
		}


		/*
		* Check if a single prop exists
		*
		* @param string|number|undefined key 	 Undefined to get the entire object, a key to get a single prop	
		*
		* @return mixed 			  
		*/
		SmartProto.prototype.has=function(key){
			//For simplicity, if we get an array key, just use this.get() to determine if the value is exists
			if(Array.isArray(key)){
				try{
					return this.get(key)!=undefined;
				}catch(err){
					return false;
				}
			}
			return this._private.data.hasOwnProperty(key)
		}


		/*
		* Get a single prop (live if option children==smart or getLive==true) or the whole data structure (a copy of 
		* the structure always, but children will be live in same case ^^)
		*
		* @param string|number|array|undefined key 	 Undefined to get the entire object, a key to get a single prop. Arrays
		*											 accepted if children==smart||complex
		*
		* @return mixed 			  
		*/
		SmartProto.prototype.get=function(key=undefined){
			var o=this._private.options; //shortcut
			if(key==undefined){ //will trigger on both undefined and null
				//We're going to return all data in a regular array/object, but it should not be the 
				//live this._private.data to prevent accidental change...
				if(o.children=='smart' || o.getLive==true){
					//...however, we may want to retain live children, in which case we get each child
					//individually and set on a returned arr/obj...
					var x=new this._private.data.constructor();
					this.keys().forEach(key=>x[key]=this.get(key));
					return x;
				}else{
					//...else we just copy the whole thing
					return cX.copy(this);
				}
			}

			//For complex children we allow key to be array with multiple 'steps'
			if(Array.isArray(key)){
				var keys=cX.copy(key); //so we don't alter the passed in array
				switch(o.children){
					case 'primitive':
						this._log.throw('TypeError: Key cannot be array when using primitive children.');
						return;
					case 'complex':
						return cX.nestedGet(this._private.data,keys);
					case 'smart':
						//Grab the first get and call this func to get that value...
						var k=keys.shift();
						var value=this.get(k);

						//If we have no more keys, that's the value we're after, so return it whatever it is. Also return an 'undefined'
						//because that means whatever value we are after will also be undefined
						if(!keys.length || value==undefined) {
							return value;
						//If we have more keys and another level of smarts, go down...
						}else if(typeof value=='object'&&value instanceof SmartProto){
							return value.get(keys);
						//...if we don't have a smart child, ERROR!
						}else{
							this._log.error("See next error. Nested child at this level: ",this._private.data)	
							this._log.throw('Nested child is not smart, cannot go further down. Remaining keys:',key);
						}

					default:
						this._log.throw("BUGBUG: invalid this._private.options.children: "+cX.logVar(o.children));
				}
			}
			

			if(this.has(key)){
				//If the value is a nested Smart arr/obj then return it live, else return a copy of the value
				var value=this._private.data[key];
				if(typeof value!='object' || o.getLive==true || value instanceof SmartProto){
				// if(typeof value!='object' || o.getLive==true || value instanceof SmartProto ){
					//^Here we always have to 
					// this._log.note("Returning LIVE value for key: "+key);
					return value;
				}else{
					// this._log.note("Returning COPY of key: "+key,value);
					return cX.copy(value); 
				}
			}else
				return undefined; 
		}

		/*
		* Get the deepest nested Smarty that has options.children!='smart'. 
		*
		* @param array|string|number nestedKeys 	If string|number then this is returned, else we move down, altering the array
		*											as we go, stoping when children!='smart'. The array will then contain all remaining 
		*											keys (at least 1)
		* @opt bool mustExist 		Default false. If true and the whole key (except the last one) doesn't exist, throw!
		* @opt function mustBeType	Default null => get any smarty. Else constructor for smarty we want
		*
		* @internal <SmartObject>|<SmartArray> parent 	
		*
		* @throw <ble TypeError> 	$nestedKeys wrong type
		* @throw <ble NoMatch> 		Could not find smarty of requested type
		* @throw <ble ENOENT> 		The full key didn't exist
		*
		* @return <SmartObject>|<SmartArray> 	
		*/
		SmartProto.prototype.getDeepestSmarty=function(nestedKeys, mustExist=false,ofType=null){
			//For same handling...
			if(cX.checkType(['string','number','array'],nestedKeys)!='array')
				nestedKeys=[nestedKeys];


			//First we go all the way down to the deepest smarty...
			var smarty=this;
			if(nestedKeys.length>1&&this._private.options.children=='smart'){
				let key=nestedKeys[0];
				let child=this.get(key);
				if(child instanceof SmartProto){
					if(!nestedKeys.hasOwnProperty('_nestedKeys_'))
						Object.defineProperty(nestedKeys,'_nestedKeys_',{value:[],writable:true});
					if(!nestedKeys.hasOwnProperty('_nestedValues_'))
						Object.defineProperty(nestedKeys,'_nestedValues_',{value:[],writable:true});
					nestedKeys._nestedKeys_.push(key);
					nestedKeys._nestedValues_.push(this);
					nestedKeys.shift();
					smarty=child.getDeepestSmarty(nestedKeys); //don't require anything
				}
			}

			//...then if we care about the kind, we work our way back up until one matches $ofType		
			if(ofType && typeof ofType=='function'){
				let parents=nestedKeys._nestedValues_
				let keys=nestedKeys._nestedKeys_
				while(!(smarty instanceof ofType)){
					if(parents && parents.length){
						smarty=parents.pop();
						nestedKeys.unshift(keys.pop()); //return keys... the length may be checked vv
					}else{
						(log||this._log).makeError(`Could not find a ${ofType.constructor.name}.`).setCode('ENOMATCH').exec().throw();
					}
				}
			}
			
			//If we want the entire path to exist, make sure...
			if(mustExist && type=='array' && nestedKeys.length>1){
				(log||this._log).makeError(`The rest of the nested key doesn't exist @${nestedKeys._nestedKeys_.join('.')}:`
					+` ${nestedKeys.join('.')}`).setCode('ENOENT').exec().throw();
			}
			
			//At this point we have a smarty to return. It's either the right everything, or we don't care
			//what it is... but it is a smarty
			return smarty;
		}

		/*
		* Get a non-smart, non-live copy of the data on this smarty
		*
		* NOTE: This will remove any values that are functions (which we are allowing since 2020-02-19)
		*
		* @return object|array
		*/
		SmartProto.prototype.stupify=function(key=undefined){
			if(key)
				return cX.copy(this.get(key))
			else
				return cX.copy(this)
		}
		SmartProto.prototype.copy=function(key){
			return this.stupify(key);
		}



		/*
		* Reset a single prop or the entire object to default values. If no defaults exist then it's the same
		* as deleting the props in question
		*
		* @param string|number|undefined key 	Undefined resets entire object, a key resets a single prop
		*
		* @return mixed 			  
		*/
		SmartProto.prototype.reset=function(key){
			// this._log.traceFunc(arguments);
			//If no key is given, either empty everything if there also are no default values, or reset each key 
			// currently set (which may entail deleting said key)
			if(!key || key=='*'){
				
				//NOTE: in the constructors we make sure defaultValues is right type and not empty

				if(!this._private.options.defaultValues){
					this._log.debug(`No default values set, emptying...`);
					return this.empty();
				}

				//Get unique list of keys, all that are currently set and all in default... that way keys not in default 
				//get deleted and keys in default get set/changed
				var keys=this.keys().concat(Object.keys(this.getDefault())).filter(cX.uniqueArrayFilter);
				// this._log.warn("KEYS:",keys);

				//Especially for arrays it's important we set key 0 first since this may be empty and things have 
				//to remain sequential, hence we shift
				this._log.debug('Resetting all keys:',keys);
				var key, oldValues=cX.copy(this._private.data);
				while(key=keys.shift()){
					this.reset(key);
				}

				return oldValues
			}

			//If a key is passed and a default exists, set that, else just delete the key
			var value=this.getDefault(key);
			if(value!==undefined){

				this._log.trace(`Resetting key '${key}' from ${cX.logVar(this.get(key))} --> ${cX.logVar(value)}`);
				var oldValue=this.set(key,value,null,true); //true==no log, done vv instead

				//If the default value is a smart value, then reset that too
				if(isSmart(value))
					value.reset(undefined);
				
				return oldValue;
			}else{
				this._log.debug(`No default values found for key '${key}', deleting it`);
				return this.delete(key,true); //true==no log
			}
		}




		/*
		* Replicate an 'event' from another smarty to this one. 
		*
		* ProTip: Use shortcuts replicateTo() and replicateFrom()
		*
		* @param object event

		* @param string evt
		* @param string|number|array key 	The local or nested key being changed (or the 'from index' in case $evt=='move')
		* @param any value 					The value to change to. Ignored if $evt=='delete'. The 'to index' if $evt=='move'
		*
		*/
		SmartProto.prototype.replicate=function(event){
			
			var types=cX.checkProps(event,{evt:'string',key:['string','number','array']});

			if(this._log.options.lowestLvl<3)
				this._log.debug(`Replicating ${event.evt}(${typeof event.key=='object' ? key.join('.') : key},${String(value)})`);
			 	//^ if transmitting over uniSoc then key.toString won't be what we set it to in tripleEmit()

			//Unless another source has already been specified, set it now
			event.src=event.src||'replicate';

			switch(event.evt){
				case 'new':
					if(Array.isArray(this._private.data)){
						event.add=true //in case this got lost
					}
					//else allow to fall through
				case 'change':
					return this.set(event.key,event.value,event);
				case 'delete':
					return this.delete(event.key,event);
				case 'move':
					return this.move(event.key,event.to,event);
					// //Since only SmartArrays have the .move() method, if $key is an array we need to fetch what should 
					// //be a nested SmartArray and then call .move() on it
					// if(types[1]=='array'){
					// 	let from=key.pop();
					// 	let smarty=this.get(key);
					// 	if(isSmart(smarty)!='SmartArray')
					// 		this._log.makeError("Nested key did not point to a SmartArray:",key,smarty).setCode('EINVAL').throw();
					// 	return smarty.move(from,value); //$value=to index
					// }else{
					// 	return this.move(key,value); //$key=from index, $value=to index
					// }

				default:
					this._log.throw("Expected arg#1 to be 'new', 'change' or 'delete', got: "+cX.logVar(evt));
			}
		}

		SmartProto.prototype.replicateTo=function(target){
			this.on('event',target.replicate.bind(target))	
		}

		SmartProto.prototype.replicateFrom=function(source){
			source.on('event',this.replicate.bind(this))	
		}



		/*
		* Delete all items on this array
		*
		* @param string mode 		What to do if a delete() fails:
		*								'force' - conintue delete(), then empty any remaining ungracefully (ie. no event emitted)
		*								'panic' - stop executing immediately, throwing error
		*								'finish' - conintue delete() then throw after
		*
		* @emit delete (via this.set)
		*
		* @throw <BLE>  				If not all data was removed after trying according to @mode
		*
		* @return array|undefined 		If no changes occured then undefined is returned. Else a snapshot of the data
		*								before emptying
		*/
		SmartProto.prototype.empty=function(mode='force'){
			this._log.traceFunc(arguments);
			//Legacy...
			mode=mode===true ? 'force' : !mode ? 'finish' : mode;


			if(cX.isEmpty(this._private.data))
				return undefined;

			var cnst=this._private.data.constructor;
			var oldValues=new cnst(),keys=this.keys(),i=keys.length;
			while(i--){
				let key=keys[i];
				try{
					oldValues[key]=this.delete(key);
				}catch(err){
					let msg=`Problems empyting ${this.constructor.name} while processing key '${key}'.`;
					if(mode=='panic')
						this._log.throw(msg,err);
					else
						this._log.error(msg,err);

					if(mode=='force')
						oldValues[key]=this.get(key);
				}
			}


			//Make sure everything is gone
			if(!cX.isEmpty(this._private.data)){
				if(mode=='force'){
					this._log.warn("Was unable to delete everything.");
					this._brutalEmpty();

					if(cX.isEmpty(this._private.data))
						return oldValues;
				}
				//if mode=='finish' or we still didn't manage to empty everything ^^, continue to vv
			}else{
				return oldValues;
			}

			this._log.throw("Was unable to delete everything. The following still exists:",this._private.data);
			
		}


		SmartProto.prototype._brutalEmpty=function(){
			 this._log.note("The following data will be removed without emitting delete events:",this._private.data);

			//In case we're using public getters, make sure these get deleted too
			if(this._private.options.addGetters){
				this._log.debug("...public getters will also be removed");
				removePublicGetters.call(this);
			}

			this._private.data=new this._private.data.constructor();
		}


		/*
		* Store an object as a state. This can later be assigned by calling goToState(@name)
		*
		* @param string name 	The name of the state, used when assigning
		* @param object state 	The object to be assigned. Remember that any values 
		* @param array options 	Array of string flags. Available are:
		*							'replace' - use replace() instead of assign() when "going to state"
		* 							'defaults' - fill @state with default values
		*
		* @throws TypeError
		* @throws Error
		*
		* @return void
		*/
		SmartProto.prototype.addState=function(name, state, options=[]){
			cX.checkTypes(['string','array'],[name,options]);

			if(options.includes('defaults') && this._private.options.defaultValues)
				state=Object.assign({},this.getDefault(),state);

			if(options.includes('replace'))
				this._private.states[name]=this.replace.bind(this,state);
			else
				this._private.states[name]=this.assign.bind(this,state);

			return;
		}


		/*
		* Go to a previously defined state
		*
		* @param string name
		*
		* @return object|undefined 		@see @return of assign() or replace()
		*/
		SmartProto.prototype.goToState=function(name){
			if(typeof this._private.states[name]=='function'){
				this._log.info("Going to state: "+name);
				var res=this._private.states[name].call();
				this.emit('state',name);
				return res;
			}
			
			this._log.warn('No such state:',name);
			return undefined;

		}



		/*
		* Used by set() functions if options.publicGetters==true
		*/
		SmartProto.prototype._setPublicGetter=function(key){
			if(!this.hasOwnProperty(key))
				Object.defineProperty(this,key,{enumerable:true,configurable:true,get:()=>this.get(key)});
		}

		/*
		* Remove ALL public enumerable getters. 
		*
		* @access private
		* @call(this)
		*/
		function removePublicGetters(){
			var p,d;
			for(p in Object.getOwnPropertyNames(this)){
				d=Object.getOwnPropertyDescriptor(this,p);
				if(d.enumerable==true && typeof d.get=='function'){
					if(!this._private.data.hasOwnProperty(p))
						this._log.note(`BUGBUG: Mismatch between public getter and private data. '${p}' doesn't exist privately. Deleting getter anyway.`,this);
					delete this[p];
				}
			}
		}

		/*
		* @access private
		* @call(this)
		*/
		function setPublicGetters(){
			var p;
			for(p in Object.getOwnPropertyNames(this._private.data)){
				this.setPublicGetter(p);
			}
		}

		SmartProto.prototype.resetPublicGetters=function(){
			removePublicGetters.call(this);
			setPublicGetters.call(this);
		}



























































		/***************************** SmartObject *****************************/

			/*
			* @constructor SmartObject 	
			* @exported
			*/
			function SmartObject(options){	
				Object.defineProperty(this,'isSmart',{value:'SmartObject'});
				
				//Inheritence step 1
				SmartProto.call(this,options); 
			}
			//Inheritence step 2
			SmartObject.prototype=Object.create(SmartProto.prototype);
			Object.defineProperty(SmartObject.prototype, 'constructor', {value: SmartObject});

			SmartObject.defaultOptions={
				//future dev: add default options here
			}; 



			Object.defineProperty(SmartObject.prototype,'length',{get:function(){return Object.keys(this._private.data).length;}})


			


			/*
			* @param string|number|array 	key 	If an array, a nested value is set
			* @param mixed  				value 	@See _private.options.children for allowed values
			* @opt object 					event 	Object to emit. The following props will be overwritten: evt, key, value, old
			* @secret NO_LOG_TOKEN 					If passed this function will not log
			*
			* @emit new, change, delete (via this.delete if value==null), event
			*
			* @throw TypeError
			* @return mixed 	The previously set value (which could be the same as the new value)
			*/
			SmartObject.prototype.set=function(key,value,event){
				// this._log.traceFunc(arguments);
				
				//Undefined is the same as deleting. This is used eg. by assign(). There is a risk that it's passed in by mistake, but
				//so what, the same goes for any objects...
				if(value===undefined) 
					return this.delete(key,event,arguments[3]); //returns old value or undefined (not null)
				
				//Make sure we have an event object to emit later...
				event=((event && typeof event=='object') ? event : {});
				

				//Common preparation for setting, where we also check if anything has changed from old value
				var x=commonPrepareSet.call(this,key,value,event); //NOTE: event.add==undefined implies that we're a SmartObject
				if(!x)
					return event.old; //event has been altered by commonPrepareSet()


				//At this point we know we're setting something, time to determine the event, 'new' or 'change', in terms of the
				//local object (ie. setting a new sub-property on an existing local property is still a 'change' in the local eyes)
				if(event.old===undefined){

					//in case we try to set eg. key '_private'
					if(this.hasOwnProperty(x.localKey)) {
						this._log.throw(`Key '${x.localKey}' is reserved on SmartObject, cannot set to:`,value,this);
					}

					event.evt='new';
				}else{
					event.evt='change';
				}
				

				//Do the actual setting. If we're setting a smart child then...
				var emitHere=commonSet.call(this,x,event,arguments[3]);

				//If a new property was added and we're using getters...
				if(event.evt=='new' && this._private.options.addGetters)
					setPublicAccessors.call(this,x.localKey);
				
				//We only emit from the nested-most smarty... which may be where we are right now!
				if(emitHere)
					tripleEmit.call(this,event);
				

				return event.old;
			}






			/*
			* @param string|number key
			* @opt object event
			*
			* @emit delete,event
			*
			* @throw TypeError
			*
			* @return primitive|undefined 	The previously set value, or undefined (if nothing was previously set, ie no change)
			*/
			SmartObject.prototype.delete=function(key,event={}){
				cX.checkType(['string','number'],key);

				//Make sure we have an event object to emit later...
				event=((event && typeof event=='object') ? event : {});

				if(this.has(key)){
					let oldValue=this.get(key);

					if(this._private.options.children=='smart' && typeof oldValue=='object'){
						this._private.deleteSmartChild(key,arguments[2]); //will also log unless arg#2
					}else{
						if(arguments[2]!=NO_LOG_TOKEN)
							this._log.trace(`Deleting key '${key}':`,cX.logVar(oldValue));
						delete this._private.data[key];
					}
					

					//Remove getter/setter from this object
					if(this._private.options.addGetters)
						delete this[key];

					tripleEmit.call(this,Object.assign(event,{evt:'delete',key,old:oldValue}));
					
					return oldValue;
				}else{
					return Object.assign(event,{key,evt:'none'})
				}

			}










			/*
			* Set multiple key/values on this object
			*
			* @param object obj
			*
			* @throws TypeError
			* @emit new,change,delete (via this.set)
			*
			* @return object|undefined 		If no changes occured then undefined is returned. Else an object with same keys
			*								as @obj for those values that have changed. Values are the old values
			*/
			SmartObject.prototype.assign=function(obj){

	// if(obj.hasOwnProperty('status') && obj.status=='paused')
		// debugger;

				cX.checkType('object',obj);
				
				try{

					//If the exact same data was passed in, exit early
					if(cX.sameValue(this._private.data, obj)){
						this._log.trace("Tried to assign the same values, ignoring...");	
						return undefined;
					}
					this._log.trace("Assigning multiple values:",obj);

					//Set each value, storing the old value if there where any changes
					var oldValues={};
					for(var [key,value] of Object.entries(obj)){
						let old=this.set(key,value,undefined,true)//true==no log, we did that here ^^
						if(old!=value)
							oldValues[key]=old;
					}

					//If no changes happened, return undefined like ^^
					if(!Object.keys(oldValues).length){
						this._log.trace("All assigned values were the same as before, ie. no change.");
						return undefined
					}else{
						return oldValues;
					}
				}catch(err){
					throw this._log.makeError('Failed to assign. ',err,obj);
				}
			}



			/*
			* Replace all values on this object (but checking first so events only go out for actual changes). This
			* is different from this.assign() in that keys that don't exist on the passed in $obj get deleted from 'this'
			*
			* @param object obj
			*
			* @throws TypeError
			* @emit new,change,delete (via this.set)
			*
			* @return object|undefined 		If no changes occured then undefined is returned. Else an object with keys 
			*								of the properties that changes and their old values
			*/
			SmartObject.prototype.replace=function(obj){
				if(['null','undefined'].includes(cX.checkType(['object','undefined','null'],obj,'SmartObject.replace')))
					return this.empty();

				if(obj instanceof SmartObject)
					obj=obj.get();

				if(cX.sameValue(this._private.data, obj))
					return undefined;

				//Add key:undefined for any properties on _private.data that doesn't exist on obj, that way they 
				//get deleted by this.set()
				var allUndefined=cX.objCreateFill(this.keys(),undefined);
				obj=Object.assign({},allUndefined,obj);

				return this.assign(obj);
			}


			/*
			* Get several properties from this object
			*
			* @param array arr 		An array of strings
			*
			* @return object 		An object with the keys/values requested
			*/
			SmartObject.prototype.slice=function(arr){
				cX.checkType('array',arr,'SmartObject.slice');

				var slice={};
				arr.forEach(key=>slice[key]=this.get(key));

				return slice;
			}


			/*
			* Call a function for each prop
			*
			* @param function fn
			*
			* @return void;
			*/
			SmartObject.prototype.forEach=function(fn){
				cX.checkType('function',fn,'SmartObject.forEach');

				this.entries().forEach(arr=>fn.call(this,arr[1],arr[0],this))
				
				return;
			}

			/*
			* Call a function for each prop UNTIL said function returns truthy, then return that prop
			*
			* @param function fn
			*
			* @return mixed
			*/
			SmartObject.prototype.find=function(fn){
				cX.checkType('function',fn,'SmartObject.find');

				var key;
				for(key in this.keys()){
					let value=this.get(key);
					if(fn.call(this,value,key,this))
						return value;
				}
				
				return;
			}


			SmartArray.prototype.find=function(test){
				var i=this.findIndex(test);
				return i==-1 ? undefined : this.get(i);
			}


			/*
			* Similar to .assign() except it only sets those values where the keys don't already exist
			*
			* @param function fn
			*
			* @return object|undefined 		If no changes occured then undefined is returned. Else an object with same keys
			*								as @obj for those values that have changed. Values are the old values
			*/
			SmartObject.prototype.fillOut=function(obj){
				cX.checkType('object',obj);
				var excluded=cX.extract(obj,this.keys(),'excludeMissing');
				if(Object.keys(obj).length){
					if(excluded.length)
						this._log.trace("Ignoring the keys that already exists:",excluded);
					return this.assign(obj);
				}else if(excluded.length){
					this._log.trace("All keys already exists:",excluded);
					return undefined;
				}else{
					// this._log.makeEntry('debug',"Empty object passed").addFrom().append(", nothing to fill out with").exec();
					this._log.debug("Empty object passed, nothing to fill out with");
				}
			}





			//End of SmartObject




























		/******************************* SmartArray **************************************/


			/*
			* @constructor SmartArray 
			* @exported	
			*/
			function SmartArray(options){
				Object.defineProperty(this,'isSmart',{value:'SmartArray'});

				//To catch deprecated args... remove if found after 2020-02-23
				if(Object.keys(arguments).length>1)
					throw new Error("DEPRECATED! Create SmartArray with a single options argument");	

				//Call parent constructor which sets up most things...
				SmartProto.call(this,options); 
					

				//Beyond the events common to SmartObject, we also emit 3 events related to our length
				//Add an event to stationList that emits when we have ==1 or >1 stations
				this.on('event',(evt)=>{
					if(evt=='new' || evt=='delete'){
						switch(this.length){
							case 0:
								this.emit('empty'); break; 
							case 1:
								this.emit('single');break;
							default:
								if(evt=='new') //since going from 3 => 2 is should NOT emit
									this.emit('multiple');break;
						}
					}
				})

			}
			//Inheritence step 2
			SmartArray.prototype=Object.create(SmartProto.prototype);
			Object.defineProperty(SmartArray.prototype, 'constructor', {value: SmartArray});

			SmartArray.defaultOptions={
				moveEvent:false    	//if false move() will use delete() and set(), else a custom 'move' event will be emitted
				,smartReplace:true  //if true replace() will try to figure out changes to minimize # of events, else all will 
							    	//just be deleted/set
			}




			Object.defineProperty(SmartArray.prototype, 'length', {get: function(){return this._private.data.length;}});


			//Extend a few non-destructive methods
			[	'includes','map','forEach','filter','entries','every','indexOf','join','lastIndexOf'
				,'reduce','reduceRight','some','toLocaleString','values','slice'
			].forEach(m=>{
				SmartArray.prototype[m]=function(){
					return cX.copy(this._private.data[m].apply(this._private.data,arguments));
				}	
			});




			/*
			* Add or change an item to/on this array.
			*
			* @param number  		i
			* @param mixed  		value 	Any primitive, object or array. 
			* @opt object|boolean 	x		If boolean, true=>splice $value at $key, false=>overwrite. Or object to be emitted. 
			*	  							 The following props will be overwritten: evt, key, value, old, add
			*
			*
			* @throw TypeError
			* @throw Error 			If @i is negative or too large so the array would become non-sequential
			*
			* @return mixed|undefined 	 The previously set value (which may be the same as the current value), 
			*								undefined if nothing was previously set.
			*/
			SmartArray.prototype.set=function(key,value,x){

				let event=(x && typeof x =='object' ? x : {})

				//undefined values are same as deleting, but without risk of range error
				if(value===undefined){
					try{
						return this.delete(key,event); //the previous value.......................2019-03-07: this used to return bool, did we break something?
					}catch(err){
						return undefined; //nothing was previously set
					}
				}

				event.add=(typeof x=='boolean' ? x : (event.add||event.append||event.insert||false));
				

				//Common preparation for setting, where we also check if anything has changed from old value
				x=commonPrepareSet.call(this,key,value,event); //event.add!=undefined implies that key has to be numerical
				if(!x)
					return event.old; //event has been altered by commonPrepareSet()


				//Make sure the index is in range, and determine if we're adding
				var length=this.length;
				if(x.localKey==length){
					event.add=true;
				}else if(x.localKey>length){
					this._log.throw(new RangeError("SmartArray must remain sequential, cannot set index "+x.localKey+" when length is "+length));
				}else if(x.localKey<0){
					this._log.throw(new RangeError("Cannot set negative index "+x.localKey));
				}


				//Determine which event is happening, and prepare so we can do same handling after this block by inserting a placeholder
				//which moves the other items in the array we we don't overwrite
				if(!event.add){		
					event.evt='change';
				}else{
					event.evt='new';
					this._private.data.splice(x.localKey,0,'__placeholder__'); 
				}


				//Do the actual setting, and check if we're setting a smart child...
				var emitHere=commonSet.call(this,x,event,arguments[3]);
			
				//The array just got longer, add an enumerable getter to this object. Do this after we've succesfully set
				if(event.evt=='new' && this._private.options.addGetters)
					this._setPublicGetter(this.length-1); //call length again to get the new length
				
				if(emitHere){
					//...in which case that child will run the following...
					tripleEmit.call(this,event); 
				}

				return event.old;

			}






			/*
			* Remove single item from the array
			*
			* @param number i 		The index to remove at
			* @opt object event
			*
			* @emit delete
			*
			* @throw TypeError
			*
			* @return mixed|undefined 		The removed item, or undefined if none existed in the first place
			*/
			SmartArray.prototype.delete=function(i,event){

				i=cX.forceType('number',i);
				
				var l=this.length;
				if(!l || i>=l)
					return undefined

				//Make sure we have an event object to emit later...
				event=((event && typeof event=='object') ? event : {});

				let oldValue=this.get(i);
					
				if(this._private.options.children=='smart' && typeof oldValue=='object'){
					//Delete the smart child. This will not delete the index, which is why we slice vv
					this._private.deleteSmartChild(i); //will also log
				}else{
					if(arguments[2]!=NO_LOG_TOKEN)
						this._log.trace(`Deleting index ${i}:`,cX.logVar(oldValue));
				}
				
				this._private.data.splice(i,1)[0];

				//The array just got shorter, remove getter from this object
				if(this._private.options.addGetters)
					delete this[this.length];//yes, call this.length again...

				tripleEmit.call(this,Object.assign(event,{evt:'delete',key:i,old:oldValue,value:undefined}));
				return oldValue;

			}



			/*
			* Remove single item from the array given it's value
			*
			* @param any|function value 	@see this.findIndex()	
			*
			* @emit delete
			*
			* @throw TypeError
			*
			* @return mixed|undefined 		The removed item, or undefined if none existed in the first place
			*/
			SmartArray.prototype.extract=function(value,event={}){
				let i=this.findIndex(value);
				if(i>-1){
					return this.delete(i,event,arguments[2]);
				}else{
					return undefined;
				}
			}


			/*
			* Loop over the items backwards (which enables deleting without messing up the index)
			*
			* @param function fn
			*
			* @throw TypeError
			*
			* @return void
			*/
			SmartArray.prototype.forEachBackwards=function(fn){
				cX.checkType('function',fn);
				let i=this.length-1
				for(i;i>=0;i--){
					fn.call(this,this.get(i),i,this);
				}
				return
			}

























			/*
			* Move an item in the array to another position
			*
			* @param number|array	from 	Current index of item. Possibly a nested key.
			* @param number|string 	to 		New index of item, or '+'/'-' to move up/down by 1, or 'first'/'last'
			*
			* @emit move 		*NOTE* if this._private.options.moveEvent==true
			* @emit set,delete 	*NOTE* if this._private.options.moveEvent==false
			*
			* @throw <ble TypeError>
			* @throw <ble RangeError> 	If $to or $from is outside the range of the array. NOTE: this does not
			*							  happen if $to is a string.
			* @throw <ble EINVAL> 		If $from or $to couldn't be converted into a numbers
			* @throw <ble EMISSMATCH> 	If $from points us to an object
			*
			* @return boolean 	True if a move occured, else false (ie. moved to same spot)
			*/
			SmartArray.prototype.move=function(from,to,event={}){
				event=event && typeof event=='object' ? event:{};
				let types=cX.checkTypes([['number','array'],['number','string']],[from,to])

				//First we need the deepest smarty since emitting has to happen from him (even if he's a SmartObject)
				var smarty=this.getDeepestSmarty(from);
				if(smarty!=this){
					this._log.debug("Will be manipulating nested smarty @"+from._nestedKeys_);
				}
				
				//Then we need the live array that we'll be working on AND the actual number index we'll be moving from
				var target=smarty._private.data,commonBase;
				if(types[0]=='array'){
					//Get the last [what should be a] number
					let f=from.pop(); 
					commonBase=from; //Will be used at bottom on both 'from' and 'to'
					from=Number(f);
					if(isNan(from)){
						this._log.makeError("Invalid source (arg #1):",f).throw("EINVAL");
					}

					//If anything is left, get what should be an array
					if(from.length){
						target=smarty.get(from);
						if(Array.isArray(target)){
							this._log.makeError(`The nested key ${from.join('.')} should have pointed to an array, got:`)
								.addExtra(target).throw("EMISSMATCH");
						}
					}
				}


				//Ok now we have 2 keys and a target, let's make sure they work together...

				var l=target.length;
				if(from<0||from>=l){
					this._log.makeError(`Valid indexes 0-${l-1}, arg #1 was: ${from}.`).throw('RangeError');
				}
				
				if(types[1]=='string'){
					let m=to.match(/^(\+*)(\-*)(\d*)$/)
					if(m && !(m[1] && m[2])){ //don't match if string contains both + and -
						let sign=m[1]||m[2];
						to=sign.charAt(0)+(m[3]||sign.length)
						to=from+Math.round(cX.stringToNumber(to)); //throws
					}else if(to=='last'){
						to=l-1
					}else if(to=='first'){
						to=0
					}
					if(isNaN(Number(to)))
						this._log.makeError("Invalid destination (arg #2):",to).throw('EINVAL');
					to=Number(to);


					//In the context of +/-, if the bounds are exceeded, just use the bounds...
					if(to<0){
						to=0
					}else if(to>=l){
						to=l-1; //since we're only moving an item, the last index will stay the same, ie. 1 less than length
					}
				}

				//Unlike ^^ where we just adjust to bounds, if an explicit number is given and we're outside bounds -> range error!
				if(to<0 || to>=l){
					this._log.makeError(`Valid indexes 0-${l-1}, arg #2 translated to: ${to}.`).throw('RangeError');
				}


				if(from==to){
					this._log.note("Both args had same value, nowhere to move");
					return false;
				}

				//If we got a commonBase^, turn our keys back into arrays, but before we do so
				//store them on the event as numbers
				event.from=from
				event.to=to
				if(commonBase){
					from=commonBase.concat(from);
					to=commonBase.concat(to);
				}

				//Are we using custom *move* event, or set+delete?
				if(this._private.options.moveEvent){ 
					event.evt='move';
					event.key=from; //may be array, may be number. Used by childListener() as event moves up smarties
					var value=event.value=target.splice(event.from,1)[0];
					target.splice(event.to,0,value);
					tripleEmit.call(smarty,event);
				}else{
		//TODO 2020-03-31: SmartArray can't handle nested keys. We should always use moveEvent
					event.src=event.src||'move';
					event.add=true;
					smarty.set(to,smarty.delete(from,event),event);
				}

				return true;
			}














			/*
			* Add one or more items to array a at @index. 
			*
			* NOTE: doesn't work like normal array splice, there is no deleting here...
			*
			* @param number  	index
			* @param mixed   	...values 	One or more values to insert. @see this.set()
			*
			* @emit set, delete (via this.slice if value==null)
			*
			* @throw TypeError
			* @return primitive|array 	@see @return of this.set()
			*/
			SmartArray.prototype.splice=function(index,...values){
				// console.warn("SPLICE GOT:",index,values);
				if(values.length==1)
					return this.set(index,values[0],true);
				else
					return values.reverse().map(value=>this.set(index,value,true));
			}



			/*
			* Add multiple items to the end of _private.data
			*
			* @param array arr
			*
			* @emit set
			*
			* @return array 	Array of @see @return this.set()
			*/
			SmartArray.prototype.concat=function(...arrays){
				//If the first one isn't an array, throw! the rest can be whatever
				cX.checkType('array',arrays[0]);

				for(let arr of arrays){
					if(Array.isArray(arr)){
						var l=arr.length
						if(!l){
							this._log.trace("Concat called with empty array");
							return undefined;
						}else{
							this._log.debug("Concating multiple values:",arr);
							arr.forEach(value=>this.push(value)); //don't change to forEach(this.push), it'll reset the scope
							return this;
						}
					}else if(arr){
						this._log.warn('Skipping: ',arr);
					}else{
						this._log.trace('Skipping: '+String(arr))
					}
					
				}
			}
			/*
			* Alias for concat
			*/
			SmartArray.prototype.assign=SmartArray.prototype.concat







			/*
			* Replace current array with new one. Attempt to determine the actual changes, so events are only 
			* emitted for these changes
			*
			* @param array  arr
			* @param string mode 		@see SmartProto.empty
			*
			* @emit set,delete
			*
			* @throw TypeError
			* @return array|undefined 	Undefined if nothing changed (ie. it already contained the same data), else a copy of the 
			*							private data before deleting it all
			*/
			SmartArray.prototype.replace=function(arr,mode='force'){
				cX.checkTypes(['array','string'],[arr,mode]);
				
				//If we're replacing with an empty array...
				if(!arr.length)
					return this.empty(mode);

				//First try to check if the whole array is the same...
				var old=this.get(); //value to get returned

				if(cX.sameValue(old,arr))
					return undefined;
				
				if(this._private.options.smartReplace){
					//Any issues that happen in here will essentially mess up the order of things so we'll want to stop
					//doing stuff right away... how we handle it is up to the @mode
					try{
						//Then try to check if only the first/last item has been changed
						if(Math.abs(this.length-arr.length)==1){
							var min=Math.min(this.length,arr.length);
							var action=arr.length>min?'add':'delete';

							if(cX.sameValue(this.get(0),arr[0])){ //the first items are the same
								if(cX.sameValue(this.slice(0,min),arr.slice(0,min))){ //the first x items are the same
									//An item on the end has been added/removed, check which and replicate
									if(action=='add')
										this.push(arr.pop());
									else
										this.pop();
									return old;
								}
							}else if(cX.sameValue(this.last(),arr[arr.length-1])){ //the last items are the same
									// console.warn('old end',this.slice(-1*min))
									// console.warn('new end',arr.slice(-1*min))
								if(cX.sameValue(this.slice(-1*min),arr.slice(-1*min))){ //the last x items are the same
									// console.warn("REMOVING THE FIRST ITEM");
									//An item at the begining has been added/removed, check which and replicate
									if(action=='add')
										this.unshift(arr.shift());
									else
										this.shift();
									return old;
								}
							}
						}


						//Loop through and check for all mismatches, applying changes each time we find something. Ie. this 
						//will not be able to spot smth that's moved more than 1 step, instead it will delete and re-create that, 
						//but everything else should be fixable...
						var i=0,c=0,a=0,d=Math.max(this.length,arr.length)*2;
						while((c<this.length || a<arr.length) && i<d){
							try{
								let curr=this.get(c);
								// console.log(`LOOP:${i}   a:${a}=${arr[a]}    c:${c}=${curr}`);
								if(c>=this.length){
									//If we've gotten to the end of the current array, add anything left in the new array
									this.concat(arr.slice(a));
									break;
								}else if(a>=arr.length){
									//If we've gotten to the end of the new array, delete anything remaining in the current
									while(this.delete(c)){}
									break;
								}else if(cX.sameValue(curr,arr[a])){
									c++;
									a++;
								}else{
									if(cX.sameValue(curr,arr[a+1])){
										if(cX.sameValue(this.get(c+1),arr[a])){
											this.move(c,c+1);
											c+=2;
											a+=2;
										}else{
											this.set(c,arr[a],true); //true==insert
											a++;
											c++;
										}
									}else{
										this.delete(c);
									}			
								}
								i++; //as a safety, quit when we've looped twice the number of times as the longest array
							}catch(err){
								// this._log.warn(`Stopped on loop ${i}.`);
								// throw err;
								this._log.makeError(`Stopped on loop ${i}.`,err).throw();
							}
						}
					}catch(err){
						// console.warn(2,err);
						let msg=`Failed to replace data gracefully`;
						if(mode=='panic')
							this._log.throw(msg+', exiting right away. ',err);
						else
							this._log.error(msg,err);

					}
				


					//After all the changes ^^, make sure we have the correct data, else go drastic and delete everything and re-add
					var res=this.get();
					if(!cX.sameValue(res,arr)){
						this._log.warn('BEFORE:',old);
						this._log.warn('GOAL:',arr);
						this._log.warn('AFTER:',res);
						if(mode=='panic'){
							this._log.throw("Failed to replace data. See above for result.");
						}else{
							this._log.warn("Failed to replace only changes (see above for result). Deleting and re-setting instead.");
							this.empty(mode); 
							this.concat(arr); //will only run if there are no errors or mode=='force'
						}
					}

				}else{
					this.empty(mode);
					this.concat(arr); //will only run if there are no errors or mode=='force'
				}

				return old;

			}










			/*
			* Add single item to end of array, @see this.add(@value,false)
			*
			* @return bool 			True if changes were made, else false
			*/
			SmartArray.prototype.push=function(value){
				return this.add(value,false);
			}

			/*
			* Add single item to beginning of array, @see this.add(@value,true)
			*
			* @return bool 			True if changes were made, else false
			*/
			SmartArray.prototype.unshift=function(value){
				return this.add(value,true);
			}



			/*
			* Add single item to begining/end of array. 
			*
			* @param primitive  value
			* @param bool 		first 	Default false. If true the value is added to beginning of array
			*
			* @emit splice, event
			*
			* @throw TypeError
			* @return bool 			True if changes were made, else false
			*/
			SmartArray.prototype.add=function(value,first=false){
				if(value===null){//prevent deleting first item
					this._log.warn(`Value was null. If you mean to delete ${first?'first':'last'} item of array, if so use splice explicitly`)
					return false;
				}

				return this.set(first ? 0 : this.length ,value,true)==null; //null=>item was added, undefined=>nothing was added, any other value should not happen 
			}








			/*
			* Remove a single item from the begining of array. 
			*
			* @emit delete,event 
			*
			* @throw TypeError
			*
			* @return mixed|undefined 		The removed item, or undefined if none exists
			*/
			SmartArray.prototype.shift=function(){
				if(this.length)
					return this.delete(0);
				else
					return undefined;
			}

			/*
			* Add single item to end of array. NOTE: This is only a shortcut for slice(last), as such the
			* event is still 'slice')
			*
			* @emit slice,event 
			*
			* @throw TypeError
			*
			* @return mixed|undefined 		The removed item, or undefined if none exists
			*/
			SmartArray.prototype.pop=function(){
				// console.log(this)
				// return this.delete(this.length-1);
				if(this.length)
					return this.delete(this.length-1); //use getter defined on proto
				else
					return undefined;
			}


			SmartArray.prototype.last=function(){
				return this.get(this.length-1);
			}










			/*
			* Get the index of the first value that satisfies a test
			*
			* @param mixed test 	A function that will be .call(this,item,index) or a any value that will be 
			*							tested === against each item
			*
			* @return number 		The index or -1
			*/
			SmartArray.prototype.findIndex=function(test){
				var i=0,l=this.length;
				if(typeof test=='function'){
					while(i<l){
						if(test.call(this,this._private.data[i],i))
							return i;
						i++
					}
				}else{
					while(i<l){
						if(test===this._private.data[i])
							return i;
						i++
					}
				}
				return -1;
			}

			SmartArray.prototype.find=function(test){
				var i=this.findIndex(test);
				return i==-1 ? undefined : this.get(i);
			}

			/*
			* Get all indices of values that satisfy a test
			*
			* @param mixed test 		A function that will be passed (item,index) or a any value that will be tested === against each item
			*
			* @return array[number] 	An array of numbers, or an empty array
			*/
			SmartArray.prototype.findIndexAll=function(test){
				var arr=[],i=this.length;
				if(typeof test=='function'){
					while(i--){
						if(test(this._private.data[i],i))
							arr.push(i);
					}
				}else{
					while(i--){
						if(test===this._private.data[i])
							arr.push(i);
					}

				}
				return arr;
			}



			//End of SmartArray
































		/************* Link smarties over uniSoc ************/


			/*
			* From the sending side, prepare props on the payload that will be used locally and remotely
			*
			* @param object payload  	The uniSoc "payload" object . This object will be appeneded.
			*
			* @param object x 				A single object with the following props:
			* 	@opt object payload			  
			*	@opt string|bool Tx           If truthy changes made here will be transmitted to the remote side.
			*	@opt string|bool Rx 		  If truhty changes made on the remote side will be	replicated here.
			* 
			* NOTE: Unless you specify true/false here, the defaults set when this instance was created will be used. If a bool
			*		is given, a random string will be generated 
			*
			* @return object $x
			*/
			SmartProto.prototype.prepareLink=function(x){
				cX.checkProps(x,{
					payload:['object']
					,Tx:['boolean','string','undefined']
					,Rx:['boolean','string','undefined']
				});



				//Do a sanity check on the payload, but not much more. Payload.data should at some point before sending be 
				//set to this.stupify(), but this early in the game it's either not set at all, or set to the request data, 
				//so we simply ignore it in this method.
				if(x.payload.err){
					this._log.throw("The passed in payload has .err set. Please delete that before calling this method.",x.payload);

				}else if(x.payload.smartOptions||x.payload.smartLink){
					this._log.makeError("Has the payload already been prepared, or was this method called on the receiving side?"
						,x.payload).setCode('EALREADY').exec().throw();
				}

				//...however a live version is needed to initLink(), so hide it on the payload (hidden props do not
				//get transmitted, but it will allow access when eg using autoLink() )
				Object.defineProperty(x.payload,'smarty',{value:this,configurable:true});


				
				//Then save the options to be used on the other side for creating their smarty. Even if we don't link, 
				//this will allow the other side to create a smarty
				x.payload.smartOptions=cX.subObj(
					this._private.options
					,['children','onlyType','moveEvent']
					,'excludeMissing'
				)


				//Then we decide on linking. We default to what was set when this smarty was created, but
				//explicit params here take presidence. Also if strings where passed in here, they will be used
				//as the subject, else a random string is generated
				x.payload.smartLink={};
				var channel=cX.randomString();

				if(typeof x.Tx=='string')
					x.payload.smartLink.Tx=x.Tx;
				else if((x.Tx==undefined ? this._private.options.Tx : x.Tx)){
					x.payload.smartLink.Tx=channel;
				}

				if(typeof x.Rx=='string'){
					x.payload.smartLink.Rx=x.Rx;
				}else if((x.Rx==undefined ? this._private.options.Rx : x.Rx)){
					x.payload.smartLink.Rx=channel;
				}


				//Finally return the same object that was passed in
				return x;
			}





			/*
			* On both sides, start sending/receiving the changes of this smarty over a uniSoc
			*
			* NOTE: Remember to flip Rx and Tx on the receiving side!
			* NOTE: params can be passed in ANY order
			*
			* @param object x 					A single object with props unisoc and payload, optionally flip, TxInterceptor, options
			*  - or -
			* @param <uniSoc> unisoc			Any instance of uniSoc
			* @param object payload 			Object with prop .smartLink, ie. =="the unisoc payload"
			* @opt function TxInterceptor 		Can be used to change the outgoing data or prevent sending. It will be called 
			*									  with a single array: [event,key,value] which it can manipulate. If it returns
			*									  truthy the data will be sent, else dropped
			* @opt flag 'flip' 				 	Will reverse Tx and Rx, ie. used on the receiving side
			*
			* @throw <ble TypeError>
			* @throw <ble EINVAL> 		
			*									  
			* @return void
			*/
			SmartProto.prototype.initLink=function(...args){

				args=parseInitLinkArgs.call(this,args); //this => for logging purposes
				if(!args.Tx && !args.Rx){
					this._log.warn("Neither Rx or Tx set, not linking!",args.payload.smartLink);
					return;
				}

				//If this is the first time this smarty is linked, setup facilities to stop linking
				if(!this._private.links){
					this._private.links=[]
					this._private.links.killAll=()=>{
						this._log.info("Killing all uniSoc links on this smarty");
						this._private.links.forEach(obj=>obj.kill())
					}
				}

				
				var what=[];

				if(args.Tx){
					var transmit=(event)=>{
						//Prevent sending out events we just received on the same link (see Rx vv)
						if(args.Rx && event.Rx==args.Rx){
							//TODO: turn this level down when we know it's working
							this._log.highlight('green',"Not returning just received msg", event);
							return;
						}

						if(args.TxInterceptor && !args.TxInterceptor(event)){
							return;
						}
						
						//If we're still running we sent the event
						args.unisoc.send({subject:args.Tx,data:event})
					}
					let evt=this.on('event',transmit);
					
					//Now store the link and add ability to kill it
					this._private.links.push({Tx:args.Tx, evt, kill:()=>{
						this.removeListener(evt); //stop sending
						args.unisoc.send({subject:args.Tx,killedTx:true}) //tell the other end we've stopped
					}});
					what.push('sending')
				}

				if(args.Rx){
					let evt=args.unisoc.on(args.Rx,(event)=>{
						
						let oe="Other end stopped"
						if(event.killedTx){
							this._log.note(oe+" transmitting! Removing listener on unisoc...");
							this.removeListener(evt);
							return;
						}else if(event.killedRx){
							oe+=' listening'
							if(args.Tx){
								this._log.note(oe+", stopping our transmission");
								this._private.links.find(obj=>{if(obj.Tx==args.Tx){this.removeListener(obj.evt);return true;}})
							}else{
								this._log.debug(oe+", but we havn't been listening so...");
							}
							return;
						}


						//Prevent incoming events to be sent back out on the same link...
						if(Tx){
							event.Rx=args.Rx
						}
						event.src=event.src||'remote';
						return this.replicate.apply(this,event);
					});
					this._private.links.push({Rx:args.Rx, kill:()=>{
						this.removeListener(evt)//stop receiving
						args.unisoc.send({subject:args.Rx,killedRx:true}) //tell the other end we've stopped

					}}); 
					what.push('receiving');
				}

				what=what.length==1?what[0]+' only':'both directions!'
				this._log.info(`${args.payload.id}: Linked smarty, ${what}`,cX.subObj(args,['Tx','Rx']));
				return;
			}



			/* 
			* Break-out from initLink(). Allows args to be passed in any order 
			* @param array args
			* @return object 
			* @call(any with this._log)
			*/
			function parseInitLinkArgs(args){
				//Allow args to be passed in seperately or in a single object, but make sure the return obj we
				//build is not a live link to a passed in object since we'll be changing it vv
				var obj={};
				let no_u='Expected an instanceof uniSoc, none passed:';
				let no_p='Expected a payload object with prop smartLink, none passed:';
				if(args.length==1 && typeof args[0] =='object' && args[0].hasOwnProperty('unisoc') && args[0].hasOwnProperty('payload')){
					Object.assign(obj,args[0]);
					if(!obj.unisoc.isUniSoc)
						this._log.makeError(no_u,obj).throw('TypeError');
					if(!obj.payload.smartLink)
						this._log.makeError(no_p,obj).throw('EINVAL');

					obj.TxInterceptor = typeof obj.TxInterceptor=='function' ? obj.TxInterceptor : undefined; 
					obj.options = typeof obj.options=='object' ? obj.options : {};
				
				}else{
					//The first (and only one we care about) function will be called before each Tx, so it can alter the outgoing data
					obj.TxInterceptor=cX.getFirstOfType(args, 'function','extract');
					
					var i=args.findIndex(arg=>arg && arg.isUniSoc)
					if(i==-1)
						this._log.makeError(no_u,args.map(a=>cX.logVar(a,50))).throw('TypeError');
					obj.unisoc=args.splice(i,1)[0];

					i=args.findIndex(arg=>arg && arg.smartLink)
					if(i==-1)
						this._log.makeError(no_p,args.map(a=>cX.logVar(a,50))).throw('EINVAL');
					obj.payload=args.splice(i,1)[0]
					
					
					//Any remaining object in the args array are options
					obj.options=args.find(arg=>arg && typeof arg=='object')||{};
				}
				
				var {Tx,Rx}=obj.payload.smartLink;
				if(!cX.checkTypes([['string','undefined'],['string','undefined']],[Tx,Rx],true))
					this._log.makeError("Tx/Rx should be string/undefined, got:",cX.logVar(Tx),cX.logVar(Rx)).throw('TypeError');
				obj.Tx=Tx;
				obj.Rx=Rx;


				//Optionally flip Tx and Rx (always done if we're on the receiving end...)
				if(args.includes('flip')||obj.flip||obj.options.flip){
					let Rx=obj.Rx;
					obj.Rx=obj.Tx;
					obj.Tx=Rx;
				}

				return obj;

			}



			/*
			* Shortcut to send this smarty object and start transmiting events. 
			*
			* @param object x 				@see this.prepareLink()
			* 	@prop <uniSoc.Client> unisoc  Any instance of uniSoc
			*	@opt object payload 		  @see this.prepareLink()
			*   @opt string subject 		  @see this.prepareLink()
			*	@opt string|bool Tx           @see this.prepareLink()
			*	@opt string|bool Rx 		  @see this.prepareLink()
			*
			* @throws TypeError
			* @return Promise(void,err) 	Resolves when sending and linking has succeeded, else rejects
			*/
			SmartProto.prototype.sendAndLink=function(x){
				cX.checkType('object',x);

				//Check the prop that's only used here, the rest are checked in this.prepareLink()
				if(!x.unisoc || !x.unisoc.isUniSoc || typeof x.unisoc.send!='function'){
					this._log.throwType(".unisoc to be a <uniSoc.Client>",x.unisoc)
				}

				//Now create or use an existing payload
				if(!x.payload && !x.subject)
					this._log.throw("Expected a 'subject' or the 'payload', got neither",x);
				else if(!x.payload)
					x.payload={subject:x.subject};

				x.payload.data=this.stupify();

				//First prepare the payload by adding the link info etc...
				this.prepareLink(x);

				//...then send it...
				return x.unisoc.send(payload)
					.then(successfullySent=>{
						//...and if that was successful, initiate the link we prepared ^
						return this.initLink(x);
					})
			}




			/*
			* Shortcut to respond to a uniSoc request with this smarty and start transmiting events. 
			*
			* @param object x 				A single object with the following props:
			* 	@prop <uniSoc> unisoc		  Any instance of uniSoc
			* 	@prop object payload 		  The uniSoc payload.
			* 	@prop function callback 	  The uniSoc response-callback function
			*	@opt string|bool Tx           @see this.prepareLink()
			*	@opt string|bool Rx 		  @see this.prepareLink()
			*
			* @throws TypeError
			* @return Promise(void,<ble>) 	Resolves when sending and linking has succeeded, else rejects
			*/
			SmartProto.prototype.respondAndLink=function(x){
				try{
					cX.checkProps(x,{
						unisoc:'object'
						,payload:'object'
						,callback:'function'
					});
					
					let msg='any <uniSoc.Client> and a payload received on it';
					if(!x.unisoc.isUniSoc||!x.payload.id){
						this._log.throwType(msg,x.unisoc,x.payload);
					}else if(!x.unisoc.receivedRequests.hasOwnProperty(x.payload.id)){
						this._log.makeError(`Expected ${msg}, but the payload does not exist on uniSoc.receivedRequests.`
							,{received:Object.keys(x.unisoc.receivedRequests),payload:x.payload}).setCode("EINVAL").throw();
					}
					x.unisoc.log.info(x.payload.id+": Responding with smarty. Linking to follow...");

					//Add link info to the payloayd
					this.prepareLink(x);

					//Respond to the request with this smarty
					return x.callback(null,this.stupify()).then(responded=>{
						if(responded){
							//...and hook up events
							return this.initLink(x);
						}else{
							return this._log.makeError('Failed to transmit response').reject();
						}
					})

				}catch(err){
					return this._log.makeError(err).reject();
				}
			}





			function setupBroadcast(args){

	/*TODO 2020-03-02: 
		If we've already setup one link for a given smarty on a socket that's part of a server, it seems dumb not 
		have those events be a group so there is only one endpoint registered for it and the server can broadcast 
		instead of sending to each listener... which minimizes overhead when preparing send...

		The question is if it's at all more efficient to have a single broadcast??

		And if we do a broadcast we have to keep track of each sockets received things, since changes need to 
		go out to all but the incoming socket...
	*/
			}



		/******** 2 link-related functions used before we have an instance *******/
			/*
			* Create a smarty from an incoming uniSoc payload
			*
			* @param object payload 	The entire payload received by uniSoc
			*
			* @return <SmartArray>|<SmartObject>
			* @call(<uniSoc>)
			*/
			// function receiveSmarty(payload){
			// 	if(!this.isUniSoc)
			// 		cX._log.makeError('Call receiveSmarty() as a uniSoc instance').throw();

			// 	try{
			// 		cX.checkType('object',payload);
			// 		if(payload.smartOptions=='done'){
			// 			if(isSmart(payload.data))
			// 				return payload.data
			// 			else
			// 				throw "payload.smartOptions was already set to 'done', but .data was not a smarty";
			// 		}
			// 		cX.checkProps(payload,{data:['object','array'],smartOptions:'object', smartLink:'object'})
			// 	}catch(err){
			// 		this.log.makeError("Unexpected payload when trying to receive smarty:",payload,err).throw('EINVAL');		
			// 	}

			// 	payload.data=createSmarty(payload.data,payload.smartOptions);

			// 	//Prevent this method from being called again
			// 	payload.smartOptions='done';

			// 	payload.data.initLink(this,payload, 'flip');//this==uniSoc, flip==we want their Tx to go to our Rx
			// 	 //^logging happens inside

			// 	return payload.data;
			// }



			/*
			* Shorthand for requesting a smart object and hooking up the response
			*
			* NOTE: This method will not be necessary if you load uniSoc with the smart class passed in, in which case receiveSmarty()
			*		will be used automatically on all incoming
			*
			* @return Promise 		@see uniSoc.request, but response 'data' will be a smart instance
			* @call(<uniSoc>)
			*/
			// function requestSmarty(...args){
				
			// 	//The key to requesting a smarty is to pass along a callback (even if you just want a single response), 
			// 	//since the callback will get called with (err,data,payload) and we need that payload		

			// 	var argsObj=this.parseArgs.apply(this,args);

			// 	if(argsObj.callback){
			// 		//If one already exists, just wrap it so we can receiveSmarty() before calling it...
			// 		var callback=args.callback;
			// 		args.callback=(err,data,payload)=>{
			// 			if(err)
			// 				return callback(err,data,payload)
			// 			else{
			// 				try{
			// 					return callback(err,receiveSmarty(this,payload),payload)
			// 				}catch(e){
			// 					return callback(err,data,payload)
			// 				}
			// 			}
			// 		}
			// 		//...then request like normal
			// 		return this.request(argsObj);

			// 	}else{
			// 		//We want to return a promise...
			// 		var {promise,resolve,reject}=cX.exposedPromise();
			// 		argsObj.callback=(err,data,payload)=>{
			// 			if(err)
			// 				reject(err);
			// 			else{
			// 				try{
			// 					resolve(receiveSmarty(this,payload));
			// 				}catch(e){
			// 					reject(e);
			// 				}
			// 			}
			// 			//We're only expecting a single response, so cancel the callback after;
			// 			return 'cancel';
			// 		}
			// 		//Now request like normal, but resolve with our custom promise^
			// 		return this.request(argsObj).then(()=>promise);
			// 	}
			// }


			/*
			* Automatically link smarties when sending and receiving on a uniSoc. This function should be called after
			* a unisoc is created, and from that point on ALL smarties we transmit will be automatically linked.
			*
			* @param object x
			* 	@prop <uniSoc> unisoc		  Any instance of uniSoc
			*	@opt string|bool Tx           @see this.prepareLink(). Only affects smarties we transmit
			*	@opt string|bool Rx 		  @see this.prepareLink(). Only affects smarties we transmit
			*
			* @return void
			*
			* ProTip: The Tx/Rx passed in here are only the defaults, they can be overridden by the Tx/Rx set on the individual smarty
			* @exported
			*/
			let TxRx=['Tx','Rx'];
			function autoLinkUniSoc(x){
				let t=typeof x, errstr=`Expected a <uniSoc> or an object with .unisoc set, got a ${t}.`
				if(!x || typeof x!='object')
					throw new TypeError(errstr)

				var unisoc, autoLinkDefault={};
				if(x.isUniSoc){
					unisoc=x;
				}else if(x.unisoc && x.unisoc.isUniSoc){
					unisoc=x.unisoc
					Object.assign(autoLinkDefault,cX.subObj(x,TxRx));
				}else{
					throw new Error(`EINVAL. ${errstr} ${JSON.stringify(x)}`);
				}

				//When receiving responses
				unisoc.onresponse=function autoLinkSmarty_receive(payload){
					try{
						if(payload.smartOptions && payload.smartLink){
							
							unisoc.log.info("Response contained a smarty, but not initiating...");
							
							payload.data=createSmarty(payload.data,payload.smartOptions);
							delete payload.smartOptions; //just so the caller doesn't try to do it again

							//NOTE: we ignore passed in^ Tx and Rx here, it's up to the other side if they want to send us
							//updates or listen for our changes...
							payload.data.initLink(unisoc, payload, 'flip'); //flip=> what they send we receive
							  //^logs what is linked
						}
					}catch(err){
						unisoc.log.error(err,payload);
					}
				}

				unisoc.beforetransmit=function autoLinkSmarty_transmit(payload){
					try{
						//This will fire for all transmits, so first we have to check if it's even a smarty
						if(payload.data && payload.data.isSmart){
							let smarty=payload.data; //it WAS as smarty, so for clarity we rename it in here
							let who=payload.id+': '
							
							//We're auto-linking live smarties, but if someone tries to do it manually the above isSmart() shouldn't
							//be truthy and we shouldn't be here... so just make sure no duplication of efforts have been made...							
							if(payload.smartOptions||payload.smartLink){
								unisoc.log.warn(who+"Possible bug? Someone has partly prepared the payload for smart linking, but the data/smarty"
									+"is still live... Did someone forget something? Will not touch it here!",payload);
							}else{
								//Determine if/what we're going to link and log it
								let smartyOptions=cX.subObj(smarty._private.options, TxRx, 'excludeUndefined')
									,opts=Object.assign({},autoLinkDefault,smartyOptions)
									,logstr=`${who}Payload contained a smarty,`
									,which=(opts.Tx?(opts.Rx?'BOTH directions':'sending only'):opts.Rx?'sending only':false)
								;
								// console.debug('autolink options:',{result:opts,autoLinkDefault,smartyOptions});
								if(!which){
									unisoc.log.note(`${who}Payload contained a smarty, but it will not be linked.`)
								}else{
									unisoc.log.info(`${who}Preparing smart payload, ${which}`);
									opts.payload=payload; //prepareLink needs the entire payload too...
									smarty.prepareLink(opts);

									//Finally make the smarty stupid like we were talking about ^
									// console.log(smarty);
									payload.data=smarty.stupify();
									// console.log(payload.data);
								}
							}
						}
					}catch(err){
						unisoc.log.error(err,payload);
					}
				}

				unisoc.aftertransmit=function initSmartLink(payload){
					try{
						if(payload.smarty){
							payload.smarty.initLink(unisoc, payload);
						}
					}catch(err){
						unisoc.log.error(err,payload);
					}
				}
			}


		//Return the stuff we're exporting
		return {
			'Object':SmartObject
			,'Array':SmartArray
			,'isSmart':isSmart
			,'create':createSmarty
			,autoLinkUniSoc
		};


	}

}());
//simpleSourceMap=
//simpleSourceMap2=