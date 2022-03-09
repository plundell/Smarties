var file='./smarties.js';

function checkSyntax(){
	//Check for syntax errors (which apparently don't always get reported right with Node 12.14.0, https://github.com/meteor/meteor/issues/11001)
	try{
		var check = require('/opt/node-v12.11.1-linux-x64/lib/node_modules/syntax-error');
	}catch(e){
		console.warn("Can't check syntax")
		return false;
	}
	var fs=require('fs');

	var src=fs.readFileSync(file);

	var err=check(src, file);
	if(err){
		console.error('SyntaxError detected in '+file,err);
		return false;
	}else{
		console.log("No syntax errors detected in "+file)
		return true;
	}
}

const libbetter=require('libbetter');
const Smarties=require(file)(libbetter);

let obj=new Smarties.Object();
obj.assign({a:1,b:2});

for(let key of obj.keys()){
	console.log(key, obj[key]);
}

for(let key in obj){
	console.log(key, obj[key]);
}

for(let val of obj){
	console.log(val);
}