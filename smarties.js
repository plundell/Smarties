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
		const libbetter=(dep.BetterLog ? dep : dep.libbetter) || missingDependency('libbetter');
		const BetterLog = libbetter.BetterLog        || missingDependency('BetterLog');
		const BetterEvents = libbetter.BetterEvents  || missingDependency('BetterEvents');
		const BetterUtil = libbetter.BetterUtil      || missingDependency('BetterUtil');
		const cX=(BetterUtil.cX ? BetterUtil.cX : BetterUtil);
// console.log('AAAAAAAAAAAAAAAAAAAAAAA');
// console.log(BetterEvents);

		//Token to pass around internally
		const NO_LOG_TOKEN={} //don't log, someone else has already done so
		const EXEC_LOCALLY_TOKEN={} //the action should be carried out by the current smarty


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
		* Like cX.varType() but SmartArray=>array SmartObject=>object
		*
		* @param any x
		* @return string   
		*/
		function dataType(x){
			let name=isSmart(x);
			if(name)
				return name.slice(5).toLowerCase() //SmartArray=>array SmartObject=>object
			else 
				return cX.varType(x);
		}

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
					smarty=new SmartArray(options);
			}
			
			smarty.assign(cX.copy(data));

			return smarty;
		}



		



		/********************************* SmartProto (not exported) **************************/


		SmartProto.defaultOptions={
		//Used by SmartProto
			defaultValues:null 	//Default values which are set by .reset() (which is called by constructor). Will be ignored if
								  //$meta is passed
			,meta:null 			//An object, if passed when creating an object it will run .init() at the end of the constructor. 
								  //Keys are default keys created by constructor, values are rules about that prop. overrides $defaultValues
			,onlyMeta:false 	//If true, only keys from $meta are allowed

			,constantType:false //If true, when a key is set, it can only be changed to the same type, or null or deleted

			,delayedSnapshot:0 	  //If set to number>0, a copy of all the data on the object will be emitted that many ms after 
								  //any event
			,children:'primitive' //accepted 'complex'=> allow obj/arr children (they should not be smart), 'smart'=> children 
								  //may be smart (either passed in or converted when setting) and their events extended 
								  //('new'/'delete' on child becomes 'change' on parent). Alternatively you can pass 'string',
								  //'number' or 'boolean' to limit primitive children further
			
			,addGetters:true    //if true, enumerable getters and setters will be added/removed when keys are set/deleted

			,assignmentWarn:true //Default true => if you write props directly on smarty without using .set(), warn! Use a number
								 //to have a check be performed on an interval 
			,assignmentFix:0 	//if >0 then makePropsSmart() will be run at that interval. NOTE: this overrides assignmentWarn

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
								  ProTip: If you eg. have a SmartArray containing SmartObjects (like a table structure) and you
								  		  want to know when a row is added but bubbleType=='nested' then all you do is check if
								  		  event.key is an array
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
			let beOptions=cX.subObj(options,Object.keys(BetterEvents.defaultOptions),'hasOwnProperty');
			BetterEvents.call(this,beOptions);


			//Set private variable that holds everything we need to access in various prototype methods, 
			//without making it enumerable so it doesn't show up when logging
			Object.defineProperty(this,'_private',{enumerable:false,value:{ 
				data:(this.isSmart=='SmartObject' ? {} : [])	
				,localKeyType:(this.isSmart=='SmartObject' ? 'string' : 'number') //By default we don't allow objects with numeric keys, for the sake of "same handling" since when
																				  //creating nested items string-keys create objects and number-keys create arrays... however you
																				  //could potentially manually change this without issue
				,options:options
				,reservedKeys:['_private','_log','_intercept']
			}}); 


			//Setup log, passing along the options ^^
			var logOptions=cX.subObj(options,Object.keys(BetterLog.defaultOptions),'excludeMissing');
			// console.log({options,logOptions})
			var log=new BetterLog(this,logOptions);
			Object.defineProperty(this,'_log',{enumerable:false,value:log});
			this._log.makeEntry('trace','Creating '+(logOptions.hasOwnProperty('name')?`smarty '${this._log.name}'`:'unnamed smarty with options:')
				,_options).changeWhere(2).exec();
			this._betterEvents.onerror=log.error;

			//Create a hidden prop onto which 2 methods can be set (.get and .set) to intercept and change/block requests
			//made of this smarty 
			//NOTE: This is NOT a security feature if the caller has direct access to this smarty
			Object.defineProperty(this,'_intercept',{value:{get:null,set:null,emit:null}});


			//Add snapshot if opted
			let d=this._private.options.delayedSnapshot;
			if(typeof d=='number' && d>0){
				this.setupSnapshot(d);
			}else if(d!==0){
				this._log.warn("Bad value for option 'delayedSnapshot':",d,this);
			}


			//Prepare for different children types. After this .children will be one of primitive/smart/complex/any
			setupChildren.call(this)
				

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
			if(this._private.options.assignmentFix>0){
				//one such case is if we want it fixed automatically
				this._log.note(`Fixing non-smart props every ${this._private.options.assignmentFix} ms. This ads overhead and should not be run in production`);
				setInterval(this.makePropsSmart.bind(this),this._private.options.assignmentFix)
			}else{
				let a=this._private.options.assignmentWarn
				if(a){
					let stack=(new Error()).stack
					let check=()=>{
						let list=this.listStupidProps();
						if(list.length){
							list.forEach(prop=>{
								this._log.makeEntryRaw('warn',`Prop '${prop}' was not set using .set(), ie. it will NOT be monitored.`
									,undefined,stack).exec();
							})
						}else{
							this._log.trace("Verified that all props are smart");
						}
					}

					//Allow a number to set an interval, while truthy just checks once...
					if(typeof a=='number'){
						this._log.note(`Checking for non-smart props every ${a} ms. This ads overhead and should not be run in production`);
						setInterval(check,a);
					}else 
						setTimeout(check,3000);
				}
			}



			//For the sake of not confusing which takes presidence, meta[key].default or defaultValues[key] we simply
			//don't allow both to be passed
			if(cX.isEmpty(this._private.options.meta))this._private.options.meta=SmartProto.defaultOptions.meta;
			if(cX.isEmpty(this._private.options.defaultValues))this._private.options.defaultValues=SmartProto.defaultOptions.defaultValues;
			if(this._private.options.meta && this._private.options.defaultValues)
				this._log.makeError("You cannot set both options.meta & options.defaultValues. options:",this._private.options).throw('EINVAL')
			else if(this._private.options.meta && typeof this._private.options.meta!='object')
				this._log.throwType("options.meta to be object/array",this._private.options.meta);
			else if(this._private.options.defaultValues && typeof this._private.options.defaultValues!='object')
				this._log.throwType("options.defaultValues to be object/array",this._private.options.defaultValues);


			//If we got meta... (checks inside...)
			setupMeta.call(this,this._private.options.meta);


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
		Object.defineProperty(SmartProto.prototype, 'constructor', {value: SmartProto});

		/*
		* Init stuff given options.children. Used by SmartProto() and receiveAndLink()
		* @param string children
		* @return void;
		* @call(<SmartProto>)
		*/
		function setupChildren(){
			var children=this._private.options.children;
			switch(children){
				case 'string':
				case 'number':
				case 'boolean':
				case 'primitive':
					this._private.expectedValTypes=children;
					this._private.options.children='primitive';
					break;
				case 'smart':
					this._private.childListeners=new Map();
					//no break
				case 'complex':
				case 'any':
					this._private.localKeyType=cX.makeArray(this._private.localKeyType,'array');
					if(children=='any')
						this._private.expectedValTypes='any';
					else
						this._private.expectedValTypes=['primitive','array','object'];

					this._private.options.children=children;
					break;
				default:
					this._log.throwCode("EINVAL","Invalid value for option 'children': ",children,this);
			}
			return;
		}

		/*
		* Change the rules for the children of this instance
		*
		* @param string to
		* @opt flag 'silent' 	Prevents anything from being emitted
		*
		* @return void
		*/
		SmartProto.prototype.changeChildren=function(to,silent=null){
			if(this._private.options.children==to)
				return;

			this._log.traceFrom(`Changing ${this._private.options.children} children to ${to}. Called `);
			//If we're moving away from "smart" then we'll need to remove the children first so the listeners 
			//get removed... 
			if(this._private.options.children=='smart' || silent=='silent'){
				var data=this.empty(silent=='silent'?'silent':'force');
			}else{
				data=this._private.data;
			}

			//...then we can change the settings
			this._private.options.children=to;
			setupChildren.call(this);


			//finally we assign the data back which will cause the new rules to apply
			if(silent=='silent'){
				for(let key in data){
					this.set(key,data[key],{noEmit:true});
				}
			}else{
				this.assign(data);
			}

			return;
		}

		/*
		* Init stuff given options.meta is any were passed. Used by SmartProto() and receiveAndLink()
		* @param object|undefined meta 
		* @return void;
		* @call(<SmartProto>)
		*/
		function setupMeta(meta){
			if(meta){
				//...we'll be creating new defaultValues, but options.meta WILL NOT CHANGE (important for getSmartOptions() to know)
				this._private.options.defaultValues={};
				
				//Get the "global default"(which we default to null if it doesn't exist)
				const _default=((meta.hasOwnProperty('*') && meta['*'].hasOwnProperty('default')) ? meta['*'].default : null)

				for(let key of Object.keys(meta)){
					let m=meta[key];
					//Set the default value on...
					this._private.options.defaultValues[key]=(m.hasOwnProperty('default') ? m.default : _default);

					//Make sure that some props are correct/work together
						if(m.prepend){
							if(m.type && m.type!='string')
								this._log.makeError("If using meta.prepend then meta.type needs to be string, not:",m.type).throw('EMISMATCH');
							m.type='string';
						}

						cX.checkType(['undefined','function'],m.cleanFunc);
				}
			}
			return;
		}





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
			if(!isSmart(this)){
				BetterLog._syslog.throw('SmartProto.toJSON() called in wrong context, this: ',this);
			}
			console.log()
			return this._private.data;
		}

		/*
		* The string version of a smarty is a JSON string
		*/
		SmartProto.prototype.toString=function(){
			if(!isSmart(this)){
				BetterLog._syslog.throw('SmartProto.toString() called in wrong context, this: ',this);
			}
			return JSON.stringify(this._private.data);
		}




		SmartProto.prototype.instanceof=function(x){
			return isSmart(x)==this.constructor.name;
		}



	//When smarties get nested, actions may sometimes refer to nested smarties, in which case we want to find it and call on it instead.



		/*
		* Get the deepest nested Smarty that has options.children!='smart'. 
		*
		* @param array|string|number nestedKeys 	If string|number then this is returned, else we move down, stoping when children!='smart'. 
		*												The array will then contain all remaining keys (at least 1). 
		*												NOTE: if array it gets altered
		* @opt bool mustExist 		                Default false. If true and the whole key (except the last one) doesn't exist, throw!
		* @opt function mustBe   	                Default null => get any smarty. Else constructor for smarty we want
		*
		* @internal <SmartObject>|<SmartArray> parent 	
		*
		* @throw <ble TypeError> 	$nestedKeys wrong type
		* @throw <ble NoMatch> 		Could not find smarty of requested type
		* @throw <ble ENOENT> 		The full key didn't exist
		*
		* @return <SmartObject>|<SmartArray> 	
		*/
		SmartProto.prototype.getDeepestSmarty=function(nestedKeys, mustExist=false,mustBe=null){
			
			//Quickly return if key isn't an array
			if(!Array.isArray(nestedKeys))
				return this;


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

			//...then if we care about the kind, we work our way back up until one matches $mustBe		
			if(mustBe && typeof mustBe=='function'){
				let parents=nestedKeys._nestedValues_
				let keys=nestedKeys._nestedKeys_
				while(!(smarty instanceof mustBe)){
					if(parents && parents.length){
						smarty=parents.pop();
						nestedKeys.unshift(keys.pop()); //return keys... the length may be checked vv
					}else{
						(log||this._log).makeError(`Could not find a ${mustBe.constructor.name}.`).setCode('ENOMATCH').exec().throw();
					}
				}
			}
			
			//If we want the entire path to exist, make sure...
			if(mustExist && nestedKeys.length>1){
				(log||this._log).makeError(`The rest of the nested key doesn't exist @${nestedKeys._nestedKeys_.join('.')}:`
					+` ${nestedKeys.join('.')}`).setCode('ENOENT').exec().throw();
			}
			
			//At this point we have a smarty to return. It's either the right everything, or we don't care
			//what it is... but it is a smarty
			return smarty;
		}



		/*
		* Check if the action should be executed on a nested smarty, in which case do so, else flag that it should be done locally
		*
		* @param string method
		* @param object _arguments 	The 'arguments' object from the calling func
		*
		* @return any|EXEC_LOCALLY_TOKEN 	The return value from the nested smarty (which should be be returned by whoever called
		*									this function) or the EXEC_LOCALLY_TOKEN
		*/
		function callOnDeepest(method,_arguments){
			
			//Make sure to copy a array keys since vv alters them and we don't want external parties having to deal with altered keys
			_arguments[0]=cX.copy(_arguments[0]);

			var child=this.getDeepestSmarty(_arguments[0]); //this will alter keys if it finds a child

			//If a child exists, then said child should execute, not us
			if(child!=this){
				return child[method].apply(child,_arguments); //call all args (incl. keys which has now been altered)
			}else{
				return EXEC_LOCALLY_TOKEN;
			}
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
		* This method is called at the begining of .set() and .delete(), AFTER callOnDeepest() (ie. we know that the
		* action should be executed on the local smarty (but the action could be to alter a nested complex value, or 
		* create new nested smarties...))
		*
		* @param string|number|array key
		* @opt object event
		*
		* @return object 		The $event or a newly created on, with .key and .old set
		*/
		function commonPrepareAlter(key,event){

			//If an array-key containing a single item was passed then just grab that item...
			if(Array.isArray(key)){
				if(key.length==1){
					var localKey=key=key[0];
				}else if(this._private.children=='primitive'){
					this._log.throwCode('TypeError','Complex keys not allowed on smarties with primitive children.',key)
				}else{
					localKey=key[0]
					var nestedKeys=key.slice(1)
					key.toString=function(){return this.join('.')}; //So we can always handle like string
				}
			}else{
				localKey=key;
			}
			
			//Make sure we have the right key to set locally, forcing eg '1' => 1
			cX.forceType(this._private.localKeyType,localKey);


			if(this._private.reservedKeys.includes(localKey))
				this._log.throw(`Key '${key}' is reserved on smarties, cannot ${method}.`);


			//Make sure we have an event...
			event=((event && typeof event=='object') ? event : {});

			//Allow some props to imply the evt is new... (used by SmartArray but hey, we can do it here...)
			if(event.add||event.insert||event.append)
				event.evt='new'

			//...then populate it with some basics...
			event.key=key;
			event.old=(event.evt=='new' ? undefined : this.get(key)); //evt==new is only necesarry when inserting into middle of array (ie. index does exist)

			//...and with a hidden prop for internal use. NOTE: when creating smarties recursively this will already exist on the event, so keep
			//any keys not set here
			Object.defineProperty(event,'__smarthelp__',{writable:true,configurable:true,value:Object.assign({},event.__smarthelp__,{
				localKey
				,nestedKeys //will be undefined if not array^
				
				,children:this._private.options.children //set here ONLY so it's included when logging

				,evt:event.evt //since the same event is passed around and thus event.evt may change
				,old:event.old //since the same event is passed around and thus event.old may change
			})});


			return event;

		}





		/*
		* Make sure key and value are the correct types for set() function, taking into account option 'children'
		*
		*
		* @param mixed 	key 	String, number or array. Limited if @add!=undefined to number/array
		* @param mixed 	value 	The value to set. Limited by _private.options.children
		* @opt object 	event 	Any event passed in from external callers. If none is passed commonPrepareAlter will create one
		*
		* @throws TypeError
		* @return object 		The passed in $event or a newly created one. Will be emitted after setting. Contains secret
		*						prop __smarthelp__ which is deleted before emitting.
		*
		* @sets event.key*2(in begining & final at end), event.old (final), event.value (temp, reset by commonSet)
		* @call(<SmartArray>|<SmartObject>)
		*/
		function commonPrepareSet(key,value,event){
			// this._log.traceFunc(arguments);
			var x;
			try{
				//Check the key and make sure we have an event
				event=commonPrepareAlter.call(this,key,event);
				x=event.__smarthelp__;

				//Check the value type...
				// console.log(this._private.expectedValTypes,value)
				x.valType=cX.checkType(this._private.expectedValTypes,value);
				if(smartType(value)=='smart')
					x.valType='smart';

				
				//...and if further meta options have been set, apply those too (yes, this may do a second type check but otherwise
				//we would have to check if a meta[key].default was set, else use expectedTypes, and we'd have to worry about
				//setting e.valType... just make it easy on ourselves)
				if(this._private.options.meta){
					value=applyMeta.call(this,key,value);
				}

				//Add the value to the event
				event.value=value
				
				//Then check if anything has changed, in which case we return early
				if(event.evt!='new' && cX.sameValue(event.old,event.value)){
					//^if we're adding we NEVER return here because this.set() will then end with evt='none'

					//2019-06-28: This log is good when figuring out why event is not firing. ie. don't add NO_LOG_TOKEN here, 
					//				if you don't want to see it, then don't print it
					this._log.trace(`Ignoring same value on '${event.key}': `,event.old);
					event.evt='none';					
				}

				return event;

			}catch(err){
				// event.evt='error';//2020-03-31: Either we do this everywhere or nowhere... ie. not implemented yet
				this._log.throw('Failed to set.',err,{this:this,event,helper:x});
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
		function commonSet(event){
			var x=event.__smarthelp__;
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
			//2020-06-18: Adding 'null' as an acceptable thing to change to
			//2020-06-18: changing from varType to dataType (defined here) which means SmartArray==array
				if(this._private.options.constantType && event.value!=null && dataType(event.old)!=dataType(event.value) ){
					throw this._log.makeError(`Cannot change type any prop, incl. '${event.key}': ${cX.logVar(event.old)} --> ${cX.logVar(event.value)}`);
				}
			}

			//If we're intercepting...
			if(typeof this._intercept.set=='function'){
				try{
					this._intercept.set.call(this,event); //this method can change the event in any way it pleases...
				}catch(err){
					this._log.throwCode('intercept',`Prevented ${event.evt} ${event.key}.`,event,err);
				}
			}

			try{
				var errMsg='Failed to '
				var c=this._private.options.children; //shortcut

				if(event.evt=='new'){
					if(arguments[2]!=NO_LOG_TOKEN)
						this._log.trace(`Setting new key '${event.key}' to: ${cX.logVar(event.value)}`);

					if(c=='smart'){
						errMsg+='create smarty on key '
						event.value=_newSmart.call(this,event); 

					
					}else if(x.nestedKeys){
						errMsg+='set nested key '
						cX.nestedSet(event.old,x.nestedKeys,event.value,true); //true==create path if needed.
					
					}else{ 
						errMsg+='set key '
						this._private.data[x.localKey]=event.value;
					}

				}else{ //evt=='change'
					errMsg+='change '
					if(arguments[2]!=NO_LOG_TOKEN)
						this._log.trace(`Changing key '${event.key}': ${cX.logVar(event.old)} --> ${cX.logVar(event.value)}`);

					if(x.nestedKeys){ //chaning smth non-local
						errMsg+='nested '
						if(c=='smart'){
							errMsg+='smarty '

							//Recursively .set() on the local smart child...
							this.get(x.localKey).set(x.nestedKeys,event.value,event,NO_LOG_TOKEN); //we've already logged ^^

							//...then return false to prevent .set() from emitting anything since the last child will emit
							//and then that event bubbles up through us getting changed on the way
							return false; 

						}else{//c=='complex' 
							errMsg+='complex '
							//Change the nested value of the live local object
							cX.nestedSet(this.get(x.localKey),x.nestedKeys,event.value,true); //true==create path if needed.
						}

					}else{//changing something local
						errMsg+=`local ${smartType(this.get(x.localKey))} prop`
						if(c=='smart'){
							event.value=_changeSmart.call(this,x);
						}else{ //both primitive and complex children work the same when setting a local value, even if said value is complex
							this._private.data[x.localKey]=event.value;
						}
					}

				}
			}catch(err){
				this._log.throw(`${errMsg}'${event.key}':`,x,err);
			}

			return true;
		}



		/*
		* Set a new local smart child. Works for both SmartArr and SmartObject.
		*
		* @param object event 	The object returned from commonPrepareAlter(). 
		*
		* @return mixed 		The new value which should be set on event.value
		*/
		function _newSmart(event){
			var x=event.__smarthelp__
			if(x.nestedKeys){
				//Determine if the first key is a number or string, choosing arr/obj accordingly
				var childConstructor=(isNaN(Number(x.nestedKeys[0]))?SmartObject:SmartArray);

				//If this is the first smarty to be created, make a note of it so we can revert() by just deleting it
				if(!x.revertNewSmarty)
					x.revertNewSmarty={smarty:this,key:x.localKey}

				//Recursively create new objects
				return setSmartChild.call(this,x.localKey,childConstructor).set(x.nestedKeys,event.value,event); 
				 //^REMEMBER, when 'event' is passed to .set() event.__smarthelp__ will be replaced, so after this 
				 //           you need to have a copy of __smarthelp__ if you want to use the current one... which
				 //           is known to and made use of by .set() when assigning public accessors
			}

			//The following 2 cases we'll have to create a new child, set data on it, then start listening to it,
			//so just determine the constructor for now...
			if(x.valType=='array'){
				return setSmartChild.call(this,x.localKey,SmartArray, event.value);

			}else if(x.valType=='object'){
				return setSmartChild.call(this,x.localKey,SmartObject, event.value);


			//The value is already a smarty, no need to create, just set and listen
			}else if(x.valType=='smart'){
				return setSmartChild.call(this,x.localKey,event.value); 

			}else{
				this._private.data[x.localKey]=event.value; //Set primitive value direct on this object
				return event.value;
			}
		}

		/*
		* Change an existing local smart child
		*
		* @param object event	The object returned from commonPrepareAlter() which ultimately contains the new smart child
		*
		* @return mixed 		The new value which should be set on event.value
		*/
		function _changeSmart(event){
			var x=event.__smarthelp__
			switch(x.valType){	
				//If we get a regular object we have to create a new smart object
				case 'object':
				case 'array':
					var child;
					//If the old value used to be the wrong kind of smart, delete it
					var childConstructor=(x.valType=='object'?SmartObject:SmartArray);
					if(isSmart(event.old)){ 
						if(x.valType!=(event.old instanceof SmartObject ? 'object' : 'array')){
							this._log.note(`Replacing existing ${event.old.constructor.name} with ${childConstructor.name} on key '${x.localKey}'`)
							this._private.deleteSmartChild(x.localKey); 
						}else{
							child=this.get(x.localKey)
						}
					}
					
					//In 2 of 3 cases ^^ we want to...
					if(!child){
						// ...create a new child and set all the values on it
						return setSmartChild.call(this,x.localKey,childConstructor,event.value); 
						
					}else{
						//Change the content of the existing smarty
						event.old=child.replace(event.value);
						return child; 
					}



				//If we get a smart object we set that here, even if that means removing the existing one
				case 'smart':
					if(isSmart(event.old)){//implies smart since options.children==smart
						this._log.note(`Replacing existing ${event.old.constructor.name} with passed in ${event.value.constructor.name} on key '${x.localKey}'`)
						this._private.deleteSmartChild(x.localKey); 
					}
					return setSmartChild.call(this,x.localKey,event.value);

				default: //this should be any primitive value
					this._private.data[x.localKey]=event.value;
					return event.value;
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
		* @return <SmartObject>|<SmartArr>  The child having just been set (and possibly just created)
		* @call(<SmartObject>|<SmartArr>)   The parent onto which the child should be set
		*/
		function setSmartChild(key,child,data){

			//Create child if necessary
			if(cX.checkType(['<SmartArray>','<SmartObject>','function'],child)=='function'){		
				this._log.debug(`Will create nested ${child.name} on key '${key}'`);

				//Copy the options from this object (so they aren't ref'd together). 
				var options=cX.copy(this._private.options);
				 //^NOTE: this will also copy any options relating to the underlying BetterEvents
				
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
				  //^this will log a trace with the options...

			}else{
				this._log.debug(`Setting existing ${child.constructor.name} on local key '${key}'`);

			}

			//If we got data to set, do so before we start listening to it...
			if(!cX.isEmpty(data)){
				child.assign(data); //future note: assign will log...
			}


			//First listen to changes from the child. This listener changes the live event object so we... vv
			var self=this
			var childListener=(event)=>{
				try{
					//First we need to get the local key, which is straighforward for objects, but may have changed for arrays
					var localKey= (self._private.data[key]==child ? key : self.findIndex(child))

					//Now check what type of bubbling we do
					if(self._private.options.bubbleType=='nested'){

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
					tripleEmit.call(self,event);
				}catch(err){
					self._log.error(`Failed to propogate event from child smarty originally set on key '${key}'`,{self:cX.logVar(self),child:cX.logVar(child),event},err);
				}

			}

			//...set it to run AFTER any listeners on the child itself
			child.addListener('event',childListener,'+'); //+ => run at defaultIndex+1, ie. after the "normal" stuff

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
		function deleteSmartChild(key,NO_LOG){
			//Get the child at that key and make sure it's smart
			var child=this.get(key);
			if(isSmart(!child)){
				this._log.throw(`Key '${key}' is not a smart child:`,child);		
			}
			
			//Log if not supressed
			if(NO_LOG!=NO_LOG_TOKEN)
				this._log.info(`Deleting ${child.constructor.name} from local key '${key}'`);
			

			//Remove the listener from the child (future note: yes, the listener is on the child, but it changes stuff on this/us/parent)
			child.removeListener(this._private.childListeners.get(child),'event');

			//Remove the child
			delete this._private.data[key];

			//Return the child
			return child;
		}



		/*
		* Reverse the changes of an event about to be emitted
		*
		* @param object event
		*
		* @return void
		* @call(<SmartProto>)
		*/
		function revert(event){
			
			//First create a new event to pass along so the reverting action doesn't emit anything	
			let revEvt={noEmit:true}
			switch(event.evt){
				case 'new':
					let x=event.__smarthelp__.revertNewSmarty;
					if(x){
						SmartProto.prototype.delete.call(x.smarty,x.key,revEvt);
					}else{
						this.delete(event.key,revEvt);
					}
					break;
				case 'delete':
					revEvt.evt='new'; //so we insert in the case of SmartArrays 
				case 'change':
					this.set(event.key,event.old,revEvt);
			}

			return;
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
		* @emit 'intercept' Only if ._intercept.emit is set AND it throws
		*
		* @return void 			  
		* @call(<SmartProto>)
		* @async    Kind of...
		*/
		function tripleEmit(event){

			try{

				//IF for any reason we don't want the event emitted, eg @see revert()
				if(event.noEmit)
					return;

				//We emit async...
				var p=Promise.resolve(), self=this;

				
				//We can intercept the emit,possibly changing the event
				if(typeof this._intercept.emit=='function'){
					p=p.then(function tripleEmit_intercept(){return self._intercept.emit.call(self,event)}) //this method can change the event in any way it pleases...
					   .catch(function tripleEmit_reverting(err){
					   		revert.call(self,event);
					   		self.emit('intercept',event);
							return self._log.makeError(`Reverted ${event.evt} ${event.key}.`,event,err).reject('intercept');
						})
					;
				}

				//Then run all emits simoultaneously
				p.then(function tripleEmit_emitting(){
					//Clean up internal usage stuff... Remember, these get deleted in childListener() too, so don't think we should save them
					//for the sake of propogation
					delete event.__smarthelp__;

					self.emit('event',event);

					self.emit(event.evt,event);
					
					let key='_'+event.key;//leading '_' in case keys have unsuitable names like 'change' or 'new'
					self.emit(key,event); 
				})

				//Finally catch and log any errors because nobody is handling them
				.catch(this._log.error);

			}catch(err){
				this._log.error("BUGBUG: Failed to emit event:",event,err);
			}
			
			return;
		}




		/*
		* Call .set but wait for events to be emitted (or intercepted) and finished handling
		*
		* @param string|number|array   key
		* @opt   any                   value               
		* @opt   object                event 
		* @opt   string|number         index  When to resolve. Default is '+' which means after other handlers which havn't changed
		*									  their index. Use '-' to run before the same.
		*
		* @return Promise(event,err) 	Resolves with event, rejects with error
		*
		* @reject 'intercept'
		* @reject ...
		*/
		SmartProto.prototype.setAndWait=function(key,value,event,index='+'){
			//Make sure we have an event object so we can set a flag on it and check emitted events to get a match. 
			if(!event || typeof event!='object')
				event={};
				// NOTE: we don't accept the append boolean as arg #3 like SmartArray.
			var flag={}
			Object.defineProperty(event,'__setAndWaitFlag__',{value:flag,writable:true});

			var {promise,resolve,reject}=cX.exposedPromise();

			this.addListener(/(event|intercept)/,(_event)=>{
				if(_event.__setAndWaitFlag__==flag){
					delete _event.__setAndWaitFlag__
					//We're only listening to 2 events, so it'e either...
					if(_event.evt=='intercept')
						reject(_event);
					else
						resolve(_event);

					//We're only expecting one of these events to fire, so tell BetterEvents to remove this listener by returning...
					return 'off' 
				}
			},index)

			this.set(key,value,event);
			return promise;

		}

		/*
		* Call .set, then .get with the same key
		*
		* @param string|number|array   key
		* @opt   any                   value               
		* @opt   object                event 
		*
		* @return any 					The value after setting
		*/
		SmartProto.prototype.setAndGet=function(key,value,event){
			this.set.apply(this,arguments);
			return this.get(key);
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
		* @param string|number|array key 	
		*
		* @throws <ble TypeError> 
		* @throws <ble EMISMATCH> 	If $key is array but children=='primitive'
		*
		* @return mixed 			  
		*/
		SmartProto.prototype.has=function(key){
			//For simplicity, if we get an array key, just use this.get() to determine if the value is exists
			if(cX.checkType(['string','number','array'],key)=='array'){
				try{
					return this.get(key)!=undefined;
				}catch(err){
					if(err.code=='EMISMATCH')
						err.throw();

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
			//First get the value...
			var value=_get.call(this,key);

			//If we're intercepting...
			if(typeof this._intercept.get=='function'){
				try{
					value=this._intercept.get.call(this,value,key); //this method can change the event in any way it pleases...
				}catch(err){
					key=(key==undefined ? 'entire '+this.isSmart : `key '${key}'`);
					this._log.throwCode('intercept',`Prevented getting ${Array.isArray(key)?key.join('.'):String(key)}.`,err);
				}
			}
			return value;
		}


		//Private function used internally to facilitate intercepting 'get'
		function _get(key){
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
					console.log("Returning a copy of this smarty");
					return cX.copy(this._private.data);
				}
			}

			//For complex children we allow key to be array with multiple 'steps'
			if(Array.isArray(key)){
				var keys=cX.copy(key); //so we don't alter the passed in array
				switch(o.children){
					case 'primitive':
						this._log.throwCode('EMISMATCH','Key cannot be array when using primitive children.');
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
							return cX.nestedGet(value,keys);
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
		* Get a non-smart, non-live copy of the data on this smarty
		*
		* NOTE: This will remove any values that are functions (which we are allowing since 2020-02-19)
		*
		* @return object|array
		*/
		SmartProto.prototype.copy=SmartProto.prototype.stupify=function(key=undefined){
			var val=this.get(key);

			//If the children havn't already been made stupid...
			if(this._private.options.getLive||this._private.options.children=='smart'){
				//...decouple here...
				return cX.copy(val);
			}else{
				return val; //decoupling already done in _get()
			}
		}




		/*
		* Delete a local or nested key
		*
		* @param string|number key
		* @opt object event
		* @secret NO_LOG_TOKEN
		*
		* @return any|undefined 			The old value that was removed (which may be undefined == nothing was removed)
		*/
		SmartProto.prototype.delete=function(key,event={}){
			//First check if this method should be executed on a nested smarty, in which case do so and return the value right away 
			//(events will bubble from that child...)
			var y=callOnDeepest.call(this,'delete',arguments);
			if(y!=EXEC_LOCALLY_TOKEN)
				return y;

			var NO_LOG=arguments[2];

			//Ok, so this smarty will be doing the work, but we still don't know if we'll be emitting anything since we don't
			//know if there's anything to emit, so check that now
			event=commonPrepareAlter.call(this,key,event);
			if(event.old==undefined)
				return event.old; //ie. undefined
			
			var x=event.__smarthelp__;

			event.evt='delete';
			event.value=undefined;

			//Ok, so we're changing something and this smarty will be doing the emitting, but the value may still be
			//nested a complex child... but if our children are smart....
			if(this._private.options.children=='smart' && typeof event.old=='object'){
				//Explained^: since kids are smart and we're on the deepest smarty then there can be no nestedDelete(). So
				//if the old value is an object that means it's going to be deleted from here, ie. we don't event have
				//to check that the key isn't an array, but we do just for clarity
				if(Array.isArray(event.key))
					this._log.throw("BUGBUG the key should NOT be an array here:",event.key);
				deleteSmartChild.call(this,event.key,NO_LOG); //this will log
			}else{
				if(NO_LOG!=NO_LOG_TOKEN)
					this._log.trace(`Deleting key '${event.key}':`,cX.logVar(event.old));

				//If the key is an array then we're deleting something nested, else something local. In both cases it
				//could be a primitive or object we're deleting, but it makes no diff
				if(x.nestedKeys){
					nestedDelete(this.get(x.localKey), x.nestedKeys);
				}else{
					delete this._private.data[event.key];
				}
			}

			//Now we apply some individual cleanup IF the alteration was local
			if(!x.nestedKeys){
				if(this.isSmart=='SmartArray'){
					//The array just got shorter, remove getter from this object
					if(this._private.options.addGetters)
						delete this[this.length];//yes, call this.length again...
					
					//The above only deleted the index (ie. set it to undefined), but it didn't shift the rest of the keys... so do that now
					this._private.data.splice(key,1);
				}else{
					if(this._private.options.addGetters)
						delete this[key];
				}
			}

			//Finally emit and return
			tripleEmit.call(this,event);
			return event.old;
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
				this._log.debug(`Replicating ${event.evt}(${typeof event.key=='object' ? event.key.join('.') : event.key},${String(event.value)})`);
			 	//^ if transmitting over uniSoc then key.toString won't be what we set it to in tripleEmit()

			//Unless another source has already been specified, set it now
			event.src=event.src||'replicate';

			switch(event.evt){
				case 'new':
				case 'change':
					return this.set(event.key,event.value,event);
				case 'delete':
					return this.delete(event.key,event);
				case 'move':
					return this.move(event.from,event.to,event);
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
		*								'force' - continue delete(), then empty any remaining ungracefully (ie. no event emitted)
		*								'silent' - like 'force', but events are supressed
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
					oldValues[key]=this.delete(key,{noEmit:true});
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
				removePublicAccessors.call(this);
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
		* Set public enumerable getters/setters based on options.publicGetters & .publicSetters
		*
		* @param 
		* @access private
		* @call(this)
		*/
		function setPublicAccessors(key){
			this._log.traceFrom(`Creating public accessor for key '${key}'`);
			//2020-05-29: Removing this check because I think we'll always want to set this...
			// if(!this.hasOwnProperty(key)){
				Object.defineProperty(this,key,{enumerable:true,configurable:true
					,get:()=>this.get(key)
					,set:(val)=>this.set(key,val)
				});
			// }
		}

		/*
		* Remove ALL public enumerable getters. 
		*
		* @access private
		* @call(this)
		*/
		function removePublicAccessors(){
			var p,d;
			for(p of Object.getOwnPropertyNames(this)){
				d=Object.getOwnPropertyDescriptor(this,p);
				if(d.enumerable==true && typeof d.get=='function'){
					if(!this._private.data.hasOwnProperty(p))
						this._log.note(`BUGBUG: Mismatch between public getter and private data. '${p}' doesn't exist privately. Deleting getter anyway.`,this);
					delete this[p];
				}
			}
		}


		/*
		* @return array[string...] 	A list of enumerable props on this, which are not set on _private.data 
		*/
		SmartProto.prototype.listStupidProps=function(){
			var stupidProps=[];
			for(let key of Object.getOwnPropertyNames(this)){
				// this._log.trace(key,'enumerable:',this.propertyIsEnumerable(key),'private:',this._private.data.hasOwnProperty(key));
				if(this.propertyIsEnumerable(key) && !this._private.data.hasOwnProperty(key)){
					stupidProps.push(key);
				}
			}
			return stupidProps;
		}


		/*
		* Check for any enumerable props that aren't smart (ie. set directly on object without using .set() the first time) and fix them
		*
		* NOTE: This will emit 'new' for each property that wasn't already smart. 
		* NOTE: If an enumerable string prop is found on a SmartArray an error will be logged but this method won't fail
		*
		* @return this
		*/
		SmartProto.prototype.makePropsSmart=function(){

			if(!this._private.options.addGetters){
				this._private.options.addGetters=true;
				this._log.note("Changing options.addGetters=true. From now on public accessors will be added");
			}

			var props=this.listStupidProps();
			if(props.length){
				this._log.info(`Making the following props smart: ${props.join(', ')}`);
				for(let key of props){
					try{
						// this._log.trace(`Making '${key}' smart...`);
						//Just set the value, which will store it privately, emit, and then create the accessor since we've made sure
						//the option ^ is set
						this.set(key,this[key]);
					}catch(err){
						this._log.error(`Failed to make prop '${key}' smart`,err);
					}
				}
			}else{
				this._log.trace("Checked, and no props need to be made smart");
			}

			return this;
		}





		/*
		* Similar to .assign() except it only sets those values where the keys don't already exist
		*
		* @param function fn
		*
		* @return object|undefined 		If no changes occured then undefined is returned. Else an object with same keys
		*								as @obj for those values that have changed. Values are the old values
		*/
		SmartProto.prototype.fillOut=function(obj){
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
				//Undefined is the same as deleting. This is used eg. by assign(). There is a risk that it's passed in by mistake, but
				//so what, the same goes for any objects...
				if(value==undefined) 
					return this.delete(key,event,arguments[3]); //returns old value or undefined (not null)

				//Now that we know we're setting, check if this method should be executed on a nested smarty, in which case do so and 
				//return the value right away (events will bubble from that child...)
				var y=callOnDeepest.call(this,'set',arguments);
				if(y!=EXEC_LOCALLY_TOKEN)
					return y;
				
				//Common preparation for setting, which will also call commonPrepareAlter
				event=commonPrepareSet.call(this,key,value,event); 

				//If nothing changed, end early
				if(event.evt=='none'){
					return event.old; //return .old instead of .value since they won't be the same if they're objects
				}

				//At this point we know we're setting something, time to determine the event, 'new' or 'change', in terms of the
				//local object (ie. setting a new sub-property on an existing local property is still a 'change' in the local eyes)
				if(event.old===undefined){
					event.evt='new';
				}else{
					event.evt='change';
				}
				

				//If we're setting nested smarties then __smarthelp__ will get replaced on the event, so keep our version which
				//we may need vv
				var x=event.__smarthelp__;

				//Do the actual setting. If we're setting a smart child then...
				var emitHere=commonSet.call(this,event,arguments[3]);

				//If a new property was added and we're using getters...
				if(event.evt=='new' && this._private.options.addGetters)
					setPublicAccessors.call(this,x.localKey);
				
				//We only emit from the nested-most smarty... which may be where we are right now!
				if(emitHere)
					tripleEmit.call(this,event);
				

				return event.old;
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

					if(cX.isEmpty(obj)){
						this._log.trace("Empty obj passed in, not assigning anything...");	
						return undefined;
					}

					//If the exact same data was passed in, exit early
					if(cX.sameValue(this._private.data, obj)){
						this._log.trace("Tried to assign the same values, ignoring...",obj);	
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
			[	'includes','map','forEach','entries','every','indexOf','join','lastIndexOf'
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
			SmartArray.prototype.set=function(key,value,event=undefined){
				//undefined values are same as deleting, but without risk of range error
				if(value===undefined){
					try{
						return this.delete(key,event); 
					}catch(err){
						return undefined; //nothing was previously set
					}
				}
				
				//check if this method should be executed on a nested smarty, in which case do so and return the value right away 
				//(events will bubble from that child...)
				var y=callOnDeepest.call(this,'set',arguments);
				if(y!=EXEC_LOCALLY_TOKEN)
					return y;


				//to catch deprecated legacy args...
				if(arguments.length==4)
					this._log.warn("DEPRECATED. SmartArray.set() only takes 3 args now: key, value, event. See func def for more details");

				//Support single truthy boolean passed to mean 'append'...
				if(event===true){
					event={evt:'new'};
				}

				//Common preparation for setting
				event=commonPrepareSet.call(this,key,value,event); //event.add!=undefined implies that key has to be numerical
				let x=event.__smarthelp__;

				//Then check if anything has changed, in which case we return early
				if(event.evt=='none'){
					return event.old; //return .old instead of .value since they won't be the same if they're objects				
				}

				//Make sure the index is in range, and determine if we're adding
				let length=this.length;
				if(x.localKey>length){
					this._log.throw(new RangeError("SmartArray must remain sequential, cannot set index "+x.localKey+" when length is "+length));
				}else if(x.localKey<0){
					this._log.throw(new RangeError("Cannot set negative index "+x.localKey));
				}else if(x.localKey==length){
					event.evt='new';
				}else{
					event.evt='change'
				}


				//If the event is new, insert a place placeholder to facilicate same handling...
				if(event.evt=='new'){		
					this._private.data.splice(x.localKey,0,'__placeholder__'); 
				}

				//Do the actual setting, and check if we're setting a smart child...
				let emitHere=commonSet.call(this,event,arguments[3]);
			
				//The array just got longer, add an enumerable getter to this object. Do this after we've succesfully set
				if(event.evt=='new' && this._private.options.addGetters)
					setPublicAccessors.call(this,this.length-1); //call length again to get the new length
				
				//We only emit from the nested-most smarty... which may be where we are right now!
				if(emitHere)
					tripleEmit.call(this,event); 

				return event.old;

			}















			/*
			* Find the first matching item and delete it
			*
			* @param function test 	A function to test each item with (@see this.findIndex())
			*
			* @emit delete
			*
			* @throw TypeError
			*
			* @return mixed|undefined 		The removed item, or undefined if none existed in the first place
			*/
			SmartArray.prototype.findDelete=function(test){
				let i=this.findIndex(test);
				if(i>-1)
					return this.delete(i);
				else
					return undefined;
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
			* Find all matching items and delete them
			*
			* @param function test 	A function to test each item with (@see this.findIndex())
			*
			* @emit delete
			*
			* @throw TypeError
			*
			* @return array 		Array of deleted items, with index intact (ie. not sequential array), or empty array
			*/
			SmartArray.prototype.findAllDelete=function(test){
				cX.checkType('function',test);
				var deleted=[];
				this.forEachBackwards((item,i)=>{
					if(test.call(this,item,i))
						deleted[i]=this.delete(i);
				})
				return deleted;
			}
























			/*
			* Move an item in the array to another position
			*
			* @param number|array	from 	Current index of item. Possibly a nested key.
			* @param number|string 	to 		New index of item, or '+'/'-' to move up/down by 1, or 'first'/'last'
			*
			* @emit move 		*NOTE* if this._private.options.moveEvent==true
			*  --or--
			* @emit set,delete 	*NOTE* if this._private.options.moveEvent==false
			*
			* @throw <ble TypeError>
			* @throw <ble RangeError> 	If $to or $from is outside the range of the array. NOTE: this does not
			*							  happen if $to is a string.
			* @throw <ble EINVAL> 		If $from or $to couldn't be converted into a numbers
			* @throw <ble EMISMATCH> 	If $from points us to an object
			*
			* @return boolean 	True if a move occured, else false (ie. moved to same spot)
			*/
			SmartArray.prototype.move=function(from,to,event={}){
				event=event && typeof event=='object' ? event:{};
				event.src=event.src||'move'; //2020-06-15: doesn't do anything here... just for logging clarity

				var types=cX.checkTypes([['number','array'],['number','string']],[from,to])
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
								.addExtra(target).throw("EMISMATCH");
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
					let value=smarty.delete(from,event) //TODO 2020-06-15: do we want to use the same event, or do we want a copy??
					event.evt='add';
					smarty.set(to,value,event);
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


			/*
			* Get all items that satisfies a test
			*
			* @param mixed test 	A function that will be .call(this,item,index) or a any value that will be 
			*							tested === against each item
			* @opt bool retainIndex Default false. If true the original index is retained
			*
			* @return number 		The index or -1
			*/
			SmartArray.prototype.filter=function(test,retainIndex=false){
				let indexes=this.findIndexAll(test);
				if(retainIndex){
					let arr=[];
					indexes.forEach(i=>arr[i]=this.get(i));
					return arr;
				}else{
					return indexes.map(this.get.bind(this))
				}
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

			//2020-05-27: Only .aftertransmit uses this, but there is no reason why it couldn't just use payload.data if we didn'ẗ
			//			  stupify the smarty... so let's try not stupifying it (look for comment from this date)
				//...however a live version is needed to initLink(), so hide it on the payload (hidden props do not
				//get transmitted, but it will allow access when eg using autoLink() )
				// Object.defineProperty(x.payload,'smarty',{value:this,configurable:true});


				
				//Then save the options to be used on the other side for creating their smarty. Even if we don't link, 
				//this will allow the other side to create a smarty.
				x.payload.smartOptions=getSmartOptions.call(this)

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

				this._log.makeEntry('info',"Prepared smart link:",x.payload).addFrom().exec();

				//Finally return the same object that was passed in
				return x;
			}

			/*
			* Get suitable options to send over a link that will allow the oppossing side to create it's own smarty (ie. this takes
			* into account how SmartProto() may have changed the passed in options and get's the original back)
			*
			* @return object 			An options object suitable to pass to SmartProto when creating a new smarty
			* @call(<SmartProto>)
			*/
			function getSmartOptions(){
				var opts=cX.subObj(this._private.options,[	
						//this one is necessary because if will make/break all transmitted data...
						'children' 

						//these are not necessary since the two objects are allowed to differ (especially regarding extra keys),
						//but for now we assume the two objects may wish basic compatability vis-a-vi value cleaning... we may
						//add option in future versions to opt out of this
						,'constantType'
						,'meta'
					]
				)

				//.children could have been 'number', 'bool', 'string', 'any'...
				if(typeof this._private.expectedValTypes=='string'){
					//'any' implies that this smarty is not suitable to be transmitted
					if(opts.children=='any')
						throw new Error("Smarties with children=='any' cannot be linked");

					opts.children=this._private.expectedValTypes;
				}

				return opts;

			}

			/*
			* Take the object returned by getSmartOptions() and implement it on this smarty
			*
			* NOTE: This will not check anything, just overwrite
			*
			* @param object opts
			*
			* @return this
			* @call(<SmartProto>)
			*/
			function setSmartOptions(opts){
				setChildren.call(this,opts.children); //should be set
				setMeta.call(this,opts.meta); //may or may not be set, but this method checks
				this._private.options.constantType=opts.constantType;
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

				args=parseLinkArgs.call(this,args); //this => for logging purposes
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

				//If we're transmitting changes...
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

				//If we're receiving changes...
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
			function parseLinkArgs(args){
				//Allow args to be passed in seperately or in a single object, but make sure the return obj we
				//build is not a live link to a passed in object since we'll be changing it vv
				var obj={}
					,knownFlags=['flip','overwrite']
					,no_u='Expected an instanceof uniSoc, none passed:'
					,no_p='Expected a payload object with prop smartLink, none passed:'
				;
				//First grab any string flags and set them on the obj
				cX.extractItems(args,knownFlags).forEach(flag=>obj[flag]=true);

				if(args.length==1 && typeof args[0] =='object' && args[0].hasOwnProperty('unisoc') && args[0].hasOwnProperty('payload')){
					Object.assign(obj,args[0]);
					obj.unisoc=obj.unisoc||obj.uniSoc; delete obj.uniSoc; //make sure it's lower case
					if(!obj.unisoc.isUniSoc)
						this._log.makeError(no_u,obj).throw('TypeError');
					if(!obj.payload.smartLink)
						this._log.makeError(no_p,obj).throw('EINVAL');

					obj.TxInterceptor = typeof obj.TxInterceptor=='function' ? obj.TxInterceptor : undefined; 

				
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
				}
				
				var {Tx,Rx}=obj.payload.smartLink;
				if(!cX.checkTypes([['string','undefined'],['string','undefined']],[Tx,Rx],true))
					this._log.makeError("Tx/Rx should be string/undefined, got:",cX.logVar(Tx),cX.logVar(Rx)).throw('TypeError');
				obj.Tx=Tx;
				obj.Rx=Rx;


				//Optionally flip Tx and Rx (always done if we're on the receiving end...)
				if(obj.flip){
					let Rx=obj.Rx;
					obj.Rx=obj.Tx;
					obj.Tx=Rx;
				}
				delete obj.flip;


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

			//2020-05-27: Trying to leave smarty live...
				// x.payload.data=this.stupify();
				x.payload.data=this;

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

				//2020-05-27: Trying to leave smarty live...
					//Respond to the request with this smarty
					// return x.callback(null,this.stupify()).then(responded=>{
					return x.callback(null,this).then(responded=>{
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



			/*
			* Receive data from a remote smarty, assign it to this one and link this one with the remote
			*
			* @param object payload 	The received payload which contains the data and options we need
			* @param object unisoc 		The receiving unisoc so we can initLink() on it (ie. receive and transmit changes)
			* @opt boolean overwrite	If true any existing data on this smarty will be removed and the remove smartOptions
			*							 used to overwrite our own
			*
			* @return this
			*/
			SmartProto.prototype.receiveAndLink=function(...args){
				var {unisoc,payload,overwrite}=parseLinkArgs(args)
				
				//If we're overwriting the local smarty...
				if(overwrite){
					this._log.debug("Overwriting local data/options with remote:",payload);
					this.empty(); 										//1. empty all data
					setSmartOptions.call(this,payload.smartOptions); 	//2. use the remote options

				}else{
					let ourOptions=getSmartOptions.call(this);
					if(cX.sameValue(ourOptions,payload.smartOptions)){
						//Else just warn if we're using different options so future problems can be easier to track down...
						this._log.warn("Linking to a remote smarty with different options which may or may not cause problems later..."
							,{ourOptions,remoteOptions:payload.smartOptions});
					}
				}
				delete payload.smartOptions; //just so the caller doesn't try to do it again

				this.assign(payload.data);

				this.initLink(unisoc, payload, 'flip'); //flip=> what they send we receive
					  //^logs what is linked
				//NOTE: we won't delete payload.smartLink since someone else may want to listen to the events... and it's an easy way 
				//		for others to check if a smarty was sent

				//In case anyone else is using the payload make sure it holds this live smarty
				payload.data=this;

				return this;
			}






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
			let determineDirection=(x)=>{return (x.Tx?(x.Rx?'BOTH directions':'sending only'):x.Rx?'sending only':'')}
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

				//When receiving responses, before value is returned to original requester...
				unisoc.onresponse=function autoLinkSmarty_receive(payload){
					//NOTE: Unisoc will call this function as itself, so this==unisoc

					try{
						if(payload.smartOptions && payload.smartLink){
							
							this.log.info("Response contained a smarty, auto-linking...");
							
							payload.data=createSmarty(payload.data,payload.smartOptions);
							delete payload.smartOptions; //just so the caller doesn't try to do it again

							//NOTE: we ignore passed in^ Tx and Rx here, it's up to the other side if they want to send us
							//updates or listen for our changes...
							payload.data.initLink(this, payload, 'flip'); //flip=> what they send we receive
							  //^logs what is linked

							//NOTE: we won't delete payload.smartLink since someone else may want to listen to the events... and it's an easy way 
							//		for others to check if a smarty was sent
						}
					}catch(err){
						this.log.error(err,payload);
					}
				}

				unisoc.beforetransmit=function autoLinkSmarty_transmit(payload){
					//NOTE: Unisoc will call this function as itself, so this==unisoc

					try{
						//This will fire for all transmits, so first we have to check if it's even a smarty
						if(payload.data && payload.data.isSmart){
							let smarty=payload.data; //it WAS as smarty, so for clarity create a 'smarty' variable
							let who=payload.id+': '
							
							//We're auto-linking live smarties, but if someone tries to do it manually the above isSmart() shouldn't
							//be truthy and we shouldn't be here... so just make sure no duplication of efforts have been made...							
							if(payload.smartOptions&&payload.smartLink){
								let what=determineDirection(payload.smartLink);
								let logstr=`${who}Smart link already prepared`
								if(what){
									this.log.debug(`${logstr}, ${what}`);
								}else{
									this.log.note(`${logstr} and explicitly prevented.`);
								}
							}else{
								if(payload.smartOptions||payload.smartLink){
									this.log.note(`${who}Someone has partly prepared the payload for smart linking, setting payload.${payload.smartOptions?'smartOptions':'smartLink'}, `
										+`but not ${payload.smartOptions?'smartLink':'smartOptions'}. Will fill in the rest with default on the rest`, payload);
								}
								//Determine if/what we're going to link and log it
								let smartyOptions=cX.subObj(smarty._private.options, TxRx, 'hasOwnDefinedProperty')
									,opts=Object.assign({},autoLinkDefault,smartyOptions,payload.smartOptions,payload.smartLink) //if the last 2 don't exist, they have no effect
									,which=determineDirection(opts)
								;
								// console.debug('autolink options:',{result:opts,autoLinkDefault,smartyOptions});
								if(!which){
									this.log.note(`${who}Payload contained a smarty, but it will not be linked.`);
								}else{
									this.log.info(`${who}Preparing smart payload for ${which}`);
									opts.payload=payload; //prepareLink needs the entire payload too...
									smarty.prepareLink(opts);
								}
								
								//Finally, regardless of ^, make the smarty stupid since we ARE going to send it.
								payload.data=smarty.stupify();
								this.log.info('Stupified smarty in payload. Now ready to transmit.',payload);
							}
						}
					}catch(err){
						this.log.error(err,payload);
					}
				}

				unisoc.aftertransmit=function initSmartLink(payload){
					//NOTE: Unisoc will call this function as itself, so this==unisoc

					try{
					//2020-05-27: trying to leave smarty live on .data
						// if(payload.smarty){
						// 	payload.smarty.initLink(this, payload);
						// }
						if(payload.data && payload.data.isSmart && payload.smartOptions){
							payload.data.initLink(payload,this)
						}
					}catch(err){
						this.log.error(err,payload);
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







			// function setupBroadcast(args){

	/*TODO 2020-03-02: 
		If we've already setup one link for a given smarty on a socket that's part of a server, it seems dumb not 
		have those events be a group so there is only one endpoint registered for it and the server can broadcast 
		instead of sending to each listener... which minimizes overhead when preparing send...

		The question is if it's at all more efficient to have a single broadcast??

		And if we do a broadcast we have to keep track of each sockets received things, since changes need to 
		go out to all but the incoming socket...
	*/
			// }



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
