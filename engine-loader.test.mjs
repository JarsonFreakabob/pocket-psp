import test from 'node:test';
import assert from 'node:assert/strict';
import {validSavePath, readMemstick, restoreMemstick, mergeNativeIni, waitForNativeState, MEMSTICK_ROOT, nativeArguments, validateNativeState, loadEngineState} from './engine-loader.js';

test('native graphics override only selected keys, preserving controls, audio and unrelated preferences', () => {
  const input='[Graphics]\nInternalResolution = 4\nSoftwareRenderer = True\nCustom = retained\n[Sound]\nGameVolume = 37\n[ControlMapping]\nCross = custom\n';
  const output=mergeNativeIni(input,{Graphics:{InternalResolution:'1',SoftwareRenderer:'False'},General:{StateSlot:'0'}});
  assert.match(output,/InternalResolution = 1/);assert.match(output,/SoftwareRenderer = False/);
  assert.doesNotMatch(output,/InternalResolution = 4/);
  assert.match(output,/GameVolume = 37/);assert.match(output,/Cross = custom/);assert.match(output,/Custom = retained/);
  assert.match(output,/\[General\]\nStateSlot = 0/);
});

function nativeFixture() {
  const session={logListeners:new Set(),frameListeners:new Set()};
  const FS={close(){},rename(){}};
  const originals={close:FS.close,rename:FS.rename};
  return {manager:{FS,session},FS,session,originals,frame(){for(const fn of [...session.frameListeners])fn();}};
}

test('native save waits for atomic ppst rename and a completed emulator frame', async () => {
  const f=nativeFixture();const path=`${MEMSTICK_ROOT}/PSP/PPSSPP_STATE/GAME_0.ppst`;
  let resolved=false;
  const pending=waitForNativeState(f.manager,'save',()=>{}).then(path=>{resolved=true;return path;});
  f.FS.close({path:path+'.tmp',flags:32833});f.frame();await Promise.resolve();assert.equal(resolved,false);
  f.FS.rename(path+'.tmp',path);await Promise.resolve();assert.equal(resolved,false);
  f.frame();assert.equal(await pending,path);
  assert.equal(f.FS.close,f.originals.close);assert.equal(f.FS.rename,f.originals.rename);
  assert.equal(f.session.logListeners.size,0);assert.equal(f.session.frameListeners.size,0);
});

test('load requires an actual read and reports a native failure before claiming success', async () => {
  const f=nativeFixture();const path=`${MEMSTICK_ROOT}/PSP/PPSSPP_STATE/GAME_0.ppst`;
  let resolved=false;
  const pending=waitForNativeState(f.manager,'load',()=>{},path).then(value=>{resolved=true;return value;});
  f.FS.close({path,flags:32833});f.frame();await Promise.resolve();assert.equal(resolved,false);
  f.FS.close({path,flags:32768});
  for(const fn of [...f.session.logListeners])fn('Load state failure: incompatible version');
  f.frame();await assert.rejects(pending,/could not complete/);
  assert.equal(resolved,false);assert.equal(f.FS.close,f.originals.close);
});

test('synchronous native command errors restore filesystem observers', async () => {
  const f=nativeFixture();
  await assert.rejects(waitForNativeState(f.manager,'save',()=>{throw new Error('Stopped');}),/Stopped/);
  assert.equal(f.FS.close,f.originals.close);assert.equal(f.FS.rename,f.originals.rename);
});

test('memory stick snapshots include in-game saves, native states and configuration', () => {
  const files=new Map([
    [`${MEMSTICK_ROOT}/PSP/SAVEDATA/GAME/DATA.BIN`,new Uint8Array([1])],
    [`${MEMSTICK_ROOT}/PSP/PPSSPP_STATE/GAME_0.ppst`,new Uint8Array([2])],
    [`${MEMSTICK_ROOT}/PSP/SYSTEM/controls.ini`,new Uint8Array([3])],
  ]);
  const directories=new Set([MEMSTICK_ROOT,`${MEMSTICK_ROOT}/PSP`,`${MEMSTICK_ROOT}/PSP/SAVEDATA`,`${MEMSTICK_ROOT}/PSP/SAVEDATA/GAME`,`${MEMSTICK_ROOT}/PSP/PPSSPP_STATE`,`${MEMSTICK_ROOT}/PSP/SYSTEM`]);
  const FS={
    readdir(path){return ['.','..',...new Set([...directories,...files.keys()].filter(p=>p.startsWith(path+'/')).map(p=>p.slice(path.length+1).split('/')[0]))];},
    stat:path=>({mode:directories.has(path)?1:2}),isDir:mode=>mode===1,isFile:mode=>mode===2,readFile:path=>files.get(path),
  };
  const snapshot=readMemstick(FS);
  assert.deepEqual(snapshot.map(f=>f.path).sort(),['PSP/PPSSPP_STATE/GAME_0.ppst','PSP/SAVEDATA/GAME/DATA.BIN','PSP/SYSTEM/controls.ini']);
  snapshot[0].data[0]=99;assert.equal(files.get(`${MEMSTICK_ROOT}/${snapshot[0].path}`)[0],1);
});

