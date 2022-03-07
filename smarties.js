'use strict';
//simpleSourceMap=/my_modules/smart.class.js
//simpleSourceMap2=/lib/smart.class.js
/*
* @module smarties
* @author plundell
* @license Apache-2.0 
* @description Create objects and arrays that are 'smart'. Mainly they emit when you change something on them, 
*              but they can also control what is set on them, and replicate their changes to other objects.
*
* @depends libbetter {BetterLog,BetterEvents,BetterUtil}
*
* @exports {function} Call this function with an object containing the dependencies. It returns an object with props: 
*                        Object, Array, isSmart, create, autoLinkUniSoc. 
* @protip: ctrl+f '@exported' to see the definitions of the exported. 
*
* @protip: In the browser you can load this file after its dependency 'libbetter' to automatically initialize it on 
*          the window, like so:
*                <script src="path/to/libbetter.js">
*                <script src="path/to/smarties.js">
*
* @protip: You can control what is set in 2 ways:
*   1. _private.options.meta[key|*] - rules about specific keys or all keys, incl a callback .cleanFunc.call(this,value,key,meta) 
*		which is called BEFORE we check if it's the same value
*	2. _intercept.foo - You can intercept at 3 stages of the setting process:
*	  2.1. prepare  (key,value,event)  BEFORE any checks or any preparations - Notes: 'event' may not exist. Must return array with 3 items
*     2.2. commit   (event)            AFTER all checks but BEFORE child smarties are created or anything is stored
*	  2.3. emit     (event)            AFTER the value has been stored but BEFORE any events are emitted - Notes: can be async, throwing will revert setting
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
	    			//Load the main class, replacing this getter
	    			Object.defineProperty(window,'Smarties',{value:exportSmarties(window),enumerable:true,configurable:true}); 

	    			//Load any shims. We do this after ^ so Smarties is already set on window
	    			if(Array.isArray(window.SmartiesShims)){
	    				window.SmartiesShims.forEach(shim=>shim(window));
	    				try{delete window.SmartiesShims}catch(err){}
	    			}
	    			return window.Smarties;
	    		}else{
	    			throw new Error("E_DEPENDENCY. Smarties depends on libbetter which has yet to be set on the window. "
	    				+"You may be loading scripts in the wrong order?");
	    		}
	    	}
	    })
    }
   

	function exportSmarties(dep={}){
		
		function missingDependency(which){throw new Error("Missing dependency for smarties.js: "+which);}
		const libbetter=(dep.BetterLog ? dep : dep.libbetter) || missingDependency('libbetter');
		const BetterLog = libbetter.BetterLog        || missingDependency('BetterLog');
		const BetterEvents = libbetter.BetterEvents  || missingDependency('BetterEvents');
		var BetterUtil = libbetter.BetterUtil      || missingDependency('BetterUtil');
		const bu=(BetterUtil.cX ? BetterUtil.cX : BetterUtil);
// console.log('AAAAAAAAAAAAAAAAAAAAAAA');
// console.log(BetterEvents);

		//Tokens to pass around internally
		const CLEAN_KEY_TOKEN=Symbol('clean')
		const SAME_VALUE_TOKEN=Symbol('same')
		const INTERCEPT_TOKEN=Symbol('intercept')
		const SKIP_TOKEN=Symbol('skip')

		/*
		* @return string|undefined  	'SmartArray' or 'SmartObject' if it is, else undefined
		* @exported
		*/
		function isSmart(x){
			if(x && typeof x=='object' && x.isSmart){
				return x.isSmart
			}
			return undefined
		}

		function smartVarType(value){
			if(isSmart(value))
				return 'smart';
			else
				return bu.varType(value);
		}

		/*
		* Get the type of a value in the context of this class
		*
		* @param any x
		*
		* @return string 	One of: smart, complex, primitive  or empty string if $x==undefined
		*/
		function childType(x){
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
		* Like bu.varType() but SmartArray=>array SmartObject=>object
		*
		* @param any x
		* @return string   
		*/
		function dataType(x){
			let name=isSmart(x);
			if(name)
				return name.slice(5).toLowerCase() //SmartArray=>array SmartObject=>object
			else 
				return bu.varType(x);
		}


		/*
		* Create an empty object/array matching the type used by $x
		*
		* @param <SmartProto> x
		*
		* @return object|array
		*/
		function newDataConstructor(x){
			switch(dataType(x)){
				case 'array':
					return [];
				case 'object':
					return {};
				default:
					throw new TypeError("Expected array or object, got: "+typeof x);
			}
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
			switch(bu.checkType(['array','object','<SmartObject>','<SmartArray>'],data)){
				case '<SmartObject>':
				case 'object':
					smarty=new SmartObject(options); 
					break;
				case '<SmartArray>':
				case 'array':
					smarty=new SmartArray(options);
			}
			
			if(!bu.isEmpty(data)){
				smarty.assign(bu.copy(data),'noEmit');
			}

			return smarty;
		}




		



		/********************************* SmartProto (not exported) **************************/
		const metaTypes={
			'accepted':['string','array','undefined']
			,'type':['string','array','undefined']
			,'constantType':'bool*'
			,'prepend':'string*'
			,'cleanFunc':'function*'
			,'required':'bool*'
			,'constant':'bool*'
			,'nullable':'bool*'
			,'block':'bool*'
			,'meta':'object*'
		}

		SmartProto.defaultOptions={
		//Used by SmartProto
			meta:null 	//An object. Keys correspond to keys to props on the smarty, values are objects containing one or more
						//of these rules about that prop.:
				//  block     - bool      - if true this key may not be set (@see setupMeta for handling with key '*')
				//  accepted  - string|array - specific accepted values, eg. specific strings etc
				//  type      - string|array - which types are accepted
				//  constantType - bool   - if true type cannot be changed (combine with 'require' to prevent delete+set diff type)
				//  prepend   - string    - only used if value is string, this string will be prepended
				//  cleanFunc - function  - callback that can do anything, it's return value used
				//  required  - boolean   - if true this prop cannot be deleted (but it can be set to null)
				//  default   - any       - set on construction, reset() and if required prop is deleted
				//  constant     - bool   - once set the value cannot be changed (default value is NOT considered 'set')
				//  nullable     - bool   - if true the prop can ALWAYS be set to null
				//  meta         - object - Rules intended for smart children of that prop (unlike '**' vv you can control depth)
				// Two custom keys exist:
				//   '*' - "fallback rules" which apply to all keys that don't have those specific rules set.
				//   '**'- "descendent rules" get set as '*' on all descendents recursively but does NOT apply to this smarty

			,smartifyChildren:true //true => when regular objects are set they are upgraded to smarties

			,defaultValues:null    //Shorthand for meta:{key1:{default:xxx},key2:{default:yyy}}. ignored if $meta is passed

			,bufferEvent:0 	       //If set to number>0, a copy of all the data on the object will be emitted that many ms after any event

			,debounce:0 	       //If >0, .set() will be delayed by that many ms, and any additional calls during that time will
							       //push the delay further and .set() will only be called with the last value.

			,throttle:0 	       //If >0, .set() will ignore calls for this many ms after a call. NOTE: The last value will still be
							       //set after the timeout

			,eventType:'local' /* What should events reflect?
									'local' - Events reflect what happened to the local smarty, ie. if a child smarty
									 		  gets a new key then this smarty will emit
									 				{evt:'change',key:(string)local,value:entire-child}
									'nested' - Events try to be as precise as possible, only appending the local key to the
											   array childs key. This may be more efficient when changing single details
											   on nested smarties (especially when linking smarties via uniSoc)
											   		{evt:'new',key:(array)nested, value:nested}
							
								*/

			,bufferBubbles:0 //Only used if eventType=='local'

			

			,assignmentWarn:true //Default true => if you write props directly on smarty without using .set(), warn! Use a number
								 //to have a check be performed on an interval 
			,assignmentFix:0 	//if >0 then makePropsSmart() will be run at that interval. NOTE: this overrides assignmentWarn

			,getLive:false      //if true, get() will return a 'live' value of non-smart values (smart children are always live)

			,keyDelim:'\0'  //nested keys can be passed as strings delimited by this. Also used internally in eg. .replace(). 
							//Change this if needed to ensure no keys ever contain this string.


		};

		SmartProto.getRelevantOptions=function(options){
			return Object.assign({}
				,bu.subObj(options,Object.keys(BetterEvents.defaultOptions),'hasOwnProperty')
				,bu.subObj(options,Object.keys(BetterLog.defaultOptions),'hasOwnProperty')
				,bu.subObj(options,Object.keys(SmartProto.defaultOptions),'hasOwnProperty')
			)
		}
		

		/*
		* @constructor SmartProto 	Prototype for several objects in this folder
		*/
		function SmartProto(_options){	
			bu.checkType(['object','undefined'],_options);

			//Combine default options
			var options=Object.assign({},SmartProto.defaultOptions,this.constructor.defaultOptions,_options); 

			//Grab the options relating to BetterEvents and call that constructor (to setup inheritence)
			let beOptions=bu.subObj(options,Object.keys(BetterEvents.defaultOptions),'hasOwnProperty');
			BetterEvents.call(this,beOptions);


			//Set private variable that holds everything we need to access in various prototype methods, 
			//without making it enumerable so it doesn't show up when logging
			Object.defineProperty(this,'_private',{enumerable:false,value:{ 
				data:(this.isSmart=='SmartObject' ? {} : [])	
				,options:options
				,reservedKeys:null //set to object at end of constructor
				,version:0 //ticks each time something is changed in this or a child smarty (@see commonEmitChanges)

			}}); 

			//Create a hidden prop which can hold function that can intercept the set-process at different points and change/prevent it
			Object.defineProperty(this,'_intercept',{value:{prepare:null,commit:null,emit:null}});
			  //^NOTE: This is NOT a security feature if the caller has direct access to this smarty


			//Setup log, passing along the relevant options
			{
				let logOptions=bu.subObj(options,Object.keys(BetterLog.defaultOptions),'excludeMissing');
				let log=new BetterLog(this,logOptions);
				Object.defineProperty(this,'_log',{enumerable:false,value:log});

				let what='smart '+Array.isArray(this._private.data)?'array':'object';
				what=logOptions.hasOwnProperty('name')?`${what} '${this._log.name}'`:'unnamed '+what;
				let ble=this._log.makeEntry('trace',`Creating ${what} with `).changeWhere(2);
				if((!options||!Object.keys(options).length))
					ble.append('default options.').exec();
				else
					ble.append('options:').addExtra(_options).exec();
			}







			//"states" are pre-defined objects which can be assigned using only a keyword 
			this._private.states={}



			//3 things can be buffered...

				//Outgoing events can be collected and re-emitted as once collection after a delay
				if(this._private.options.bufferEvent)
					this.addBufferEvent(this._private.options.bufferEvent);



				//Incoming calls to .set get intercepted and throttled (first and last accepted,fixed timeout) 
				//or debounced (moving timeout, last accepted)
				if(this._private.options.debounce){
					if(this._private.options.throttle){
						this._log.warn("You can't use both 'debounce' and 'throttle', disabling the latter");
						delete this._private.options.throttle;
					}
					this.bufferInput(this._private.options.debounce,'debounce');
				}else if(this._private.options.throttle){
					this.bufferInput(this._private.options.throttle,'throttle');
				}
			

				if(this._private.options.bufferBubbles)
					this.bufferBubbledEvents(this._private.options.bufferBubbles);





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

			//Setup meta
				//defaultValues is just a shorthand for meta[x].default, but meta takes presidence ie. these just fill out
				if(this._private.options.defaultValues){ 
					let defaults=bu.nestValues(this._private.options.defaultValues,'default','create new object since same defaults may be re-used');
					 //^if we omit arg #3 ^ we'll start getting {key:{default:{default:value}}}

					delete this._private.options.defaultValues; //for clarity

					if(this._private.options.meta){
						bu.nestedFillOut(this._private.options.meta,defaults,2); //only fill out to a depth of 2, else eg. default smarties will be stupified
					}else
						this._private.options.meta=defaults
				}
			setupMeta.call(this,this._private.options.meta);
			 //DevNote: No need to unset if ^ fails, because the smarty won't get made...

				

			//Now before we set anything, we want to mark which keys are off limits, which are any methods or
			//props defined on the smarty
			{
				let keys=Object.getOwnPropertyNames(this).concat(
					Object.getOwnPropertyNames(SmartProto.prototype)
					,Object.getOwnPropertyNames(this.constructor.prototype)
				)
				this._private.reservedKeys=bu.objCreateFill(keys,true);
			}	


			//If there are any default, init them
			let defaults=this.getDefaults();
			if(defaults){
				this._log.trace('Got default values, initializing...'); //...assign() will log the actual values
				try{
					this.assign(defaults,'noEmit'); //<-- No events are emitted when assigning default values
				}catch(err){
					this._log.makeError(err).addHandling('Failed to init default values.').throw();
				}
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




		//NOTE: .keys() are defined seperately so that array can return numerical keys
		
		SmartProto.prototype.values=function(){
			return Object.values(this.get()); //in order to maintain possible live children
		}	

		SmartProto.prototype.entries=function(){
			return Object.entries(this.get()); //in order to maintain possible live children
		}



		/*
		* @return array       [ [ ['nested','key'] , value-at-nested-key ], ...]
		*/
		SmartProto.prototype.nestedEntries=function(){
			return bu.flattenObject(this.copy(),'entries'); //no live children since all values will be primitive
		}
		/*
		* @opt number depth   How far down to flatten
		* @return object      {'nested.key':value-at-nested-key,...}
		*/
		SmartProto.prototype.flatObject=function(depth){
			return bu.flattenObject(this.copy(),this._private.options.keyDelim,depth); //no live children since all values will be primitive
		}


		



		/*
		* If this object is to be serialized, only serialize the data
		*/
		SmartProto.prototype.toJSON=function(){
			if(!isSmart(this)){
				if(this!=SmartProto.prototype)
					console.debug('SmartProto.toJSON() was called in an unexpected context:\n',this);
				return this;
			}
			return this._private.data;
		}

		/*
		* The string version of a smarty is a JSON string
		*/
		SmartProto.prototype.toString=function(){
			if(!isSmart(this)){
				if(this!=SmartProto.prototype)
					console.debug('SmartProto.toString() was called in an unexpected context:\n',this);
				return Object.prototype.toString(this);
			}
			return JSON.stringify(this._private.data);
		}

		/*
		* The locale string version of a smarty is a JSON string where each value has been passed to Object.prototype.toLocaleString
		*/
		SmartProto.prototype.toLocaleString=function(){
			if(!isSmart(this)){
				if(this!=SmartProto.prototype)
					console.debug('SmartProto.toLocaleString() was called in an unexpected context:\n',this);
				return Object.prototype.toLocaleString(this);
			}
			return JSON.stringify(this.map(Object.prototype.toLocaleString));
		}



		SmartProto.prototype.instanceof=function(x){
			return isSmart(x)==this.constructor.name;
		}













/* META */


		/*
		* Clean and set meta options
		*
		* @param object|undefined  meta    If nothing is passed in, then nothing happens	   
		*
		* @throw TypeError
		* @throw EMISMATCH
		*
		* @return object|undefined         The cleaned and compiled meta data, or undefined if nothing was passed in
		*
		* @set this._private.meta           The @return object
		* @set this._private.options.meta   The passed in $meta IF no errors are thrown
		*
		* @call(<SmartProto>)
		*/
		function setupMeta(meta){
			if(!meta)
				return undefined;

			bu.checkType(['object','array'],meta);
			
			//Check if there are "fallback rules", in which case those will be checked first as they are then used for 
			//in all other cases
			var keys=Object.keys(meta), fallback=meta['*'];
			if(fallback){
				keys.splice(keys.indexOf('*'),1);
				keys.unshift('*');	
			}else{
				fallback={}; //so we don't get errors vv
			}

			//The "descendent rules" are not meant for this smarty, but its' SMART children. It's almost equivilent to meta['*'].meta
			//accept it gets passed to descendents recursively whereas the former can specify .meta.meta.meta... to a specific depth
			if(meta['**'])
				keys.splice(keys.indexOf('**'),1); //delete...

			var compiled={};
			for(let key of keys){
				bu.checkProps(meta[key],metaTypes);
					
				let rules=compiled[key]={};

				if(meta[key].block){
					rules.block=true;

					//If we're blocking then no other rules are necessary, however for the fallback we'll need to continue
					//for now since those rules will be used in all other cases below
					if(key!='*')
						continue;
				}
				
							
				//The prop 'meta' refers to instructions to be sent to children and can be combined with the fallback version
				let childMeta=Object.assign({},fallback.meta,meta[key].meta)
				childMeta=(Object.keys(childMeta).length ? {meta:childMeta}:undefined)

				//Now combine...
				Object.assign(rules,fallback,meta[key],childMeta);
			
				//Make sure that some props are correct/work together
				if(rules.prepend){
					if(rules.type && rules.type!='string')
						this._log.throwCode('EMISMATCH',"If using meta.prepend then meta.type needs to be string, not:",rules.type);
					rules.type='string';
				}
			}

			//If the fallback contained 'block' then we remove all other rules for clarity
			if(fallback.block)
				meta['*']={block:true};


			//Now that everything was successfull we change the stored options
			this._private.options.meta=meta;
			
		
			//'compiled' now contains all the stuff we want to store, and since we're still running there were no problems, so just replace
			//the existing stuff
			return this._private.meta=compiled;
		}

		/*
		* Set or change meta after a smarty has been created. 
		*
		* @param object meta
		* @flag 'replace' 	If passed all existing meta will be overwritten, else just concated/appended
		*
		* @return object|array|undefined 	Key/values that are deleted as a response to the changed meta, or undefined if nothing was removed
		*/
		SmartProto.prototype.changeMeta=function(meta,replace=true){
			
			if(meta==undefined)
				this._log.throwCode("EINVAL","Cannot change meta to 'undefined'. Use this.deleteMeta() if you want to delete.");
			bu.checkType('object',meta);

			//Start by storing the new meta on the options, optionally combining it with the old
			meta=Object.assign( newDataConstructor(this) , (replace?undefined:this._private.options.meta) , meta);

			//Then setup ._private.meta (ie. the "compiled" version)
			setupMeta.call(this,meta);

			//If data has already been set it will need to be subjected to the new meta. 
			var deleted;
			if(this.length && this._private.meta && Object.keys(this._private.meta).length){
				deleted=newDataConstructor(this);
				let errors=[];
				this.forEachBackwards((val,key)=>{ //go backwards so deleting keys vv don't mess with arrays
					try{
						this.set(key,val); //most of the time this should do nothing, because we're setting the same value...	
					}catch(err){
						let old=deleted[key]=this.delete(key); //...but new validation may fail in which case remove it
						errors.push({key,err}); 
						//DevNote: we don't log here, we warn vv
					}
				})
				if(Object.keys(deleted).length){
					let ble=this._log.makeEntry("warn","Changed meta which caused the following data to be deleted:",deleted);
					errors.forEach(obj=>ble.addHandling(` ${JSON.stringify(obj.key)} - ${String(obj.err._firstBubble)}`));
					ble.exec();
				}
			}

			//Return any deleted data or undefined
			return deleted;
		}


		/*
		* Delete all meta, or meta for one or more keys
		*
		* @opt string|number|array keys
		*
		* @return object|array|undefined 	@see changeMeta if $keys was passed, else undefined
		*/
		SmartProto.prototype.deleteMeta=function(keys){
			//for ease we delete the parsed meta entirely

			if(keys && this._private.options.meta){
				//First delete from the options the keys in question...
				bu.makeArray(keys).forEach(key=>{delete this._private.options.meta[key]})
				
				//...if we got all of them we delete the whole thing
				if(!Object.keys(this._private.options.meta).length)
					delete this._private.options.meta;
			}else{
				delete this._private.options.meta;
			}

			//Either way make sure to delete the parsed version... this will be re-parsed the next time we access them
			delete this._private.meta;
			return;
		}



		/*
		* Get the meta for a specific key, or the "global meta" (ie. key '*' when creating smarty with options.meta:{*:{}})
		*
		* @opt string|number   key  	Omitting is the same as passing '*'
		*
		* @return object|undefined
		* @call(<SmartArray>|<SmartObject>)
		*/
		function getMeta(key){
			if(this._private.options.meta && !Array.isArray(key)){//Sanity check, make sure key is local
				var meta=this._private.meta||setupMeta.call(this,this._private.options.meta); //if no options are set, this returns nothing
				  //In both cases^ $meta is now the value set on this._private.meta

				if(meta){ 
					if(key && meta.hasOwnProperty(key)){
						//If meta for this specific key exists, get that. Remember: When meta was setup any global '*' stuff 
						//was incorporated into each key, so no need to get that here
						return meta[key];
					}else{ 
						return meta['*']; //may be undefined
					}
					//NOTE: We never return meta['**'] because it doesn't apply to this smarty... 
				}
			}
			return undefined;
		}


		function getChildMeta(key){
			
			var meta=getMeta.call(this,key);
			//That^ is the meta for the local key, but the meta for its babies lies in a subprop...
			meta=(meta?meta.meta:undefined)||{};

			//Add the custom object meant for all descendents
			if(this._private.meta&&this._private.meta['**']){
				meta['*']=meta['**']=this._private.meta['**']
			}
			//ProTip: To prevent this being added further down the heirarchy you can delete this._private.meta['**']
			//        from the child created with it... 

			return Object.keys(meta).length ? meta : undefined;
		}


		/*
		* Get the default value for a key, or the "global default" (ie. this._private.options.meta['*'].default
		*
		* @opt string|number   key  	Omitting is the same as passing '*'
		*
		* @return any|undefined 	The default value, or undefined if none exists
		*/
		SmartProto.prototype.getDefault=function(key){	
			var meta=getMeta.call(this,key);

			if(meta){
				//For constant keys the default value is overridden by the current value
				if(meta.constant && this.has(key)){
					return this.get(key); 
				}else if(meta.hasOwnProperty('default')){
					return meta.default;
				}else if(meta.nullable){
						return null;
				}
				//DevNote: If constantType==true and we don't have a default or it's nullable then we'll return
				//         undef vv as with everything else, but that will most likely cause an issue if we're 
				//		   resetting...
			}
			return undefined;
		}


		/*
		* Get all default values from this._private.options.meta (used eg. by .reset())
		*
		* NOTE: This will not include the '*' key, @see vv
		*
		* @return object|array|undefined
		*/
		SmartProto.prototype.getDefaults=function(){
			if(!this._private.options.meta)
				return undefined;
			
			var defaults=bu.getNestedProps(this._private.options.meta,'default'); //only children that have defaults will be included
			
			//Delete the 'global default' since setupMeta() has already distributed it to all other keys. 
			delete defaults['*'];

			//If we have no defaults...
			if(!Object.keys(defaults).length) 
				return undefined;
			
			//Now return it as a type matching this smarty
			if(this.constructor.name=='SmartArray')
				return Object.assign([],d);
			else 
				return defaults;
		}

/* END OF META */


























		/*
		* Make sure we have a number, else default to 100
		* @param any delay
		* @return number
		* @call(<SmartProto>)  for logging
		*/
		function getBufferDelay(delay){
			delay=Number(delay);
			if(!delay){
				this._log.warn("Buffers need a delay >0, defaulting to 100");
				delay=100;
			}
			return delay;
		}


		/*
		* @return number 	Returns the delay of the buffer, 0 => no buffer
		*/
		SmartProto.prototype.hasBufferEvent=function(){
			return this._private.buffer ? this._private.buffer.delay : 0
		}


		SmartProto.prototype.removeBufferEvent=function(){
			if(this.hasBufferEvent()){
				this.off('event',this._private.buffer.listener)
				delete this._private.buffer;
			}
			return;
		}

		/*
		* Create an event which buffers all events during a $delay and then emits ([unique keys...],[events...])
		*
		* NOTE: If called repeatedly you will only change the delay of the single buffer event
		*
		* @opt number delay 	Default 100 (warns)
		*
		* @return this
		*/
		SmartProto.prototype.addBufferEvent=function(delay){

			delay=getBufferDelay.call(this,delay);

			//If a buffer is already setup...
			var currentDelay=this.hasBufferEvent();
			if(currentDelay){
				if(currentDelay!=delay){
					this._log.debug(`Changing existing buffer delay from ${currentDelay} => ${delay}`)
					this._private.buffer.delay=delay;
				}
			}else{

				//Define a buffer which re-emits the 'buffer' event on this smarty (the args of that are:
				//  ( {key1:[evt1,evt3],key2:[evt2]...} , [evt1,evt2,evt3]  )
				this._private.buffer=bu.keyedBuffer(delay,this.emit.bind(this,'buffer'))

				//Create a listener (saving it so we can use it for removeBufferEvent())...
				this._private.buffer.listener=event=>{
					try{
						this._private.buffer.buffer(String(event.local?event.local.key:event.key),event);
					}catch(err){
						this._log.warn(err);
					}
				};
				//...and register it for the event 'event' 
				this.on('event',this._private.buffer.listener)
			}

			return this;
		}










		SmartProto.prototype.isBufferingBubbles=function(){
			return this._private.bubbleTimeouts ? true : false;
		}

		/*
		* Start buffering child events which bubbled up. 
		*
		* @param number delay 	Default 100 or whatever was set before
		*
		* @return this;
		*/
		SmartProto.prototype.bufferBubbledEvents=function(delay){
			
			this._private.bubbleDelay=getBufferDelay.call(this,delay);

			this._private.bubbleTimeouts=this._private.bubbleTimeouts||{};

			if(this._private.options.eventType=='nested')
				setTimeout(()=>{
					if(this._private.options.eventType=='nested')
						this._log.note("Buffering bubbles will have no effect until you setEventType('local')");
				},1)

			return this;
		}


		/*
		* Stop buffering child events which have bubbled up
		*
		* NOTE: Does nothing if we're not buffering
		*
		* @return void
		*/
		SmartProto.prototype.removeBubbleBuffer=function(){
			delete this._private.bubbleTimeouts;
			delete this._private.bubbleDelay;
			return;
		}




		/*
		* Set the type of events this smarty emits for changes to nested values.
		*
		* @param string type        'nested' or 'local'
		* @opt number bubbleDelay   Only used if $type=='local'. Defaults to 100
		*
		* @return void
		*/
		SmartProto.prototype.setEventType=function(type,bubbleDelay=100){
			if(!['nested','local'].includes(type))
				this._log.throwCode('EINVAL',"Accepted values: 'nested' or 'local'. Got:",type);
			
			//Set the type
			this._private.options.eventType=type;
			
			if(type=='local'){
				//If we're changing to local make sure we're also buffering bubbles, so we get single change events 
				//instead a spray of them
				if(!this.isBufferingBubbles())
					this.bufferBubbledEvents(bubbleDelay);

			}

			return this;
		}


















		SmartProto.prototype.isBufferingInput=function(){
			return this.hasOwnProperty('set');
		}


		/*
		* Start intercepting calls to .set() in order to throttle or debounce input
		*
		* @opt number delay 	Default 100. How often to allow new input
		* @opt string mode 		Default 'debounce'. Alternatively 'throttle'
		*
		* @return void;
		*/
		SmartProto.prototype.bufferInput=function(delay=100,mode='debounce'){
			if(!['debounce','throttle'].includes(mode))
				this._log.throwCode('EINVAL',"Arg #2 should be 'debounce' or 'throttle', got:",mode);

			//Create a method that intercepts prototype.set. NOTE: This will replace any previous intercept without checking
			Object.defineProperty(this,'set',{
				configurable:true
				,value:bu.betterTimeout(Number(delay)||100,SmartProto.prototype.set)[mode].bind(this)
			})

			return;
		}

		/*
		* Stop intercepting .set
		*
		* NOTE: Does nothing if we're not intercepting
		*
		* @return void;
		*/
		SmartProto.prototype.removeInputBuffer=function(){
			if(this.isBufferingInput());
				delete this.set;

			return;
		}













	//When smarties get nested, actions may sometimes refer to nested smarties, in which case we want to find it and call on it instead.

		/*
		* Get the deepest nested smarty.
		*
		* NOTE: If we have  this.smarty2.object1.smarty3 then smarty 2 will be returned as events from smarty3 have no way of bubbling up to us 
		* NOTE2: If array it GETS ALTERED. It will contain all remaining keys (at least 1) at the end. 
		*
		* @param array|string|number nestedKeys 	If string|number then this is returned, else we move down until !isSmart(). GETS ALTERED!
		*
		* @internal <SmartObject>|<SmartArray> parent 	
		*
		* @throw <ble TypeError> 	$nestedKeys wrong type
		*
		* @return <SmartObject>|<SmartArray> 	
		*/
		SmartProto.prototype.getDeepestSmarty=function(nestedKeys){
			
			var smarty=this;
			//We're at the deepest smarty if the key isn't an array or only has 1 key
			if(Array.isArray(nestedKeys) && nestedKeys.length>1){ 
				let child=this.get(nestedKeys[0],arguments[1]); //pass along possible CLEAN_KEY_TOKEN
				if(child instanceof SmartProto){
					//Store keys we traverse on a hidden prop
					if(!nestedKeys.hasOwnProperty('_nestedKeys'))
						Object.defineProperty(nestedKeys,'_nestedKeys',{value:[],writable:true});
					nestedKeys._nestedKeys.push(nestedKeys.shift());

					smarty=child.getDeepestSmarty(nestedKeys); //the remaining keys are not clean, so don't pass token
				}
			}
			return smarty;
		}






		/*
		* Check that the key that refers to a prop on this smarty is the correctt type (forcing if possible)
		*
		* NOTE: For simplicity we don't allow numeric keys on objects, this so we get same handling as when nested smarties
		*		are created automatically
		*
		* @param string|number localKey
		*
		* @return string|number       The correctly typed key
		* @call(this)
		*/
		function forceLocalKeyType(localKey){
			var expectedType=(this.isSmart=='SmartObject' ? 'string' : 'number');
			switch(typeof localKey){
				case expectedType: break;
				case 'string': 
					let nr=Number(localKey)
					if(!isNaN(nr)){
						localKey=nr;
						break;
					}
				default:
					this._log.throwCode('EINVAL',`Invalid key for ${this.isSmart}s. Expected ${expectedType}, got:`,localKey);
			}

			//Check it's not reserved
			if(this._private.reservedKeys.hasOwnProperty(localKey))
				this._log.throwCode("EINVAL",`This key is reserved on (this/all?) smarties: ${localKey}`)

			return localKey;
		}



		/*
		* @param string|array|number key   A delimited string, an array, or a single string/number
		* @return string|array|number      An array, or a single string/number
		* @call(this)
		*/
		function prepareKey(key){
			
			//Split on delim...
			if(typeof key=='string' && key.includes(this._private.options.keyDelim)){
				let arr=key.split(this._private.options.keyDelim);
				this._log.trace(`Split delimited key: ${key} => ${JSON.stringify(arr)}`);
				key=arr;
			}
			
			if(Array.isArray(key)){
				let localKey=forceLocalKeyType.call(this,key[0]);

				if(key.length==1){
					key=localKey; //If an array-key containing a single item was passed then just return that item...
				}else{
					//Copy key so it doesn't get altered
					key=key.slice(0);

					//Make sure we can always handle like string, for logging/printing etc... NOTE: this is not intended
					//to be used to access the value, which is why we don't use this._private.options.keyDelim
					Object.defineProperty(key,'toString',{writable:true,configurable:true,value:function(){return this.join('.')}}); //So we can always handle like string
					
					key[0]=localKey;
					
				}
			}else{
				key=forceLocalKeyType.call(this,key);
			}


			return key;
		}


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
		function prepareEvent(key,event,TOKEN){

			//Make sure we have an event object...
			if(event===true||event=='insert'){
				//Legacy support
				event={evt:'new'};
			}else{
				event=((event && typeof event=='object') ? event : {});
				//Allow some props to imply the evt is new... 
				if(event.add||event.insert||event.append)
					event.evt='new'
			}
				

			//...then populate it with some basics...
			event.key=key; //can be array or primitive
			if(event.evt=='new'){
				event.old=undefined;
			}else{
				if(Array.isArray(event.key) && event.key.length<2)
					this._log.throw("BUGBUG: event.key is array with <2 items:",event);
				event.old=this.get(key,TOKEN);
				if(Array.isArray(event.key) && event.key.length<2)
					this._log.throw("BUGBUG: get() altered event.key so it's an array with <2 items:",event);
				event.evt=event.old==undefined?'new':'change'; 
				 //DevNote: .delete() will change 'change'=>'delete'
			}


			//If we're changing something non-local we set the .local prop, ie. this prop signals non-local change (used by eg commonCommitSet())
			if(Array.isArray(key)){
				//NOTE: commonEmitChanges() expects .local to mimic the event as a whole
				event.local={ 
					key:key[0]
					,old:this.get(key[0],TOKEN)
				}
				event.local.evt=(event.local.old==undefined?'new':'change');

				//The .value on the other hand is used when smartifying complex children, so all we want is an empty object/array, but which one?
				event.local.value=(isNaN(Number(key[1]))?{}:[]);
				  //DevNote: The key array^ is at least 2 items long, the first item matching the type of this smarty, and the second 
				  //the type of the smarty to be created...
			}

			return event;

		}

		/*
		* @param string which              'commit' or 'prepare'
		* @param array|<arguments> args    The args to call the intercept with. NOTE: the last item should be an event obj
		*
		* @return mixed|INTERCEPT_TOKEN|SKIP_TOKEN
		* @call(<SmartProto>)
		*/
		function intercept(which,args){
			if(typeof this._intercept[which]=='function'){
				try{
					return this._intercept[which].apply(this,args); //this method can change the event in any way it pleases...
					 //NOTE: we don't always care what it returns...
				}catch(err){
					//At this point we won't be setting anything, but question is if we'll fail silently (causing .set() to 
					//return the old (ie. current) value), or bubble (causing .set() to throw and the external caller to 
					//have to handle the intercept)?
					let event=args[args.length-1];
					let prevented=`Prevented ${event.evt} '${event.key}' at ${which}-stage:`;
					//Check if it was deliberate...
					if(err=='intercept'){
						this._log.note(prevented,event);
					
						//Since we're not throwing we need a way to signal .setAndWait() that we're done...
						this.emit('intercept',event);
						
						//return early so we don't set anything or emit anything else
						return INTERCEPT_TOKEN;
					}else{
						//This works same for .set() and .setAndWait(), so no need to emit 'intercept'
						err=this._log.makeError(err).addHandling(prevented,event);
						err.intercept='commit'; //this way the external caller knows specifically it's an intercept
						throw err;
					}
				}
			}else{
				return SKIP_TOKEN;
			}
		}



		/*
		* Make sure key and value are the correct types for set() function
		*
		* @param mixed 	key 	String, number or array. Limited if @add!=undefined to number/array
		* @param mixed 	value 	The value to set.
		* @opt object 	event 	Any event passed in from external callers. If none is passed prepareEvent will create one
		*
		* @throws TypeError
		* @return object 		The passed in $event or a newly created one. Will be emitted after setting. Contains secret
		*						prop __smarthelp__ which is deleted before emitting.
		*
		* @sets event.key*2(in begining & final at end), event.old (final), event.value (temp, reset by commonCommitSet)
		* @call(<SmartArray>|<SmartObject>)
		*/
		function commonPrepareSet(key,value,event,TOKEN){
			// this._log.traceFunc(arguments);
			try{
				//First possibly intercept
				var arr;
				switch(arr=intercept.call(this,'prepare',[key,value,event])){
					case INTERCEPT_TOKEN: return INTERCEPT_TOKEN;
					case SKIP_TOKEN: break;
					default:
						if(!Array.isArray(arr)||arr.length!=3){
							this._log.throw("_intercept.prepare() should have returned an array with 3 items, got:",arr);
						}else{
							[key,value,event]=arr;
						}
				}

				//Prepare an event object
				event=prepareEvent.call(this,key,event,TOKEN);
				event.value=value;

				//We know we're on the deepest smarty and meta is only applied to local props, so get the meta for said local prop
				var localEvent=event.local||event;
				var localMeta=getMeta.call(this,localEvent.key);

				//Since this meta only applies to the local value...
				if(localMeta){
					//...if we're setting something nested there may not be any change to the local value...
					if(event.local && localEvent.evt=='change'){ 
						/*...which we determine based on:
					 		- event.local only exists if the set() is nested
					 		- If localEvent.evt=='change' that means the local prop already exists (and prepareKey() has assured us it won't change type)
					 		  -- localEvent.evt could =='new' if eg. set(['a', 'b'],'c') and this.a doesn't exist
					 	
					 	  Remember: localMeta.constant applies to local prop as a whole, ie. changes to nested props are not allowed if 
									the local meta says constant! That will be checked vv
						*/
					}else{
						localEvent.value=applyMeta.call(this,localMeta, localEvent.key, localEvent.value);
						 //^This also cleans the value, meaning it can change, which is why we don't "check same" til' after vv
					}
				}


				//If it's a change event... (remember: here we could be talking about nested or local...)
				if(event.evt=='change'){   
					//...we check if anything has actually changed at all (for which purpose we don't look at event.local)...
					if(event.old===event.value || (!isSmart(event.value) && bu.sameValue(event.old,event.value))){
					  //DevNote^: the same ref and the same contents of a stupid object are considered the same, but different smarties
					  //          (even with the same data) ARE NOT.

						this._log.trace(`Ignoring same value on '${event.key}':`,event.value); //don't remove this log, very good for debugging
						localEvent.evt=event.evt='none';
						 //We set both and nested events to 'none' so we can perform the check vv
					}
				}


				//If the local event has changed we check rules about .constant and .constantType
				if(localEvent.evt=='change' && localMeta){
					applyMeta.call(this,localMeta ,localEvent.key, localEvent.value, localEvent.old); //DevNote: including .old causes the second check
				}


				return event;

			}catch(err){
				// event.evt='error';//2020-03-31: Either we do this everywhere or nowhere... ie. not implemented yet
				throw this._log.makeError(err).addHandling("Failed to set:",Object.assign({this:this},event));
			}
		}





		/*
		* Apply meta restrictions on a key/value
		*
		* @param object        meta
		* @param string|number key
		* @param any           value
		* @opt any             old      If passed this method will only perform checks to see if the value is allowed to change
		*
		* @throw Error            Any error can be thrown by meta.cleanFunc              
		* @throw <ble EILLEGAL>   Non-approved key
		* @throw <ble TypeError>
		*
		* @return mixed 			The cleaned up version of $value
		* @call <SmartProto>
		*/
		function applyMeta(meta,key,value,old){
			try{

			//by NOT passing $old we only check $value...
				if(arguments.length==3){ 
					//Blocking superceeds everything
					if(meta.block){
						let allowed=bu.filterSplit(Object.entries(this._private.meta),arr=>!arr[1].block);
						this._log.throwCode("EILLEGAL",`Key '${key}' is blocked on this smarty, ie. it cannot be set().`,{allowed:allowed.map(arr=>arr[0]),blocked:allowed.rest.map(arr=>arr[0])});
										
					//Two quick checks...
					}else if(
						(meta.nullable && value==null)
						||(meta.hasOwnProperty('default') && value===meta.default) //default always accepted
					){
						//...to see if we can skip additional validation
					}else{ 

						//If there's a list of acceptable values... null is always accepted
						if(meta.accepted && !meta.accepted.includes(value)){
							this._log.makeError(`Value not among approved values:`,value).throw("EINVAL");
						}

						//If type is specified, try forcing it (ie. '3' => 3)
						if(meta.type){ 
							// console.log('applyMeta:',{key,meta,allMeta:this._private.meta});
							try{
								value=bu.forceType(meta.type,value); //throws TypeError
							}catch(err){
								err=this._log.makeError(err)
								if(err.code=='TypeError')
									throw err;
								else
									throw this._log.makeError(`Expected ${meta.type}, got:`,value,err).setCode('TypeError');
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

								 //If cleanFunc returns undefined it's the same as failing/throwing
								if(value==undefined)
									throw "meta.cleanFunc returned 'undefined'.";

							}catch(err){
								//NOTE: the cleanFunc is free to return whatever, even meta.default, but if it throws
								//      then that means we don't want setting to happen
								this._log.debug('_private.options:\n',this._private.options);
								throw err;
							}
						}
						
					}

			//...by passing $old we only check if the value is allowed to change. This block is designed to run when:
			//  a)  we've already run ^^
			//  b)  we know the data has changed
				}else{ 

					if(old===null){
						//we're always allowed to change away from null
					}else if(meta.nullable && value==null){
						// if nullable that superceedes any constants
					}else{
						//constant means it cannot change att all
						if(meta.constant){
							if(!bu.sameValue(old,meta.default)){
								this._log.throwCode('EALREADY',`Prop is constant, cannot change at all.`,'Remains set as:',old);
							}
						}

						//constantType means the type cannot change, but the value can...
						if(meta.constantType){
							let oldType=dataType(old), newType=dataType(value);
							if(oldType!=newType)
								this._log.throwCode('TypeError',`Prop has constant type, cannot change (${oldType} => ${newType})`,'Remains set as:',old);
						}
					}

				}
				
				//Sanity check. Make sure we didn't get an undefined value
				if(value===undefined){
					this._log.throwCode("BUGBUG","Somehow meta turned the value into 'undefined'");
				}

			}catch(err){
				this._log.makeError(err).addHandling(`Failed meta-validation for key '${key}':`,meta).throw();
			}

			return value;
		}




	
		/*
		* Handle setting or changing private data, depending on the new/old values etc.
		*
		* @param object 		event 		The event object we're going to emit and return. NOTE: gets manipulated
		* @opt string|number    pubKey 		A public getter to create. Only implemented if $event.evt==new. This can differ
		*									from event.key for arrays
		*
		* @return void
		*
		* @call(<SmartProto>)
		*/
		function commonCommitSet(event,pubKey){

			//Finaly sanity check that the value isn't undefined....
			if(typeof event.value=='undefined')
				this._log.throwCode("BUGBUG","Somehow the value has been made undefined, cannot set it.");

			//Possibly intercept...
			if(intercept.call(this,'commit',[event])==INTERCEPT_TOKEN)
				return INTERCEPT_TOKEN;
			//...and just make sure the intercept didn't set it to undefined
			if(typeof event.value=='undefined')
				this._log.throwCode("EINVAL","intercept.commit() set value to undefined, cannot set it.")
			
			
			
			

			try{
				
				//Sanity check
				if(event.local && (!Array.isArray(event.key) || event.key.length<2))
					this._log.throwCode("BUGBUG","event.local is set, but event.key is not an array with >2 items.");

				//If the old value is a smarty, delete it. Do this mercilessly because you should have used .replace() if you just
				//wanted to replace the contents
				if(!event.local && isSmart(event.old)){
				 //we check event.local^ because event.old may a smarty nested below a stupid child, in which case we don't care
					deleteSmartChild.call(this,event.key); //logs
				}
				

				//Check if the local value we're setting should be upgraded to a smarty
				{
					let _event=(event.local||event),_value=_event.value;
					if(_value && typeof _value=='object' && !_value.isSmart && this._private.options.smartifyChildren){
						//Create an empty smarty...
						let child=createSmartChild.call(this,_event.key,_value); //logs
					    
						//If the key points deeper we call .set() RECURSIVELY without emitting. This will create the full structure
						//synchronously before we adopt the child at the bottom vv
						if(event.local){
							child.set(event.key.slice(1),event.value,{noEmit:true}); //shorten the key and pass the final value...
							Object.assign(event,event.local);
							delete event.local; //this has now played it's part, remove else it'll trigger again vv
						}

						event.value=child;
						//At this point the event looks like a smarty was passed in to be set on a local key
					}
				}
				
				//Now set, handling nested keys and splicing onto arrays
				bu.dynamicSet(this._private.data, event.key, event.value, event.evt=='new');
				
				//Adopt local smarties (which may or may not have been created ^), implying we start bubbling their events
				if(!event.local && isSmart(event.value)){
					adoptSmartChild.call(this,event.key,event.value); 
				}

				//If we created a new local key we set create a public accessor for it
				if((event.local||event).evt=='new')
					setPublicAccessors.call(this,pubKey);


				let action=(event.evt=='new'?'Set new ':'Changed ')+(event.local?'nested prop ':'local prop ');
				this._log.trace(action+`'${event.key}': ${bu.logVar(event.old)} --> ${bu.logVar(event.value)}`);

				//If we're still running that means the set was successfull AND that we're the deepest child who 
				//wishes to emit it
				commonEmitChanges.call(this,event);

			}catch(err){
				throw this._log.makeError(`Failed to commit changes to key '${event.key}'`,{event,this:this},err);
			}

			return;
		}







		function createSmartChild(key,data){

			//Copy the options from this object (so they aren't ref'd together). 
			var options=bu.copy(this._private.options);
			 //^NOTE: this will also copy any options relating to the underlying BetterEvents
			
			//meta can be specified per key, we only pass on that which is intended for that key/child
			options.meta=getChildMeta.call(this,key);

			//If a name is on this, then the name of the child should have the key appended
			if(options.name)
				options.name+='.'+key;

			if(bu.isEmpty(data))
				this._log.debug(`Creating empty Smart${Array.isArray(data)?'Array':'Object'} for local key '${key}'`);
			else
				this._log.debug(`Going to smartify ${Array.isArray(data)?'array':'object'} bound for local key '${key}'`,data);


			var child=createSmarty(data,options);
			  //^this will log a trace with the options and it will mark it as this line
	
			return child;
		}


		/*
		* Start listening to events from another smarty and set it on this smarty
		*
		* @param string|number key 			
		* @param <SmartObject>|<SmartArray> child 		Another smarty that will become our child
		*
		* @return void
		* @call(<SmartProto>)   		The parent onto which the child should be set
		*/
		function adoptSmartChild(key,child){

			//Sanity check
			try{
				bu.checkType(['<SmartArray>','<SmartObject>'],child);
				key=forceLocalKeyType.call(this,key);
				if(this._private.data[key]!=child){throw new Error("Expected child smarty to already be set on local key "+key)}
			}catch(err){
				this._log.error("BUGBUG Failed sanity check",err,arguments,this);
			}

			//First listen to changes from the child. This listener changes the live event object so we... vv
			var childListener=(event)=>{
				try{
					//REMEMBER: This listener runs async, so when eg running assign() a bunch of stuff will have
					//          happened by the time we run here. 

					//First we need to get the local key, which is straighforward for objects, but may have 
					//changed for arrays
					var localKey=(this._private.data[key]==child ? key : this.findIndex(child))


					//Then we need to change the event.key. For same handling it's commonEmitChanges() that decides which
					//eventType to emit...
					if(Array.isArray(event.key)){
						event.key.unshift(localKey);
					}else{
						event.key=[localKey,event.key];
						
						//...and if he chooses to emit 'local' events he needs the event.local prop, which currently 
						//doesn't exist because .key wasn't an array when prepareEvent() ran... so we set that now
						event.local={old:event.old,key:localKey}
					}


					//NOTE: In the case of a 'move' event, .toKey is left unchanged, which is what move() expects

					commonEmitChanges.call(this,event);
				}catch(err){
					this._log.error(`Failed to propogate event from child smarty originally set on key '${key}'`,
						{this:bu.logVar(this),child:bu.logVar(child),event},err);
				}

			}

			//...set it to run AFTER any listeners on the child itself
			child.addListener('event',childListener,'+'); //+ => run at defaultIndex+1, ie. after the "normal" stuff

			//Then create a way to ignore the child. Since the child may be set on multiple parents, we'll store the listener
			//method locally, mapped to the child itself
			if(!this._private.childListeners)
				this._private.childListeners=new Map();
			this._private.childListeners.set(child,childListener);

			return;
		}



		/*
		* Stop listening to a smart child and remove it from local data.
		*
		* @param string|number key 
		*
		* @return <SmartProto> 				The child we just removed/ignored 	
		* @call(<smarty>)
		*/
		function deleteSmartChild(key){
			try{	
				//Sanity check		
				if(Array.isArray(key))
					this._log.throw("BUGBUG the key should NOT be an array here:",key);

				//Get the child at that key and make sure it's smart
				var child=this.get(key);
				if(isSmart(!child)){
					this._log.throw(`Key '${key}' is not a smart child:`,child);		
				}
				
				//Log if not supressed
				this._log.debug(`Deleting ${child.constructor.name} from local key '${key}'`);
				

				//Remove the listener from the child (future note: yes, the listener is on the child, but it changes stuff on this/us/parent)
				var listener=this._private.childListeners.get(child);
				child.removeListener(listener,'event');

				//Remove the child
				delete this._private.data[key];

				//Return the child
				return child;
			}catch(err){
				this._log.throw("Failed to delete smart child:",{key,child,listener,this:this});
			}
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
		* @emit '_foo.bar'	Like ^ but a nested prop. NOTE: This only happens if there are nested smarties
		*
		* @emit 'intercept' Only if ._intercept.emit is set AND it throws
		*
		* NOTE: ALL EVENTS EMIT THE SAME OBJECT
		*
		* @return void 			  
		* @call(<SmartProto>)
		* @async    Kind of...
		*/
		function commonEmitChanges(event){

			try{

				//IF for any reason we don't want the event emitted, eg @see revert()
				if(event.noEmit)
					return;

				//Sanity check. DevNote: This helps identify problems steeming from malformed events which
				//can otherwise be tricky to track down since events are async and lack a stack
				bu.checkProps(event,{key:['string','number','array'],evt:'string'});

				//If we're emitting local changes, but the change wasn't local...
				if(this._private.options.eventType=='local' && event.local){
					Object.assign(event,event.local);
					 //DevNote: This is where we need event.local.old... (added this note so ctrl+f finds ANY use of it)

					//We may also be buffering bubbles, in which case we setup a timeout so all changes to 
					//this key get emitted in one fell swoop
					if(this._private.bubbleTimeouts){
						if(!this._private.bubbleTimeouts.hasOwnProperty(event.key)){
							this._private.bubbleTimeouts[event.key]=setTimeout(()=>{
								//If the local key has since been removed, then that will already have been emitted
								//and we don't emit anything now
								if(!this.has(event.key))
									return;
								
								commonEmitChanges.call(this,event);
							},this._private.bubbleDelay)
						}
						return;
					}
				}
				//Delete this value since it's surved it's purpose. Leaving it to be used in adoptSmartChild>childListener()
				//is pointless because callbacks are async...
				delete event.local;

				//Just to make sure we emit the set value we .get() it. That also makes sure that options.getLive() is respected
				event.value=this.get(event.key);

				//We emit async, but we only want to emit to those listeners that existed BEFORE .set() or whatever was
				//called, so get those now
				var eventsAndlisteners={'event':this.getListenersForEmit('event')}
				eventsAndlisteners[event.evt]=this.getListenersForEmit(event.evt);
				eventsAndlisteners['_'+event.key]=this.getListenersForEmit('_'+event.key);

				
				//We can intercept the emit, either to change anything about the event OR reverting the changes thus 
				//supressing the event
				var intercept=this._intercept.emit
					,listenersForIntercept={listeners:this.getListenersForEmit('intercept')}
					,p=Promise.resolve()
					,self=this
				;
				if(typeof intercept=='function'){
					p=p.then(function commonEmitChanges_intercept(){return intercept.call(self,event)})
					   .catch(function commonEmitChanges_reverting(err){
					   		//First create a new event-obj to pass along so the reverting action doesn't emit anything	
							var revEvt={noEmit:true}
							switch(event.evt){
								case 'new':
									self.delete(event.key,revEvt);
									break;
								case 'delete':
									revEvt.evt='new'; //so we insert in the case of SmartArrays 
								case 'change':
									self.set(event.key,event.old,revEvt);
							}
					   		
					   		//In order for .setAndWait() to work we emit this (the event obj has a token <-- will look for)
					   		self.emit('intercept',event,listenersForIntercept);
							
							self._log.note(`Reverted ${event.evt} '${event.key}' to:`,event.old);

					   		//Let the err bubble through to last catch vv where it is exec'd
							throw err;
						})
					;
				}

				//Now we know we're emitting, ie. now there is no turning back and a change has happend, so we increment the version
				this._private.version++;

				//Then run all emits simoultaneously
				p.then(function commonEmitChanges_emitting(){
					for(let evt in eventsAndlisteners){
						self.emit(evt,event,{'listeners':eventsAndlisteners[evt]});
					}
				})

				//Finally catch and log any errors because nobody is handling them
				.catch(err=>{
					//Logging the error can be supressed by throwing 'intercept' in the intercepting function
					if(err!='intercept')
						self._log.makeError(err).addHandling('The offending event:',event).exec();
				})

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
			//Make sure we have an event object so we can match emitted events against it
			if(!event || typeof event!='object')
				event={};
				// NOTE: we don't accept the "append boolean" as arg #3 like SmartArray.

		//2020-11-14: It should be enough to just match the event object... 		
			// var flag=Symbol('setAndWait')
			// Object.defineProperty(event,'__setAndWaitFlag__',{value:flag,writable:true});

			var {promise,resolve,reject}=bu.exposedPromise();

			this.addListener(/(event|intercept)/,(_event)=>{
		//2020-11-14: ^^
				if(_event==event){
				// if(_event.__setAndWaitFlag__==flag){
					// delete _event.__setAndWaitFlag__

					//We're only listening to 2 events, so it's either...
					if(_event.evt=='intercept')
						reject(_event);
					else
						resolve(_event);

					//We're only expecting one of these events to fire, so tell BetterEvents to remove this listener by returning...
					return 'off' 
				}
			},index)
			try{
				this.set(key,value,event);
			}catch(err){
				reject(err);
			}
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

		/*
		* Call .set with an event object, and return that event
		*
		* @param object event       The event object that will be emitted AND returned. At least the prop .key should be set
		* 	@param string|number|array   key
		* 	@opt   any                   value     If undefined then this.delete(key) will be called               
		*
		*
		* @return object 					The value after setting
		*/
		SmartProto.prototype.setEvent=function(event){
			//Make sure we have an object with at least a key
			bu.checkProps(event,{key:['string','number']})

			//Call set like usual...
			this.set(event.key,event.value,event);

			//Return the passed in event, which probably has been altered
			return event;
		}
































/**********  "Multi-set" commands *************/



		/*
		* Common "check and prepare data" for .assign, .replace and .fillOut. 
		*
		* @param <SmartProto>|object|array data
		* @opt boolean checkSame                   If true we also check for same as current value
		*
		* @return object|array|SAME_VALUE_TOKEN|undefined          Stupid data or undefined if $data was empty or SAME_VALUE_TOKEN the same data is already set
		*/
		function checkMultiSet(data,checkSame=false){
			
			if(bu.isEmpty(data))
				return undefined;

			//The data should be the same type as our data
			if(dataType(data)!=dataType(this))
				this._log.throwType(`<${this.isSmart}> or ${dataType(this)}`,data);

			//If it's smart we just get the data...
			data=data.isSmart ? data.copy() : data;

			if(checkSame && bu.sameValue(data,this._private.data)) //2020-11-06: Is it faster just to let .set() check this for each?
				return SAME_VALUE_TOKEN;

			return data;
		}


		/*
		* Set multiple key/values on this object 
		*
		* NOTE: Difference between assign and combine
		*       this={foo:bar,list:[a,b]})  assign({list:[c]})  => {foo:bar,list:[c]}
		*                                   combine( --""-- )   => {foo:bar,list:[c,b]}
		*
		* @param object|array data 	Matching type of instance
		* @opt flag 'noEmit' 		Supress events (good for initial values)
		* @opt flag 'entries' 		The data is already in format [ [[a,b],3], [["a.d"],3] [c,4] ]
		* @opt flag 'tryAll'        If any error is encountered with individual key/values the remaining data 
		*                            be attempted to be set before throwing.
		*
		* @throws <ble TypeError>
		* @throws <ble ...> @see this.set()
		*
		* @emit new,change,delete (via this.set)
		*
		* @return object|undefined 		If no changes occured then undefined is returned. Else an object with same keys
		*								as @obj for those values that have changed. Values are the old values
		*/
		SmartProto.prototype.assign=function(data,...flags){

			try{
				//First we need a list of entries, since the keys may be arrays pointing to multiple layers
				if(flags.includes('entries')){
					bu.checkTypedArray(data,'array'); //make sure all items within the array are also arrays
					if(bu.isEmpty(data)){
						this._log.trace("Empty list of entries passed in, nothing to assign...");
						return undefined;
					}
					var entries=data;

				}else{
					//If we've already flattened, then we'll always have an object and we won't be able to compare
					//same value, so skip this vv step
					if(flags.includes(!'flat')){
						data=checkMultiSet.call(this,data,'check same value')//makes data stupid
						if(!data){
							this._log.trace("Empty obj passed in, nothing to assign...");	
							return undefined;
						}else if(data==SAME_VALUE_TOKEN){
							this._log.debug("All values were the same as before, ie. no change.");
							return undefined;
						}
					}

					entries=Object.entries(data);
					//NOTE: If data is nested this will only assign on the local level, ie. any conflicting nested 
					//      objects already on this smarty will be replaced entriely instead of individual sub-properties
					//      being changed
				}

				var remaining=entries.length;
				this._log.trace(`Assigning ${remaining} values:`,entries);
				
				//Set each value, storing the old value if there where any changes
				var oldValues=newDataConstructor(this);
				var noEmit=flags.includes('noEmit');
				var failed=flags.includes('tryAll')?[]:undefined;
				for(let i in entries){
					let key=entries[i][0]
						,value=entries[i][1]
					;
					try{
						let old=this.set(key,value,(noEmit?{'noEmit':true}:{}))
						if(old!=value){
							bu.dynamicSet(oldValues,key,old,'insert'); 
							 //Since we don't know the order of the entires we 'splice' whenever possible since we won't be overwriting anything here
						}
						remaining--
					}catch(err){
						if(failed)
							failed.push(entries[i].concat(err))
						else
							throw err;
					}
				}

				//If we were trying all before throwing, we want to throw now
				if(failed && failed.length)
					throw 'Encountered multiple errors while trying to assign all data. See err.failed for [[key,value,err],...]';

				//If no changes happened, return undefined like ^^
				if(!Object.keys(oldValues).length){
					this._log.debug("All values were the same as before, ie. no change.");
					return undefined
				}else{
					return oldValues;
				}
				
			}catch(err){
				err=this._log.makeError(err).addHandling(`Failed to assign ${Math.round(remaining/entries.length*100)}% of data:`,data)
				if(failed && failed.length)
					err.failed=failed;
				err.throw();
			}
		}


		/*
		* Set multiple, optionally nested, key/values on this and child objects
		*
		* NOTE: this={foo:bar,list:[{x:1},b]})  assign({list:[c]})  => {foo:bar,list:[c]}
		*                                       combine( --""-- )   => {foo:bar,list:[c,b]}
		*
		* @param object|array data 	Matching type of instance, or @see $entries
		* @opt number depth         Default 30. To what depth should "combining" happen? Deeper levels will be overwritten
		*
				combine({list:[{y:2}]},1)  => {foo:bar,list:[{y:2},b]}
		*       combine({list:[{y:2}]},2)  => {foo:bar,list:[{y:2},b]}                           combine( --""-- )   => {foo:bar,list:[c,b]}

		* @throws TypeError
		* @emit new,change,delete (via this.set)
		*
		* @return object|undefined 		If no changes occured then undefined is returned. Else an object with same keys
		*								as @obj for those values that have changed. Values are the old values
		*/
		SmartProto.prototype.combine=function(data,depth=30){
			try{
				var entries=bu.flattenObject(data,'entries',depth);
			}catch(err){
				throw this._log.makeError('Failed to combine this smarty with new data. ',err,data)
			}
			try{
				return this.assign(entries,'entries');
			}catch(err){
				err.msg=err.msg.replace('assign','combine',...Array.from(arguments).slice(2));
				throw err;
			}
		}




		/*
		* Replace all data on this and nested smarties. It differs from empty+assign in that it only makes the necessary
		* changes, not brutally deletes everything first
		*
		* @param object obj
		* @opt number depth   	Default 1. At what level 
		*
		* @throws TypeError
		* @emit new,change,delete (via this.set)
		*
		* @return object|undefined 		If no changes occured then undefined is returned. Else an object with keys 
		*								of the properties that changes and their old values
		*/
		SmartProto.prototype.replace=function(data,depth=1){
			//If we're replacing with empty data then remove it all!
			data=checkMultiSet.call(this,data,'check if same value');//makes data stupid
			if(!data){ 
				this._log.trace("Replacing with no data => emptying...");
				return this.empty();
			}else if(data==SAME_VALUE_TOKEN){
				this._log.debug("All values were the same as before, ie. no change.");
				return undefined;
			}

			//To replace we get a flat object of all existing keys set to undefined. (DevNote: We don't get entries)
			var flat=bu.objCreateFill(Object.keys(this.flatObject(depth)),undefined)	
			 //^this did eg. {'a':{'b':3,'c':4} }  =>  {'a.b':undefined, 'a.c':undefined}
			
			//...then we turn the data flat and assign it over ^
			Object.assign(flat,bu.flattenObject(data,this._private.options.keyDelim,depth)); 		
			 //^this did eg. 
			 //  1.     {'a':{'c':1}, 'd':8}  =>  {'a.c':1, 'd':8}
			 //  2.  {'a.b':undefined, 'a.c':undefined} + {'a.c':1, 'd':8}  =>  {'a.b':undefined, 'a.c':1, 'd':8}

			//Now we assign^ which will delete 'a.b', change 'a.c' and set 'd' 
			return this.assign(flat,'flat',...Array.from(arguments).slice(2));
		}






		/*
		* Similar to .assign() except it only sets those values where the keys don't already exist
		*
		* @param object|array filler
		*
		* @return object|array|undefined 	If no changes occured then undefined is returned. Else an object|array with 
		*									the keys/values that were assigned. 
		*									 ^NOTE: this differs from .assign which returns keys and their *old* values
		*/
		SmartProto.prototype.fillOut=function(filler){

			//Copy (since we will be altering it) and check the filler 
			if(!(filler=checkMultiSet.call(this,bu.copy(filler)))){ //makes data stupid
				this._log.trace("Nothing passed in, nothing to fill out with:",arguments);
				return undefined
			}
			 //NOTE: here ew DON'T check for same value since we're not interested in the values but the keys
	
			//Remove all keys we already have, then check if we have anything left
			var excluded=bu.extract(filler,this.keys(),'excludeMissing');
			if(Object.keys(filler).length){
				if(excluded.length)
					this._log.trace("Ignoring the keys that already exists:",excluded);

				this.assign(filler,...Array.from(arguments).slice(1)); //ignore the return, since all values on it are undefined... instead we return vv
				return filler;

			}else{
				this._log.trace("All keys already exists:",excluded);
				return undefined;
			}
		}


		/*
		* Similar to .fillOut() except all keys are given the same value
		*
		* @param array keys
		* @param mixed value
		*
		* @return array|undefined 	An array with the keys that were assigned, or undefined if nothing changed
		*/
		SmartProto.prototype.fillWith=function(keys,value,copyValue=true){
			var change=this.fillOut(objCreateFill(keys,value,copyValue));
			if(change)
				return Object.keys(change);
			else
				return undefined;
		}





		/*
		* Store the current value of the smarty, enabling it to be reverted to
		*
		* @return function  If called it reverts this and any nested smarties to the state they were in
		*/
		SmartProto.prototype.takeStateSnapshot=function(){
			
			//Flatten the current object without going into any nested smarties, instead take a snapshot as well so
			//we can restore recursively...
			var recursive=[], maxdepth=0;
			var flat=bu.flattenObject(this,this._private.options.keyDelim,(address,value)=>{

				maxdepth=Math.max(maxdepth,address.length);

				if(value.isSmart){
					recursive.push([address,value,value.takeStateSnapshot()]);
					return false;
				}
				return true;
			});

			var self=this;
			return function revert(){
				self.log.note("Reverting to previous state",{beforeRevert:this.copy(),});
				
				//First revert locally and all nested dummies... If this fails we throw and it may possibly be caught
				//this same function higher up the tree...
				SmartProto.prototype.replace.call(self,flat,'flat')
				
				//Then move on to nested smarties. Here we catch any errors and 
				var nested=[],msg="Failed to revert nested smarties:";
				for(let [address,smarty,rev] of recursive){
					try{
						rev();
					}catch(err){
						//If this is the same error we throw vv then add all the nested smarties there
						//to our own array, prepending the address we have... once we get back to the top
						//recursion level this error will be thrown to the original caller and include
						//all the nested smarties and their errors
						if(err.message==msg){
							err.extra[0].forEach(arr=>{
								nested.push([address.concat(arr[0]),arr[1]])
							})
						}else{
							smarty._log.error(err); //log on the smarty itself...
							nested.push([address,smarty,err])
						}
					}
				}
				if(nested.length)
					self._log.makeError(msg,nested).throw();
			};
		}

































	/* GETTERS that work for both types*/





		/*
		* Check if a key exists
		*
		* @param string|number|array key 	
		*
		* DevNote: to check if smarty has a value use smarty.includes()
		*
		* @throws <ble TypeError> 
		*
		* @return mixed 			  
		*/
		SmartProto.prototype.has=function(key){
			key=prepareKey.call(this,key);
			if(Array.isArray(key)){
				return bu.nestedHas(this._private.data,key);
			}else{
				return this._private.data.hasOwnProperty(key);
			}
		}

		/*
		* Check if a value exists on this smarty
		*
		* @param any|function test 		@see findIndex
		*
		* @return boolean
		*/
		SmartProto.prototype.hasValue=function(val){
			if(val===undefined)
				return false;

			return this.find(val)==undefined?false:true;
		}

		/*
		* @alias .includes() => .hasValue()
		*/
		SmartProto.prototype.includes=SmartProto.prototype.hasValue;



		/*
		* Get a single prop or the whole data structure. The structure will always be non-live, but individual values
		* will respect options.getLive. 
		*
		* NOTE: that nested smarties will always be returned live
		*
		* @param string|number|array|undefined key 	 Undefined to get the entire object, a string/number to get a single local prop
		*                                              or an array to get a nested prop
		*                                          
		* @throws <ble TypeError> 		If $key is wrong type
		* @throws <ble EMISMATCH> 		If $key is array and there is a non-object along keypath
		*
		* @return mixed 			  
		*/
		SmartProto.prototype.get=function(key=undefined){
			if(!isSmart(this)){
				BetterLog._syslog.throw('SmartProto.prototype.get() called in wrong context, this: ',this);
			}

			var value;
			if(key==undefined){ //will trigger on both undefined and null
				//We're going to return all data in a regular array/object, but it should not be the 
				//live this._private.data to prevent accidental change. options.getLive is implemented 
				//when each key is fetched
				value=newDataConstructor(this)
				for(let k of this.keys()){
					value[k]=this.get(k,CLEAN_KEY_TOKEN)
				}
	
			}else{
				if(arguments[1]!=CLEAN_KEY_TOKEN){
					key=prepareKey.call(this,key); 
					 //DevNote: ^this copies key arrays so we don't have to worry getDeepestSmarty() will alter the passed in key
				}

				//If the key isn't pointing to something local...
				if(Array.isArray(key)){
					if(arguments[1]==CLEAN_KEY_TOKEN){ //if we didn't prepareKey() here ^ then we need to copy it now 
						key=key.slice(0); 
					}

					//...first check if there's a deeper smarty along the keypath...
					var nestedSmarty=this.getDeepestSmarty(key,CLEAN_KEY_TOKEN); 
					if(nestedSmarty && nestedSmarty!=this){
						//...in which case ask it to get instead
						return nestedSmarty.get(key); //$key has been altered 
					}else{
						//...else traverse what should be complex data
						value=bu.nestedGet(this._private.data,key);
					}	
				}else if(this._private.data.hasOwnProperty(key)){
					value=this._private.data[key];
				}
				
				// if(value==undefined){
				// 	if(key.length==1)
				// 		this._log.traceCalled(`Key '${key}' is not set on this smarty`);
				// 	else
				// 		this._log.trace(`Key '${key}' is not set on this smarty`);
				// }

				//At this point value may be anything, incl. undefined...

				if(!value || typeof value!='object' || this._private.options.getLive==true || value instanceof SmartProto){
					//do nothing
				}else{
					value=bu.copy(value); 
				}
			}

			return value;
		}


		

		/*
		* Get a non-smart, non-live copy of the data on this smarty
		*
		* NOTE: This will remove any values that are functions (which we are allowing since 2020-02-19)
		*
		* @return object|array
		*/
		SmartProto.prototype.copy=function(key=undefined){
			if(!key){
				return bu.copy(this); //this.toJSON will return this._private.data
			}else{
				var val=this.get(key);

				//If the children havn't already been made stupid...
				if(isSmart(val) || this._private.options.getLive){
					//...decouple here...
					return bu.copy(val);
				}else{
					return val; //decoupling already done in this.get()
				}
			}
		}
		SmartProto.prototype.stupify=SmartProto.prototype.copy





		/*
		* Get several key/values from this object.
		*
		* @param array|strings...|numbers... keys 		A list of keys to get. Nested keys OK
		*
		* @return array|object     Type matches instance (not smart)
		*/
		SmartProto.prototype.subObj=function(...keys){
			if(keys.length==1&&Array.isArray(keys[0]))
				keys=keys[0];

			var sub=newDataConstructor(this);
			for(let key of keys){
				sub[key]=this.get(key);
			}

			return sub;
		}




		/*
		* Get the index of the first value that satisfies a test
		*
		* @param mixed test 	A function that will be .call(this,item,index) or a any value that will be 
		*							tested === against each item
		* @flag 'last'          If passed the last index of the value will be returned
		*
		* @return number 		The index or -1. NOTE: the string '-1' is not the same (it may be a key of a smart object)
		*/
		SmartProto.prototype.findIndex=function(test){
			if(test===undefined)
				return -1;
			var keys=Array.from(arguments).includes('last') ? this.keys().reverse() : this.keys();

			if(typeof test=='function'){
				for(let key of keys){
					let val=this.get(key);
					if(val===test||test(val,key,this))
						return key;
				}
			}else{
				for(let key of keys){
					if(test===this.get(key))
						return key;
				}
			}
			return -1;
		}

		/*
		* @alias .indexOf() => .findIndex()
		*/
		SmartProto.prototype.indexOf=SmartProto.prototype.findIndex


		/*
		* @shortcut .lastIndexOf(value) => .findIndex(value,'last')
		*/
		SmartProto.prototype.lastIndexOf=function(value){
			return this.findIndex(value,'last');
		}

		/*
		* Get all indices of values that satisfy a test
		*
		* @param mixed test 		A function that will be passed (item,index) or a any value that will be tested === against each item
		*
		* @return array[number] 	An array of numbers, or an empty array
		*/
		SmartProto.prototype.findIndexAll=function(test){
			var arr=[];
			if(typeof test=='function'){
				for(let key of this.keys()){
					let val=this.get(key);
					if(val===test||test(val,key,this))
						arr.push(key);
				}
			}else{
				for(let key of this.keys()){
					if(test===this.get(key))
						arr.push(key);
				}
			}
			return arr;
		}


		/*
		* Get the first value that matches a test
		*
		* @param any|function test 		@see findIndex
		* @flag 'last' 					@see findIndex
		*
		* @return undefined|any 
		*/
		SmartProto.prototype.find=function(){
			var key=this.findIndex.apply(this,arguments);
			return key==-1 ? undefined : this.get(key);
		}

		SmartProto.prototype.findLast=function(test){
			return this.find(test,'last');
		}

		/*
		* Get a new subobject of all key/values that match a test
		*
		* @param any|function test 		@see findIndex
		*
		* @return array
		*/
		SmartProto.prototype.findAll=function(test){
			return this.subObj(this.findIndexAll(test));
		}




		/*
		* Find the first matching value and delete it
		*
		* @param function test 	A function to test each item with (@see this.findIndex())
		*
		* @emit delete
		*
		* @throw TypeError
		*
		* @return mixed|undefined 		The removed item, or undefined if none existed in the first place
		*/
		SmartProto.prototype.findDelete=function(test){
			let i=this.findIndex(test);
			if(i>-1)
				return this.delete(i);
			else
				return undefined;
		}

		/*
		* @throw DEPRECATED
		*/
		SmartProto.prototype.extract=function(){
			this._log.throwCode("DEPRECATED","Use .findDelete() instead of .extract()");
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
		* @return object|array 		The deleted key/values
		*/
		SmartProto.prototype.findAllDelete=function(test){
			bu.checkType('function',test);
			var deleted=newDataConstructor(this);;
			this.forEachBackwards((value,key)=>{
				if(test.call(this,value,key))
					deleted[key]=this.delete(key);
			})
			return deleted;
		}



		











/* Looping */

		/*
		* Run a callback for each key/value, ignoring any results
		*
		* @param function fn 	Called with (value,key,this)
		*
		* @throw TypeError
		*
		* @return this
		*/
		SmartProto.prototype.forEach=function(fn){
			bu.checkType('function',fn);
			for(let key of this.keys()){
				fn.call(this,this.get(key),this);
			}
			return this;
		}



		/*
		* @see forEach but in reverse order (which enables deleting without messing up the index)
		*
		* @param function fn
		*
		* @throw TypeError
		*
		* @return this
		*/
		SmartProto.prototype.forEachBackwards=function(fn){
			bu.checkType('function',fn);
			for(let key of this.keys().reverse()){
				fn.call(this,this.get(key),key,this);
			}
			return this;
		}


		/*
		* Run a callback for each key/value, retaining the results
		*
		* @param function fn 	Called with (value,key,this)
		*
		* @throw TypeError
		*
		* @return array|object 	Matching data type of this. The results from each call
		*/
		SmartProto.prototype.map=function(fn){
			bu.checkType('function',fn);
			var output=newDataConstructor(this);
			for(let key of this.keys()){
				output[key]=fn.call(this,this.get(key),this);
			}
			return output;
		}


		/*
		* Run a test for each value, returning true if they all return true
		*
		* @param mixed @see .find()
		*
		* @return boolean
		*/
		SmartProto.prototype.every=function(test){
			return Object.values(this.findAll(test)).length==this.length
		}

		/*
		* Start running a test for each value, returning true the moment any return true, else false
		*
		* @param mixed @see .find()
		*
		* @return boolean
		*/
		SmartProto.prototype.some=function(test){
			return this.find(test)!=undefined;
		}



















		/*
		* Delete a local or nested key
		*
		* @param string|number key
		* @opt object event
		*
		* @throw <ble EILLEGAL>     If meta is preventing key from being deleted (or nulled, or reset to default)
		*
		* @return any|undefined 			The old value that was removed (which may be undefined == nothing was removed)
		*/
		SmartProto.prototype.delete=function(key,event={}){
			//Parse the key
			key=arguments[0]=prepareKey.call(this,key);

			//First check if this method should be executed on a nested smarty, in which case do so and return the value right away 
			//(events will bubble from that child...)
			var nestedSmarty=this.getDeepestSmarty(key,CLEAN_KEY_TOKEN); 
			if(nestedSmarty && nestedSmarty!=this)
				return nestedSmarty.delete(key,event); //$key has been altered

			//Ok, so this smarty will be doing the work, so create the event...
			event=prepareEvent.call(this,key,event,CLEAN_KEY_TOKEN);
			event.evt='delete';
			event.value=undefined;

			//...then do a quick check to see if there's even anything to delete
			if(event.old==undefined)
				return undefined; //ie. nothing was set here before


			//If we're deleting locally, check meta (which only applies to local props)...
			if(!Array.isArray(event.key)){
				//...to see if it's allowed to be deleted
				var meta=getMeta.call(this,event.key);
				if(meta && (meta.required || meta.constant || meta.constantType)){
					let alt;
					if(meta.nullable){
						alt=null;					
					}else if(meta.hasOwnProperty('default')){
						alt=meta.default;
					}else{
						this._log.throwCode("EILLEGAL",`Meta preventing key '${event.key}' from being deleted.`,meta);
					}
					event.src=event.src||'delete';
					return this.set(key,alt,event);
				}
			}

			//Ok, so we're deleting something...
			if(isSmart(event.old)){				
				deleteSmartChild.call(this,event.key); //this will log

			}else{
				this._log.trace(`Deleting key '${event.key}':`,bu.logVar(event.old));

				//If the key is an array then we're deleting something nested, else something local. In both cases it
				//could be a primitive or object we're deleting, but it makes no diff
				bu.dynamicDelete(this._private.data,event.key);
			}

			//If we're deleting locally we'll need to do some extra cleanup
			if(!Array.isArray(event.key)){
				if(this.isSmart=='SmartArray'){
					//The array just got shorter, remove last getter from this object
					delete this[this.length];
					
					//...then remove the actual item
					this._private.data.splice(key,1);                                           //...which we remove here
				}else{
					delete this[key];
				}
			}

			//Finally emit and return
			commonEmitChanges.call(this,event);
			return event.old;
		}










		/*
		* Delete all items on this smarty
		*
		* @opt flag 'finish' - if this.delete() fails, log the error and continue deleteing the rest. if at the end any data remains this throws as normal
		* @opt flag 'noEmit' - pass {noEmit:true} to this.delete
		*
		* @emit delete (via this.delete)
		*
		* @throw <ble ENOTEMPTY> 		If not all data was removed at the end
		*
		* @return array|object|undefined 	If no changes occured then undefined is returned. Else a snapshot of the data
		*									before emptying
		*/
		SmartProto.prototype.empty=function(...flags){
			
			if(bu.isEmpty(this._private.data))
				return undefined;

			this._log.traceFunc(arguments);

			var noEmit=flags.includes('noEmit')
				,finish=flags.includes('finish')
				,oldValues=newDataConstructor(this)
				,keys=this.keys()
				,i=keys.length
			;
			while(i--){
				let key=keys[i];
				try{
					oldValues[key]=this.delete(key,{noEmit});
				}catch(err){
					let msg=`Problems empyting ${this.constructor.name} while processing key '${key}'.`;
					if(finish)
						this._log.error(msg,err);
					else
						this._log.throw(msg,err);
				}
			}

			//Make sure everything is gone (which it very well may not be if 'finish' flag was used)
			if(bu.isEmpty(this._private.data))
				return oldValues;
			else
				this._log.throwCode('ENOTEMPTY',"Was unable to delete everything. The following still exists:",this._private.data);
			
		}


		/*
		* Remove all data without checking anything (ignoring meta) or emitting anything. 
		* @return void
		*/
		SmartProto.prototype._brutalEmpty=function(){
			 this._log.warn("The following data will be removed without checking meta or emitting delete events:",this._private.data);

			removePublicAccessors.call(this);

			this._private.data=newDataConstructor(this)
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
				
				//Check if we have any defaults, else this is the same as emtpying...
				var defaults=this.getDefaults();
				if(!defaults){
					this._log.debug(`No default values set, emptying...`);
					return this.empty(); 
				}

				//Combine default keys with those currently set, we'll be calling this method on all of them which will
				//delete those without defaults and reset those with...
				var keys=this.keys().concat(Object.keys(defaults)).filter(bu.uniqueArrayFilter);

				//Especially for arrays it's important we set key 0 first since this may be empty and things have 
				//to remain sequential, hence we shift
				this._log.debug('Resetting all keys:',keys);
				var oldValues=newDataConstructor(this)
				while(key=keys.shift()){
					oldValues[key]=this.reset(key);
				}

				return oldValues
			}

			var meta=getMeta.call(this,key);
			if(meta.constant){
				//don't reset if key is constant
				return this.get(key); 

			}else if(meta.hasOwnProperty('default')){
				var dflt=meta.default;
			}
			if(dflt!==undefined){

				//First set the default value...
				if(bu.sameValue(this.get(key),dflt)){
					this._log.trace(`No need to reset key '${key}', it already has its default value: ${bu.logVar(dflt)}`);
				}else{
					this._log.trace(`Resetting key '${key}' from ${bu.logVar(this.get(key))} --> ${bu.logVar(dflt)}`);
					var oldValue=this.set(key,dflt,null,true); //true==no log, done vv instead
				}

				//...and if it happens to be smart call reset on it too. Do this AFTER ^ so that changes from resetting vv is
				//emitted on this smarty too
				if(isSmart(dflt)){
					this._log.trace(`Calling reset on nested smarty on key '${key}'`,dflt);
					dflt.reset();
				}

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
			
			var types=bu.checkProps(event,{evt:'string',key:['string','number','array']});

			if(this._log.options.lowestLvl<3)
				this._log.debug(`Replicating ${event.evt}(${typeof event.key=='object' ? event.key.join('.') : event.key},${String(event.value)})`);
			 	//^ if transmitting over uniSoc then key.toString won't be what we set it to in commonEmitChanges()

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
					this._log.throw("Expected arg#1 to be 'new', 'change' or 'delete', got: "+bu.logVar(evt));
			}
		}


		/*
		* Shortcuts to start and stop replicating one smarty to another
		*
		* Since far from all smarties will use replication, it's unecessary to create a Map for each one, instead that is
		* done when we start replicating
		*/
			/*
			* Since far from all smarties will use replication, it's unecessary to create a Map for each one... this
			* checks and sets one up when needed
			*
			* @param <SmartProto> source 	The smarty where the data comes from, which implies where we'll listen for events
			* @param <SmartProto> target 	The smarty where the data is going
			*
			* @throw <ble ESAME>       If source and target are the same
			* @throw <ble TypeError>
			* 
			* @return <Listener>|undefined	A Listener object from the BetterEvents class if we're already replicating, else undefined
			*/
			function alreadyReplicating(source,target){
				if(source==target)
					BetterLog._syslog.throwCode("ESAME","Cannot replicate to/from the same smarty");
				
				//the way it's called we're always sure one of the args is a smarty, but the other...
				if(!source || !source.isSmart || !target || !target.isSmart) 
					BetterLog._syslog.throwType("another smarty",source.isSmart?target:souce);
				
				var map=source._private.replications||(source._private.replications=new Map());
				return map.get(target);
			}

			/*
			* Start replicating changes from one smarty to another
			*
			* @param <SmartProto> source 	@see alreadyReplicating()
			* @param <SmartProto> target 	@see alreadyReplicating()
			*
			* @return boolean 		True if replication was started now, false if it was already running. Regardless, after this function
			*						returns replication is happening
			*/
			function startReplicating(source,target){
				if(!alreadyReplicating(source,target)){
					source._private.replications.set(target,source.on('event',target.replicate.bind(target)));
		//TODO: Set something on the target so we can tell it's receiving replication...
					return true;
				}else{
					return false;
				}
			}

			/*
			* Stop previously started replication
			*
			* @param <SmartProto> source 	@see alreadyReplicating()
			* @param <SmartProto> target 	@see alreadyReplicating()
			*
			* @return boolean 		True if replication was stopped now, false if it was not previously running. Regardless, no replication 
			*						is happening after this function returns
			*/
			function stopReplicating(source,target){
				if(alreadyReplicating(source,target)){
					source.off('event',source._private.replications.get(target)); //stop lisetning for changes
					source._private.replications.delete(target); //delete from map so we know it's gone
					return true;
				}else{
					return false;
				}
			}

			/*
			* Call on source object to send changes to another (target) object
			* @param <SmartProto> target 		@see alreadyReplicating()
			* @return boolean					@see startReplicating()
			*/
			SmartProto.prototype.replicateTo=function(target){
				return startReplicating(this,target);
			}
			
			/*
			* Call on target object to monitor another object for changes and replicate them here
			* @param <SmartProto> target 		@see alreadyReplicating()
			* @return boolean					@see startReplicating()
			*/
			SmartProto.prototype.replicateFrom=function(source){
				return startReplicating(source,this);
			}
			
			/*
			* Call on source object to stop sending changes to another (target) object
			* @param <SmartProto> target 		@see alreadyReplicating()
			* @return boolean					@see startReplicating()
			*/
			SmartProto.prototype.stopReplicatingTo=function(target){
				return stopReplicating(this,target);
			}

			/*
			* Call on target object that is receiving changes from another (source) object to stop these updates
			* @param <SmartProto> target 		@see alreadyReplicating()
			* @return boolean					@see startReplicating()
			*/
			SmartProto.prototype.stopReplicatingFrom=function(source){
				return stopReplicating(source,this);
			}







































		/*
		* Set public enumerable getters/setters 
		*
		* @param string|number key
		*
		* @access private
		* @call(this)
		*/
		function setPublicAccessors(key){
		
			//Make we don't already have one for this key
			if(Object.getOwnPropertyDescriptor(this,key))
				return;

			Object.defineProperty(this,key,{enumerable:true,configurable:true
				,get:()=>this.get(key)
				,set:(val)=>this.set(key,val)
			});

		}

		/*
		* Remove ALL public enumerable getters. 
		*
		* @access private
		* @call(this)
		*/
		function removePublicAccessors(){
			this._log.traceFunc();
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

















































		/***************************** SmartObject *************************************************************************/

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

			SmartObject.getRelevantOptions=function(options){
				return Object.assign(
					SmartProto.getRelevantOptions(options)
					,bu.subObj(options,Object.keys(SmartObject.defaultOptions),'hasOwnProperty')
				)
			}


			Object.defineProperty(SmartObject.prototype,'length',{get:function(){return Object.keys(this._private.data).length;}})


			SmartObject.prototype.keys=function(){
				return Object.keys(this._private.data);
			}


			


			/*
			* @param string|number|array 	key 	If an array, a nested value is set
			* @param mixed  				value 	
			* @opt object 					event 	Object to emit. The following props will be overwritten: evt, key, value, old
			*
			* @emit new, change, delete (via this.delete if value==null), event
			*
			* @throw TypeError
			* @return mixed 	The previously set value (which could be the same as the new value if nothing changed)
			*/
			SmartObject.prototype.set=function(key,value,event){
				//Undefined is the same as deleting. This is used eg. by assign(). There is a risk that it's passed in by mistake, but
				//so what, the same goes for any objects...
				if(value==undefined) 
					return this.delete(key,event); //returns old value or undefined (not null)

				//Parse the key
				key=arguments[0]=prepareKey.call(this,key);

				//First check if this method should be executed on a nested smarty, in which case do so and return the value right away 
				//(events will bubble from that child...)
				var nestedSmarty=this.getDeepestSmarty(key,CLEAN_KEY_TOKEN); 
				if(nestedSmarty && nestedSmarty!=this)
					return nestedSmarty.set(key,value,event); //$key has been altered

				//SANITY CHECK
				if(Array.isArray(key) && key.length==1)
					this._log.error("BUGBUG: single item key array:",key);

				//Common preparation for setting, which will also call prepareEvent
				event=commonPrepareSet.call(this,key,value,event,CLEAN_KEY_TOKEN); 
		
				if(event.evt=='none')
					return event.old; //return .old instead of .value since they won't be the same if they're objects


				//Do the actual setting 
				commonCommitSet.call(this,event,(event.local||event).key); 
				 //DevNote: arg #2 is only needed because of arrays, ie. here we just pass it for consistency
				

				//Return the old value. 
				return event.old;
				// DevNote: even if event is passed on to new children the .old value should remain unchanged
			}



























			//End of SmartObject




























		/******************************* SmartArray ***********************************************************************************/


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
							case 2:
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
				moveEvent:true    	//if false move() will use delete() and set(), else a custom 'move' event will be emitted
				,smartReplace:true  //if true replace() will try to figure out changes to minimize # of events, else all will 
							    	//just be deleted/set
			}

			SmartArray.getRelevantOptions=function(options){
				return Object.assign(
					SmartProto.getRelevantOptions(options)
					,bu.subObj(options,Object.keys(SmartArray.defaultOptions),'hasOwnProperty')
				)
			}


			Object.defineProperty(SmartArray.prototype, 'length', {get: function(){return this._private.data.length;}});


		
			//Extend a few methods using appropriate get()
			(['join','reduce','reduceRight']).forEach(m=>{
				SmartArray.prototype[m]=function(){
					var arr=this.get();
					return arr.apply(arr,arguments)
				}	
			});


			//FUTURE DEV: SUUUPER weird. If you move .keys() def above the array of defs ^ you get an error....

			SmartArray.prototype.keys=function(){
				return Object.keys(this._private.data).map(Number);
			}


			/*
			* Add or change an item to/on this array.
			*
			* @param number  		i
			* @param mixed  		value 	Any primitive, object or array. 
			* @opt object|boolean 	x		If boolean, true=>splice $value at $key, false=>replace. Or object to be emitted. 
			*	  							 The following props will be overwritten: evt, key, value, old, add
			*
			*
			* @throw TypeError
			* @throw Error 			If @i is negative or too large so the array would become non-sequential
			*
			* @return mixed|undefined 	 The previously set value (which may be the same as the current value), 
			*								undefined if nothing was previously set.
			*/
			SmartArray.prototype.set=function(key,value,event){
				//undefined values are same as deleting, but without risk of range error
				if(value===undefined){
					try{
						return this.delete(key,event,arguments[3]); 
					}catch(err){
						return undefined; //nothing was previously set
					}
				}
				
				//Parse the key
				key=arguments[0]=prepareKey.call(this,key);

				//First check if this method should be executed on a nested smarty, in which case do so and return the value right away 
				//(events will bubble from that child...)
				var nestedSmarty=this.getDeepestSmarty(key,CLEAN_KEY_TOKEN); 
				if(nestedSmarty && nestedSmarty!=this)
					return nestedSmarty.set(key,value,event); //$key has been altered 


				//Support single truthy boolean passed to mean 'insert'...
				if(event===true||event=='insert'){
					event={evt:'new'};
				}

				//Common preparation for setting
				event=commonPrepareSet.call(this,key,value,event,CLEAN_KEY_TOKEN); //event.add!=undefined implies that key has to be numerical

				if(event.evt=='none')
					return event.old; //return .old instead of .value since they won't be the same if they're objects

				//If the local event is new...
				if((event.local||event).evt=='new'){		
					//Make sure the index is in range
					var length=this.length, localKey=(event.local||event).key;
					if(localKey>length){
						this._log.throwCode('RangeError',"SmartArray must remain sequential, cannot set index "+localKey
							+" when length is "+length);
					}else if(localKey<0){
						this._log.throwCode('RangeError',"Cannot set negative index "+localKey);
					}
				}


				//Do the actual setting and emitting. Arg #2 is used to create a new public accessor: anytime the array
				//gets longer we just add one to the end, even if that's not the one being created now. The length we got
				//before splicing ^^ reflects the new last index after splicing/setting...
				commonCommitSet.call(this,event,length); 
					
							
				//Return the old value. 
				return event.old;
				// DevNote: if _intercept.commit prevented setting, then new and old value will be same

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

				var types=bu.checkTypes([['number','array'],['number','string']],[from,to])
				//First we need the deepest smarty since emitting has to happen from him (even if he's a SmartObject)
				var smarty=this.getDeepestSmarty(from); //$from will have been altered
				if(smarty!=this){
					this._log.debug("Will be manipulating nested smarty @"+from._nestedKeys);
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
						to=from+Math.round(bu.stringToNumber(to)); //throws
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
					commonEmitChanges.call(smarty,event);
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
			* @throw TypeError
			* @return primitive|array 	@see @return of this.set()
			*/
			SmartArray.prototype.splice=function(index,deleteCount,...values){
				if(arguments.length==2 || typeof deleteCount!='number'){
					values.unshift(deleteCount);
					deleteCount=0;
					this._log.warn("DEPRECATED: arg#2 to .splice() should be the deleteCount (like the native splice method)");
				}
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
			* @return this
			*/
			SmartArray.prototype.concat=function(...arrays){
				var inserted=0;
				for(let arr of arrays){
					if(arr==undefined){
						continue;
					}
					if(Array.isArray(arr)){
						for(let value of arr){
							this.push(value);
							inserted++;
						}
					}else{
						this.push(arr); //single item
						inserted++;
					}
				}

				if(inserted){
					this._log.trace(`Pushed ${inserted} items to array`);
				}else{
					this._log.note('No items added to array');
				}	
						
				return this;
			}
	





			/*
			* Replace current array with new one. Attempt to determine the actual changes, so events are only 
			* emitted for these changes
			*
			* @param array  arr
			* @opt number   depth     NOTE: passing this will cause the non-smart version to be used
			*
			* @emit set,delete
			*
			* @throw TypeError
			* @return array|undefined 	Undefined if nothing changed (ie. it already contained the same data), else a copy of the 
			*							private data before deleting it all
			*/
			SmartArray.prototype.replace=function(arr){
	
				//If we're replacing with empty data then remove it all!
				arr=checkMultiSet.call(this,arr) //makes data stupid
				if(!arr){
					this._log.trace("Replacing with no data => emptying...");
					return this.empty();
				}else if (arr==SAME_VALUE_TOKEN){
					this._log.debug("All values were the same as before, ie. no change.");
					return undefined;
				}

				var old=this.get(); //value to get returned
				
				main:{
					if(this._private.options.smartReplace){
						if(arguments.length>1){
							this._log.trace("Cannot use smart-replace because additional args are passed:",Array.from(arguments).slice(1));
						}else{
							try{
								_smartReplace.call(this,arr);
								break main;
							}catch(err){
								this._log.warn(`Smart-replace failed. Trying regular approach...`,err);
							}
						}

					}

					//If we're running we either failed smart replacing or we were never aiming for it... anyway we do 
					//it the standard way now...
					SmartProto.prototype.replace.apply(this,arguments);
				}

				return old;
			}

			/*
			* This function should only be called from SmartArray.prototype.replace()
			*
			* @throw 		If anything goes wrong and we should attempt regular replace
			* @return void
			*/
			function _smartReplace(arr){
				//Any issues that happen in here will essentially mess up the order of things so we'll want to stop
				//doing stuff right away and let an error bubble us back to .replace...
				
				//Then try to check if only the first/last item has been changed
				if(Math.abs(this.length-arr.length)==1){
					var min=Math.min(this.length,arr.length);
					var action=arr.length>min?'add':'delete';

					if(bu.sameValue(this.get(0),arr[0])){ //the first items are the same
						if(bu.sameValue(this.slice(0,min),arr.slice(0,min))){ //the first x items are the same
							//An item on the end has been added/removed, check which and replicate
							if(action=='add')
								this.push(arr.pop());
							else
								this.pop();
							return;
						}
					}else if(bu.sameValue(this.last(),arr[arr.length-1])){ //the last items are the same
							// console.warn('old end',this.slice(-1*min))
							// console.warn('new end',arr.slice(-1*min))
						if(bu.sameValue(this.slice(-1*min),arr.slice(-1*min))){ //the last x items are the same
							// console.warn("REMOVING THE FIRST ITEM");
							//An item at the begining has been added/removed, check which and replicate
							if(action=='add')
								this.unshift(arr.shift());
							else
								this.shift();
							return;
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
						}else if(bu.sameValue(curr,arr[a])){
							c++;
							a++;
						}else{
							if(bu.sameValue(curr,arr[a+1])){
								if(bu.sameValue(this.get(c+1),arr[a])){
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

				//After all the changes ^^, make sure we have the correct data, else go drastic and delete everything and re-add
				var res=this.get();
				if(!bu.sameValue(res,arr))
					this._log.makeError("Failed to replace data.",{before:old,goal:arr,after:res}).throw();
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
			* @param mixed  value
			* @param bool   first 	Default false. If true the value is added to beginning of array
			*
			* @throw TypeError
			* @return bool 			True if changes were made, else false
			*/
			SmartArray.prototype.add=function(value,first=false){
				if(value===undefined){//prevent deleting first item
					this._log.warn(`Value was null. If you mean to delete ${first?'first':'last'} item of array, if so use splice explicitly`)
					return false;
				}
				var event={evt:'new'}
				this.set( (first?0:this.length) ,value,event);
				return (event.evt=='none' ? false : true) //NOTE: this does not take into account intercepts at the emit stage

			}


			/*
			* Add single item if it hasn't been added already
			*
			* @param mixed  value
			*
			* @throw TypeError
			* @return bool 			True if changes were made, else false
			*/
			SmartArray.prototype.addUnique=function(value){
				if(this.includes(value))
					return false
				else
					return this.add(value);
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
					return this.delete(this.length-1); 
				else
					return undefined;
			}


			SmartArray.prototype.last=function(){
				return this.get(this.length-1);
			}





			/*
			* @see .findAll() but ignore the old indexes
			*
			* @return array
			*/
			SmartArray.prototype.filter=function(){
				return Object.values(this.findAll.apply(this,arguments))
			}



			/*
			* Get a sequential subset of values from this array
			*
			* @param number start
			* @opt number end        Defaults to end of data. Negative numbers imply offset from end of data
			*
			* @return array
			*/
			SmartArray.prototype.slice=function(start,end){
				bu.checkTypes(['number',['number','undefined']])

				//End defaults to all remaining data
				end=end||this.length-1;

				//Negative offsets....
				if(end<0)
					end=this.length-1+end;
				if(start<0)
					start=this.length-1+start;

				//If we start after we end... well tough! empty array for u
				if(start>end)
					return [];

				return this.subObj(bu.sequence(start,end));
			}
		

		//End of SmartArray
















		//Return the stuff we're exporting
		return {
			'Object':SmartObject
			,'Array':SmartArray
			,'isSmart':isSmart
			,'create':createSmarty
			,proto:SmartProto.prototype
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

