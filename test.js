var file='./smarties.js';

//Check for syntax errors (which apparently don't always get reported right with Node 12.14.0, https://github.com/meteor/meteor/issues/11001)
var check = require('/opt/node-v12.11.1-linux-x64/lib/node_modules/syntax-error');
var fs=require('fs');

var src=fs.readFileSync(file);

var err=check(src, file);
if(err){
	console.error('SyntaxError detected in '+file,err);
}else{
	console.log("No syntax errors detected in "+file)
}
