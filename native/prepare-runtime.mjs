// Verify the locked native PPSSPP artifacts and reproduce Pocket's JS boot hooks.
// Run from any directory: node native/prepare-runtime.mjs
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const directory=new URL('./',import.meta.url);
const hashes={
  'PPSSPPSDL.upstream.js':'a5fe3c77961d8609c6337e7174dc6bce5fc7809bd023be9e0dc820864fb1d000',
  'PPSSPPSDL.wasm':'88111ce288230617f0f1589bdca16980d4d750af96a2ffff9418ef47db32a157',
  'PPSSPPSDL.data':'87076b1c68519a2bf03e347f8a16222521f06beca9f3fc74d8743f968eb2c5da',
};
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
for(const [name,expected] of Object.entries(hashes)) {
  if(hash(await readFile(new URL(name,directory)))!==expected)throw new Error(`Runtime checksum mismatch: ${name}`);
}
let source=await readFile(new URL('PPSSPPSDL.upstream.js',directory),'utf8');
const replaceOne=(from,to)=>{
  if(source.split(from).length!==2)throw new Error(`Runtime patch anchor changed: ${from}`);
  source=source.replace(from,to);
};
replaceOne('var noInitialRun=false;','var noInitialRun=Module["noInitialRun"]||false;');
replaceOne('Module["onRuntimeInitialized"]?.();var noInitialRun=','Module["callMain"]=callMain;Module["onRuntimeInitialized"]?.();var noInitialRun=');
replaceOne('init(){},runIter(func)','init(){if(Module["postMainLoop"])MainLoop.postMainLoop.push(Module["postMainLoop"]);},runIter(func)');
const patched='7373e8c9a35124e17ff490744636236bd12fe913f4eb81184c89a4139c789c1b';
if(hash(source)!==patched)throw new Error('Patched JavaScript checksum does not match the verified build.');
await writeFile(new URL('PPSSPPSDL.js',directory),source);
console.log('Verified native PPSSPP WASM/data and reproduced the three JavaScript boot hooks.');