test('all restore paths are validated before any filesystem mutation', () => {
  let mutations=0;const FS={mkdirTree(){mutations++;}};
  for(const path of ['/absolute','../escape','PSP/../escape','C:/escape','PSP\\bad','PSP//bad']) {
    assert.equal(validSavePath(path),false);
    assert.throws(()=>restoreMemstick(FS,[{path,data:new Uint8Array([1])}]),/invalid/);
  }
  assert.equal(mutations,0);
});

test('native command-line renderer agrees with the selected graphics profile',()=>{
  assert.equal(nativeArguments('software','/games/test.elf')[0],'--graphics=software');
  assert.equal(nativeArguments('compatibility','/games/test.elf')[0],'--graphics=opengl');
  assert.equal(nativeArguments('balanced','/games/test.elf').at(-1),'/games/test.elf');
});

test('invalid native state headers are refused before any native save or load operation',async()=>{
  const valid=new Uint8Array(184), view=new DataView(valid.buffer);
  view.setInt32(0,5,true);view.setInt32(4,0,true);view.setUint32(8,8,true);view.setUint32(12,8,true);
  assert.equal(validateNativeState(valid),valid);
  for(const broken of [new Uint8Array([1,2,3]),valid.subarray(0,180),new Uint8Array(184)]) {
    assert.throws(()=>validateNativeState(broken),/invalid/);
    await assert.rejects(loadEngineState({},broken),/invalid/);
  }
  const bomb=valid.slice();new DataView(bomb.buffer).setUint32(12,0xffffffff,true);
  assert.throws(()=>validateNativeState(bomb),/invalid/);
});

test('ChunkReader errors reject loading even after its initial file read closes',async()=>{
  const f=nativeFixture(),path=`${MEMSTICK_ROOT}/PSP/PPSSPP_STATE/GAME_0.ppst`;
  const pending=waitForNativeState(f.manager,'load',()=>{},path);
  f.FS.close({path,flags:32768});
  for(const listener of [...f.session.logListeners])listener('E[SAVESTATE]: ChunkReader: Bad file size, got 2 expected 400');
  f.frame();await assert.rejects(pending,/could not complete/);
});

test('undo-state renames never complete a new save before its atomic temp-file commit',async()=>{
  const f=nativeFixture(),path=`${MEMSTICK_ROOT}/PSP/PPSSPP_STATE/GAME_0.ppst`;
  let resolved=false;
  const pending=waitForNativeState(f.manager,'save',()=>{}).then(value=>{resolved=true;return value;});
  f.FS.rename(path,path.replace('.ppst','.undo.ppst'));f.frame();await Promise.resolve();assert.equal(resolved,false);
  f.FS.rename(path,`${MEMSTICK_ROOT}/PSP/PPSSPP_STATE/load_undo.ppst`);f.frame();await Promise.resolve();assert.equal(resolved,false);
  f.FS.rename(path+'.tmp',path);f.frame();assert.equal(await pending,path);
});
import * as engine from './engine-loader.js';

test('pausing retains the native runtime until a resumed scheduler owns its keepalive',async()=>{
  let references=1,terminated=false;
  const module={
    pauseMainLoop(){references--;queueMicrotask(()=>{if(references===0)terminated=true;});},
    resumeMainLoop(){if(!terminated)references++;},
  };
  const lifetime={runtimeKeepalivePush(){references++;},runtimeKeepalivePop(){references--;}};
  const session={started:true,paused:false};
  engine.setNativePaused(session,module,true,lifetime);
  engine.setNativePaused(session,module,true,lifetime);
  await Promise.resolve();assert.equal(terminated,false);assert.equal(references,1);assert.equal(session.paused,true);
  engine.setNativePaused(session,module,false,lifetime);
  engine.setNativePaused(session,module,false,lifetime);
  await Promise.resolve();assert.equal(terminated,false);assert.equal(references,1);assert.equal(session.paused,false);
});
