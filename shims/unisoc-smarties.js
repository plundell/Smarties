/*
* @module smarties-unishoc-shim
* @author plundell
* @license Apache-2.0 
* @description Adds the abbility to replicate Smarties events over unisoc, linking a remote and local copy of the same data
*
* @depends Smarties 	Will set method .autoLinkUniSoc on this object
* @depends BetterUtil
*
* @exports {function} Call this function with an object containing the dependencies. It will append the Smarties prototype and
*                      set a method on the Smarties exported object
*
* @protip: In the browser you can load this file after its dependencies to automatically initialize, like so:
*                <script src="path/to/libbetter.js">
*                <script src="path/to/smarties.js">
*                <script src="path/to/unisoc-smarties.js">
*
*/

(function(){
    
    //Export if possible
    if(typeof module==='object' && module.exports){
        module.exports = SmartiesShim_uniSoc
    }

	//Set on window if it exists and hasn't already been set
    if(typeof window=='object' && window){
    	//If Smarties has already loaded, add the shim now...
    	let desc=Object.getOwnPropertyDescriptor(window,'Smarties');
    	if(desc && !desc.get){
    		SmartiesShim_uniSoc(window)
    	}else{
    	//...else store it so it can be loaded when Smarties loads
    		window.SmartiesShims=window.SmartiesShims||[]
    		window.SmartiesShims.push(SmartiesShim_uniSoc)
    	}
    }


    function SmartiesShim_uniSoc(dep){

    	function missingDependency(which){throw new Error("Missing dependency for smarties.js: "+which);}
		const Smarties = dep.Smarties                   || missingDependency('Smarties');
		
		var bu=dep.BetterUtil||dep.libbetter            || missingDependency('BetterUtil');
		bu=bu.BetterUtil||bu;
		const cX=bu.cX||bu;


		//Add a few default options
		Object.assign(Smarties.proto.constructor.defaultOptions,{

			Tx:undefined 	//boolean - local changes will be sent over uniSoc
			,Rx:undefined   //boolean - changes coming from the other side of a uniSoc will be applied to the local object
		})


		/*
		* From the sending side, prepare props on the payload that will be used locally and remotely
		*
		* @param object payload  	The uniSoc "payload" object . This object will be appeneded.
		*
		* @param object x 				A single object with the following props:
		* 	@opt object payload			WILL BE ALTERED.
		*	@opt string|bool Tx           If truthy changes made here will be transmitted to the remote side.
		*	@opt string|bool Rx 		  If truhty changes made on the remote side will be	replicated here.
		*	@opt object meta 		 	  Passed instead of the actual meta set locally
		* 
		* NOTE: Unless you specify true/false here, the defaults set when this instance was created will be used. If a bool
		*		is given, a random string will be generated 
		*
		* @return void
		*/
		Smarties.proto.prepareLink=function(x){
			cX.checkProps(x,{
				payload:['object']
				,Tx:['boolean','string','undefined']
				,Rx:['boolean','string','undefined']
				,meta:['object','undefined']
			});



			//Do a sanity check on the payload, but not much more. Payload.data should at some point before sending be 
			//set to this.stupify(), but this early in the game it's either not set at all, or set to the request data, 
			//so we simply ignore it in this method.
			if(x.payload.err){
				this._log.throw("The passed in payload has .err set. Please delete that before calling this method.",x.payload);

			}else if(x.payload.smartLink){
				this._log.makeError("Has the payload already been prepared, or was this method called on the receiving side?"
					,x.payload).setCode('EALREADY').exec().throw();
			}

		//2020-05-27: Only .aftertransmit uses this, but there is no reason why it couldn't just use payload.data if we didn'ẗ
		//			  stupify the smarty... so let's try not stupifying it (look for comment from this date)
			//...however a live version is needed to initLink(), so hide it on the payload (hidden props do not
			//get transmitted, but it will allow access when eg using autoLink() )
			// Object.defineProperty(x.payload,'smarty',{value:this,configurable:true});



			//Then we decide on linking. We default to what was set when this smarty was created, but
			//explicit params here take presidence. Also if strings where passed in here, they will be used
			//as the subject, else a random string is generated
			x.payload.smartLink={'meta':x.meta||this._private.options.meta}; //meta can be undefined
			

			var channel=cX.randomString();

			if(typeof x.Tx=='string')
				x.payload.smartLink.Tx=x.Tx;
			else if((x.Tx==undefined ? this._private.options.Tx : x.Tx)){ //.options.Tx can only be a boolean
				x.payload.smartLink.Tx=channel;
			}

			if(typeof x.Rx=='string'){
				x.payload.smartLink.Rx=x.Rx;
			}else if((x.Rx==undefined ? this._private.options.Rx : x.Rx)){ //.options.Rx can only be a boolean
				x.payload.smartLink.Rx=channel;
			}

			//Finally, we're going to set some non-enumerable props that we need here, but that should not be transfered
			  Object.defineProperty(x.payload.smartLink,'linked',{enumerable:false,writable:true,value:false});
			   //^used to determine if link has been init'd

			  Object.defineProperty(x.payload.smartLink,'live',{enumerable:false,value:this});
			   //^used to auto-link


			this._log.makeEntry('debug',"Prepared smart link:",x.payload.smartLink).addFrom().exec();
			return;
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
		Smarties.proto.initLink=function(...args){

			args=parseLinkArgs.call(this,args); //this => for logging purposes
			if(args.payload.smartLink.linked){
				//This should already have been checked, so now we throw...
				this._log.throwCode("EALREADY","Duplicate call. This link has already been established");
			}else{
				args.payload.smartLink.linked=true;
			}

			if(!args.Tx && !args.Rx){
				this._log.warn("Neither Rx or Tx set, not linking!",args.payload.smartLink);
				return;
			}

			//If this is the first time this smarty is linked, setup facilities to stop linking
			if(!this._private.links){
				this._private.links=[]
				this._private.links.killAll=()=>{
					this._log.info("Killing all uniSoc links on this smarty");
					this._private.links.forEach(obj=>obj.kill()); //when the last link is removed this._private.links will also be removed
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
				let link={
					Rx:args.Rx
					,kill:()=>{
						this.removeListener(evt)//stop receiving
						args.unisoc.send({subject:args.Rx,killedRx:true}) //tell the other end we've stopped
						this._private.links.splice(this._private.links.indexOf(link),1);
						if(!this._private.links.length)
							delete this._private.links;
					}
				}
				this._private.links.push(link); 
				what.push('receiving');
			}

			what=what.length==1?what[0]+' only':'both directions!'
			this._log.info(`${args.payload.id}: Linked smarty, ${what}`,cX.subObj(args,['Tx','Rx']));
			this.emit('linked',what.length==1?what[0]:'both');
			return;
		}



		/* 
		* Break-out from initLink(). Allows args to be passed in any order 
		* @param array args
		* @return object 
		* @call(any with this._log)
		*/
		function parseLinkArgs(args,...extra){
			//Decouple and combine...
			args=args.concat(extra);

			//Allow args to be passed in seperately or in a single object, but make sure the return obj we
			//build is not a live link to a passed in object since we'll be changing it vv
			var obj={}
				,knownFlags=['flip','replace']
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
			
			var {Tx,Rx,meta}=obj.payload.smartLink;
			if(!cX.checkTypes([['string','undefined'],['string','undefined']],[Tx,Rx],true))
				this._log.makeError("Tx/Rx should be string/undefined, got:",cX.logVar(Tx),cX.logVar(Rx)).throw('TypeError');
			//initLink() will warn if neither is set
			obj.meta=meta;
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
		Smarties.proto.sendAndLink=function(x){
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
		Smarties.proto.respondAndLink=function(x){
			try{
				var id;
				cX.checkProps(x,{
					unisoc:'object'
					,payload:'object'
					,callback:'function'
				});
				
				let msg='any <uniSoc.Client> and a payload received on it';
				if(!x.unisoc.isUniSoc||!x.payload.id)
					this._log.throwType(msg,x.unisoc,x.payload);

				id=x.payload.id;
				
				if(!x.unisoc.receivedRequests.hasOwnProperty(x.payload.id)){
					this._log.makeError(`Expected ${msg}, but the payload does not exist on uniSoc.receivedRequests.`
						,{received:Object.keys(x.unisoc.receivedRequests),payload:x.payload}).setCode("EINVAL").throw();
				}
				
				x.unisoc.log.makeEntry('info',"Responding with smarty. Linking to follow...").setMark(id).exec();;

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
				return this._log.makeError(err).setMark(id).reject(); //if id was never set, no mark is set...
			}
		}



		/*
		* Receive data from a remote smarty, assign it to this one and link this one with the remote
		*
		* @param object payload 	The received payload which contains the data and options we need
		* @param object unisoc 		The receiving unisoc so we can initLink() on it (ie. receive and transmit changes)
		* @flag 'replace'			Use this.replace() instead of this.assign() when setting the initial received data
		*
		* @return this
		*/
		Smarties.proto.receiveAndLink=function(...args){
			var {unisoc,payload,replace,meta,Tx,Rx}=parseLinkArgs.call(this,args,'flip') //flip=> what they send we receive
			
			if(payload.smartLink.linked){
				this._log.warn("Duplicate call. This link has already been established");
				return this;
			}

			//If we're overwriting the local smarty...
			if(replace){                                                                   //devnote: don't just log payload, it'll change...
				this._log.debug("Linking to a remote smarty, replacing local data/meta with:",{data:payload.data, meta});
								
				//...however the same cannot be said for .meta (which can have .constant or .constantType set)
				if(meta)
					this.changeMeta(meta,'replace');
				else
					this.deleteMeta();

				//...then we replace...
				this.replace(payload.data);

			}else{
				if(!cX.sameValue(this._private.options.meta,meta)){
					let ble=this._log.makeEntry('warn',"Linking to a remote smarty with different meta which may or may not cause problems later...")
					//If we don't have any local meta this is only a problem if we're sending
					if(this._private.options.meta && Rx)
						ble.addHandling("Local meta set, so receiving data may be lost");
						
					if(meta && Tx)
						ble.addHandling("remote meta set, so data we send may be lost");

					if(ble.handling.length)
						ble.addExtra({remote:meta, local:this._private.options.meta}).exec();
				}
				this.assign(payload.data);
			}


			this.initLink(unisoc, payload,'flip'); //flip=> what they send we receive
			  //^logs what is linked
			//NOTE: we won't delete payload.smartLink since someone else may want to listen to the events... and it's an easy way 
			//		for others to check if a smarty was sent

			//In case anyone else is using the payload make sure it holds this live smarty
			payload.data=this;

			return this;
		}






		let linkOptionKeys=['Tx','Rx','meta'];
		let determineDirection=(x)=>{return (x.Tx?(x.Rx?'BOTH directions':'sending only'):x.Rx?'sending only':'')}
		
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
		Smarties.autoLinkUniSoc=function autoLinkUniSoc(x){
			let t=typeof x, errstr=`Expected a <uniSoc> or an object with .unisoc set, got a ${t}.`
			if(!x || typeof x!='object') //regardless we need an object...
				throw new TypeError(errstr)

			//...but that object could be a single unisoc, or a unisoc + options
			var unisoc, autoLinkDefault={};
			if(x.isUniSoc){ //just unisoc
				unisoc=x; 
			}else if(x.unisoc && x.unisoc.isUniSoc){ //unisoc + options
				unisoc=x.unisoc
				Object.assign(autoLinkDefault,cX.subObj(x,linkOptionKeys)); //grab the options from the passed in object
			}else{
				throw new Error(`EINVAL. ${errstr} ${JSON.stringify(x)}`);
			}

			//When receiving responses, before value is returned to original requester...
			unisoc.onresponse=function autoLinkSmarty_receive(payload){
				//NOTE: Unisoc will call this function as itself, so this==unisoc
				try{
					var id=payload.id;
					var log=this.log.mark(id);
					if(payload.smartLink){
						//check that we have not already manually linked it, set by initLink()
						if(payload.smartLink.linked){
							log.debug("Smarty was already linked manually:",payload.data);
						}else{
							try{
								payload.data=Smarties.create(payload.data,{meta:payload.smartLink.meta});
								log.debug("Created smarty from received payload:",payload.data);
							}catch(err){
								this.log.makeError("Failed to create smarty from incoming payload (never mind trying to link it)",err).throw();
							}
							payload.data.initLink(this, payload, 'flip'); //flip=> what they send we receive
							  //^logs what is linked
						}
					}
				}catch(err){
					this.log.makeError(err,payload).setMark(id).exec();
				}
			}

			unisoc.beforetransmit=function autoLinkSmarty_transmit(payload){
				//NOTE: Unisoc will call this function as itself, so this==unisoc
				try{
					//This will fire for all transmits, so first we have to check if it's even a smarty
					if(payload.data && payload.data.isSmart){
						let smarty=payload.data; //it WAS as smarty, so for clarity create a 'smarty' variable
						var log=this.log.mark(payload.id);
						
						//We're auto-linking live smarties, but if someone tries to do it manually the above isSmart() shouldn't
						//be truthy and we shouldn't be here... so just make sure no duplication of efforts have been made...							
						if(payload.smartLink){
							let what=determineDirection(payload.smartLink);
							let logstr=`Smart link already prepared`
							if(what){
								log.debug(`${logstr}, ${what}`);
							}else{
								log.note(`${logstr} and explicitly prevented.`);
							}
						}else{

							//Determine if/what we're going to link and log it
							let linkOptions=cX.subObj(smarty._private.options, linkOptionKeys, 'hasOwnDefinedProperty')
								,opts=Object.assign({},autoLinkDefault,linkOptions,payload.smartLink) //if the last 2 don't exist we just go with defaults
								,which=determineDirection(opts)
							;
							// console.debug('autolink options:',{result:opts,autoLinkDefault,smartyOptions});
							if(!which){
								log.note(`Payload contained a smarty, but it will not be linked.`,payload);
							}else{
								log.debug(`Preparing smart payload for ${which}`);
								opts.payload=payload; //prepareLink needs the entire payload too...
								smarty.prepareLink(opts);
							}
							
							//Finally, regardless of ^, make the smarty stupid since we ARE going to send it.
							payload.data=smarty.stupify();
							log.trace('Stupified smarty in payload. Now ready to transmit.');
						}

						//Finally, to be able to init the link we'll need the live smarty... if we're initing manually that won't 
					}
				}catch(err){
					this.log.error(err,payload);
				}
			}

			unisoc.aftertransmit=function initSmartLink(payload){
				//NOTE: Unisoc will call this function as itself, so this==unisoc

				try{
					if(payload.smartLink){
						if(!payload.smartLink.live || !payload.smartLink.live.isSmart){
							this.log.makeError("Not linking! Something wrong with payload. payload.smartLink.live should be the live smarty...",payload)
								.setCode('BUGBUG').exec();
						}else if(payload.smartLink.linked){
							this.log.trace("Smarty has already been manually linked.",payload);
						}else{
							payload.smartLink.live.initLink(payload,this)
						}
					}
				}catch(err){
					this.log.error(err,payload);
				}
			}
		}
    }




})()