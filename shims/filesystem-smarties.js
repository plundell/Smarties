(function(){

    //Export if possible
    if(typeof module==='object' && module.exports){
        module.exports = SmartiesShim_Filesystem;
    }else{
        console.error("This shim is not intended for the browser");
    }

    function SmartiesShim_Filesystem(dep){

        function missingDependency(which){throw new Error("Missing dependency for smarties.js: "+which);}
        const libbetter = dep.libbetter      || missingDependency('libbetter');
        const Smarties = dep.Smarties          || missingDependency('Smarties');


        const cX=libbetter.BetterUtil.cX;
        const fsX=libbetter.BetterUtil.fsX;

        /*
    	* Store this smarty on the filesystem. 
    	*
    	* @param string filepath
        * @opt flag 'json'
    	* @opt flag 'noRead' 			If passed, nothing will be read from disk until ._read() is called
        * @opt flag 'noHelpers'
    	*
        * @sets _private.storage   {filepath,log,stat,write(),read(),unlink()}
        *
    	* @return this                  
        */
        Smarties.proto.storeToFilesystem=function(filepath,...flags){
        	cX.checkType('string',filepath);

        	//Smarties can only be stored once...
        	if(this._private.storage)
        		this._log.throw("Smarty already stored @"+this._private.storage.filepath)


        	//Create the storage
            this._private.storage=new fsX.StoredItem(
            	filepath //where to store (and read from unless 'noRead' flag vv )
            	,(Array.isArray(this._private.data) ? 'array':'object') //check type of value before storage
            	,this._log //use our log
            	,...flags //pass along all flags which may contain the format we want to store as
            );

            //Create additional flag that controlls if changes are written to file, which can easily to turned off for a while if needed
            this._private.attached=true;


           	//We need buffering for this... so turn it on if not already...
        	if(!this.hasBufferEvent()){
        		var turnOffBufferingOnUnlink=true; //...only turned on for this => turn off if we unlink
        		this.addBufferEvent(1000);
        	}

            /*
            * Write the current _private.data to disk
            */
            var writeToDisk=()=>{
                if(this._private.storage && this._private.attached){
                    if(!this._private.storage.stat.exists){
                        this._log.note("Creating file for stored smarty NOW @",this._private.storage.filepath);
                        this._private.storage.stat.exists=true;
                    }
                    this._private.storage.write(this.stupify()).catch(this._log.error)
                }
            };

            /*
    		* Unlink the underlying file (and stop storing changes)
    		* @return void
            */
            var unlinkStoredSmarty=()=>{
            	//Remove the listener
            	this.off('buffer',writeToDisk);

            	//If we started buffering just for this, we stop it again 
            	if(turnOffBufferingOnUnlink)
            		this.removeBufferEvent();

            	//Delete the file
             	this._private.storage.unlink();

             	//remove this prop
             	delete this._private.storage;
            };

            /*
            * Read data from storage, filling out what we've stored locally
            */
            var readFromStorage=()=>{
    	        if(this._private.storage.stat.exists){
    		        //Load initial data from storage and set anything not already set
                    var data=this._private.storage.read()
                    if(cX.isEmpty(data))
                        this._log.note(`Found previous data/file @ ${this._private.storage.filepath}, but it was empty. Nothing to set.`);
                    else
    		          this.fillOut(data); //this will log what gets set or if nothing gets set
    	        }else{
    	        	this._log.note("No previous data/file found. It will be created when something is set on this smarty @",this._private.storage.filepath);
    	        }
            }

            //By default we read right away...
            if(!flags.includes('noRead'))
                readFromStorage();
            else
                this._log.debug("Got flag 'noRead', not reading anything from filesystem yet...");

            //Then start listening to the snapshot and write the whole thing to HDD, as long as we're still attached (see ^^)
    		this.on('buffer',writeToDisk);

            //Finally, and this is not required, set some helper functions
            if(!flags.includes('noHelpers')){
                var helpers={'_write':writeToDisk,'_read':readFromStorage,'_unlink':unlinkStoredSmarty};
                for(let prop in helpers){
                    if(this.has(prop)){
                        this._log.warn(`Not setting helper func '${prop}' on this stored smarty since that key is already in use:`,this.get(prop));
                    }else{
                        this._private.reservedKeys[prop]=true;
                        Object.defineProperty(this,prop,{value:helpers[prop]})
                    }
                }
            }
            
            return this;
        }

        
    }

})()
