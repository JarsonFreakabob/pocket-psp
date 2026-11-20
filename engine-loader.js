import {chooseNativeGraphicsProfile, normalizeGraphicsMode} from './graphics.js';
import {buildNativeControls} from './controls-native.js';

export const ENGINE_VERSION = 'PPSSPP 1.20.4-wasm';
export const ENGINE_BUILD = 'ppsspp-sdl-2026-11-19-pocket-1';
export const ENGINE_DATA = new URL('./native/', import.meta.url).href;
export const MEMSTICK_ROOT = '/home/web_user/.config/ppsspp';
const SYSTEM = `${MEMSTICK_ROOT}/PSP/SYSTEM`;
const STATES = `${MEMSTICK_ROOT}/PSP/PPSSPP_STATE`;

export function nativeArguments(mode,gamePath) {
  return [normalizeGraphicsMode(mode)==='software'?'--graphics=software':'--graphics=opengl','--xres','960','--yres','544',gamePath];
}

export function setNativePaused(session,module,paused,runtime=globalThis) {
  if (!session.started || session.paused===paused) return;
  if (paused) {
    const push=module.runtimeKeepalivePush || runtime.runtimeKeepalivePush;
    const pop=module.runtimeKeepalivePop || runtime.runtimeKeepalivePop;
    if (typeof push!=='function' || typeof pop!=='function') throw new Error('The PSP runtime cannot safely pause.');
    // MainLoop.pause drops the scheduler's reference. Keep pthreads alive until
    // resumeMainLoop installs a replacement scheduler and takes its reference.
    push.call(module);
    try {module.pauseMainLoop();} catch(error) {pop.call(module);throw error;}
    session.releasePauseKeepalive=()=>pop.call(module);
    session.paused=true;
    module.SDL2?.audioContext?.suspend().catch(()=>{});
  } else {
    module.resumeMainLoop();
    session.paused=false;
    session.releasePauseKeepalive?.();session.releasePauseKeepalive=null;
    module.SDL2?.audioContext?.resume().catch(()=>{});
  }
}

export function validateNativeState(data) {
  // Serializer.h's SChunkHeader is 48 bytes; revision 5 adds a 128-byte title.
  // Bound decompression before handing imported bytes to the native core.
  if (!(data instanceof Uint8Array) || data.byteLength<48) throw new Error('This slot contains an invalid or incomplete PSP state.');
  const view=new DataView(data.buffer,data.byteOffset,data.byteLength);
  const revision=view.getInt32(0,true),compression=view.getInt32(4,true);
  const expected=view.getUint32(8,true),uncompressed=view.getUint32(12,true);
  const header=revision>=5?176:48;
  if (revision<4 || revision>5 || compression<0 || compression>2 || !expected || !uncompressed || uncompressed>256*1024*1024 || data.byteLength<header || expected!==data.byteLength-header || (compression===0&&expected!==uncompressed)) throw new Error('This slot contains an invalid or incompatible PSP state.');
  return data;
}

export function validSavePath(path) {
  return typeof path === 'string' && path.length > 0 && path.length <= 4096 &&
    !/[\\\x00-\x1f\x7f:]/.test(path) && !path.startsWith('/') &&
    path.split('/').every(part => part && part !== '.' && part !== '..');
}

export function readMemstick(FS) {
  const files = [];
  const walk = (directory, prefix = '') => {
    for (const name of FS.readdir(directory)) {
      if (name === '.' || name === '..') continue;
      const absolute = `${directory}/${name}`, relative = `${prefix}${name}`;
      const stat = FS.stat(absolute);
      if (FS.isDir(stat.mode)) walk(absolute, `${relative}/`);
      else if (FS.isFile(stat.mode)) files.push({path:relative,data:FS.readFile(absolute).slice()});
    }
  };
  walk(MEMSTICK_ROOT);
  return files;
}

export function restoreMemstick(FS, files) {
  if (!Array.isArray(files) || files.some(file => !validSavePath(file.path) || !(file.data instanceof Uint8Array))) throw new Error('The memory stick contains an invalid file.');
  FS.mkdirTree(MEMSTICK_ROOT);
  const clear = directory => {
    for (const name of FS.readdir(directory)) {
      if (name === '.' || name === '..') continue;
      const path = `${directory}/${name}`;
      if (FS.isDir(FS.stat(path).mode)) {clear(path);FS.rmdir(path);} else FS.unlink(path);
    }
  };
  clear(MEMSTICK_ROOT);
  for (const file of files) {
    const path = `${MEMSTICK_ROOT}/${file.path}`;
    FS.mkdirTree(path.slice(0,path.lastIndexOf('/')));
    FS.writeFile(path,file.data);
  }
}

export function syncFilesystem(FS) {
  return new Promise((resolve,reject) => FS.syncfs(false,error => error ? reject(error) : resolve()));
}

export function mergeNativeIni(text, updates) {
  const remaining = new Map(Object.entries(updates).map(([section,values]) => [section,new Map(Object.entries(values))]));
  const output = [];
  let section = '';
  const appendMissing = () => {
    for (const [key,value] of remaining.get(section) || []) output.push(`${key} = ${value}`);
    remaining.delete(section);
  };
  for (const line of text.split(/\r?\n/)) {
    const heading = line.match(/^\s*\[([^\]]+)\]/);
    if (heading) {appendMissing();section=heading[1].trim();output.push(line);continue;}
    const key = line.match(/^\s*([^;#=]+?)\s*=/)?.[1];
    const changed = key && updates[section] && Object.hasOwn(updates[section],key);
    if (changed) {
      if (remaining.get(section)?.has(key)) output.push(`${key} = ${remaining.get(section).get(key)}`);
      remaining.get(section)?.delete(key);
    } else output.push(line);
  }
  appendMissing();
  for (const [heading,values] of remaining) {
    output.push('',`[${heading}]`);
    for (const [key,value] of values) output.push(`${key} = ${value}`);
  }
  return output.join('\n')+'\n';
}

function readText(FS,path) {try {return FS.readFile(path,{encoding:'utf8'});} catch {return '';}}

function sendKey(manager,key,keyCode) {
  const canvas = manager.canvas;
  canvas.focus({preventScroll:true});
  for (const type of ['keydown','keyup']) canvas.dispatchEvent(new KeyboardEvent(type,{key,code:key,keyCode,which:keyCode,bubbles:true,cancelable:true}));
}

export function waitForNativeState(manager, operation, command, expectedPath) {
  const FS = manager.FS, session = manager.session;
  return new Promise((resolve,reject) => {
    const close = FS.close, rename = FS.rename;
    let done = false, timer, frameListener;
    const finish = (error,path) => {
      if (done) return; done=true; clearTimeout(timer);
      if (FS.close === observeClose) FS.close=close;
      if (FS.rename === observeRename) FS.rename=rename;
      session.logListeners.delete(onLog);
      if (frameListener) session.frameListeners.delete(frameListener);
      if (error) reject(error); else resolve(path);
    };
    const onLog = message => {
      if (/save state failure|load state failure|failed to (?:load|save) state|savestate failure|ChunkReader:.*(?:can't|doesn't|too small|bad |wrong |unable|error|unexpected|failed)|error found during load|size mismatch: file|aborting savestate load|E\[SAVESTATE\]/i.test(message)) finish(new Error('PPSSPP could not complete this state operation.'));
    };
    const completeAfterFrame = path => {
      if (frameListener) return;
      frameListener=()=>finish(null,path);
      session.frameListeners.add(frameListener);
    };
    function observeClose(stream,...args) {
      const path=stream.path, flags=stream.flags;
      const result=close.call(FS,stream,...args);
      if (operation==='load' && path===expectedPath && (flags&3)===0) completeAfterFrame(path);
      return result;
    }
    function observeRename(from,to,...args) {
      const result=rename.call(FS,from,to,...args);
      if (operation==='save' && from===`${to}.tmp` && to.startsWith(STATES+'/') && to.endsWith('.ppst') && !/(?:\.undo|load_undo)\.ppst$/i.test(to)) completeAfterFrame(to);
      return result;
    }
    FS.close=observeClose;FS.rename=observeRename;
    session.logListeners.add(onLog);
    timer=setTimeout(()=>finish(new Error('PPSSPP did not finish this state operation. Keep the game running and retry.')),30000);
    try {command();} catch(error) {finish(error);}
  });
}

export async function captureEngineState(manager) {
  const path=await waitForNativeState(manager,'save',()=>sendKey(manager,'F2',113));
  manager.nativeStatePath=path;
  const data=manager.FS.readFile(path).slice();
  return validateNativeState(data);
}

export async function loadEngineState(manager,data) {
  validateNativeState(data);
  // A fresh native capture discovers the current game's internal ID and native
  // slot path after a reload, without changing the stored Pocket slot.
  await captureEngineState(manager);
  const path=manager.nativeStatePath;
  manager.FS.writeFile(path,data);
  await waitForNativeState(manager,'load',()=>sendKey(manager,'F4',115),path);
}

export async function startEngine({game,files,onReady,onStart,onError,graphicsMode='compatibility'}) {
  if (!window.crossOriginIsolated || typeof SharedArrayBuffer!=='function') throw new Error('PSP needs an isolated browser tab. Use HTTPS or localhost, allow service workers, and reload.');
  const probe=document.createElement('canvas'), gl=probe.getContext('webgl2');
  if (!gl) throw new Error('This browser does not expose WebGL 2. Enable hardware acceleration and reopen Pocket.');
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  const host=document.getElementById('emulator');host.replaceChildren();
  const canvas=document.createElement('canvas');canvas.id='canvas';canvas.tabIndex=0;canvas.width=960;canvas.height=544;
  canvas.style.cssText='display:block;width:100%;height:100%;object-fit:contain;background:#050705;';
  canvas.setAttribute('aria-label','PSP game display');
  const cover=document.createElement('div');cover.style.cssText='position:absolute;inset:0;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:18px;background:radial-gradient(ellipse,#24311e,#101610 70%);padding:24px;';
  const button=document.createElement('button');button.type='button';button.disabled=true;button.textContent='Preparing PSP…';button.style.cssText='background:#f05b35;color:white;font:600 16px system-ui;border:0;border-radius:9px;padding:15px 28px;cursor:pointer;';
  const status=document.createElement('p');status.textContent='Loading the PSP player. Your game stays on this device.';status.style.cssText='color:#a9b6a0;font:13px system-ui;text-align:center;margin:0;';
  cover.append(button,status);host.append(canvas,cover);
  const listeners=new Map();
  const session={paused:true,started:false,failed:false,frameCount:0,recentLogs:[],logListeners:new Set(),frameListeners:new Set(),
    on(name,fn){if(!listeners.has(name))listeners.set(name,[]);listeners.get(name).push(fn);},
    pause(){setNativePaused(session,module,true);},
    play(){setNativePaused(session,module,false);},
    elements:{parent:canvas},gameManager:{FS:null,canvas,session:null,saveSaveFiles(){},clearEJSResetTimer(){}},
  };
  session.gameManager.session=session;
  const fail=error=>{session.failed=true;button.disabled=true;status.textContent=error.message;onError(error);};
  const log=message=>{
    const clean=String(message).replace(/\x1b\[[0-9;]*m/g,'');
    session.recentLogs.push(clean);if(session.recentLogs.length>200)session.recentLogs.shift();
    for(const listener of [...session.logListeners])listener(clean);
    if (/Booted \/games\//.test(clean)) session.gameBooted=true;
    if (/error booting|failed to boot|could not load game/i.test(clean)) fail(new Error('PPSSPP could not boot this game. Check the game file and graphics profile.'));
    if (new URLSearchParams(location.search).has('debug') || /failure|aborted|error/i.test(clean)) console.debug(clean);
  };
  let gameBytes=new Uint8Array(await game.blob.arrayBuffer());
  const extension=game.filename.split('.').pop().toLowerCase();
  const gamePath=`/games/${game.id}.${extension}`;
  const mode=normalizeGraphicsMode(graphicsMode);
  const module={canvas,noInitialRun:true,arguments:nativeArguments(mode,gamePath),
    locateFile:path=>new URL(path,ENGINE_DATA).href,print:log,printErr:log,
    setStatus:message=>{if(!session.started&&message)status.textContent=message;},
    preRun:[()=>{
      const FS=module.FS || window.FS;
      window.ENV.SDL_EMSCRIPTEN_KEYBOARD_ELEMENT='#canvas';
      restoreMemstick(FS,files);FS.mkdirTree(SYSTEM);FS.mkdirTree(STATES);FS.mkdirTree('/games');
      FS.writeFile(gamePath,gameBytes,{canOwn:true});gameBytes=null;
      const configPath=`${SYSTEM}/ppsspp.ini`;
      FS.writeFile(configPath,mergeNativeIni(readText(FS,configPath),{Graphics:chooseNativeGraphicsProfile(mode),General:{StateSlot:'0',EnableStateUndo:'False',ForceLagSync2:'True'}}));
      FS.writeFile(`${SYSTEM}/controls.ini`,buildNativeControls(readText(FS,`${SYSTEM}/controls.ini`)));
      for(const name of FS.readdir(SYSTEM)) if(/_ppsspp\.ini$/i.test(name)) {
        const path=`${SYSTEM}/${name}`;FS.writeFile(path,mergeNativeIni(readText(FS,path),{Graphics:chooseNativeGraphicsProfile(mode),General:{StateSlot:'0',EnableStateUndo:'False',ForceLagSync2:'True'}}));
      }
      session.gameManager.FS=FS;
    }],
    onRuntimeInitialized(){button.disabled=false;button.textContent='Start PSP';status.textContent='Ready. Keyboard, touch, and controllers are supported.';},
    postMainLoop(){
      session.frameCount++;
      if(session.gameBooted&&!session.started){session.started=true;session.paused=false;clearTimeout(session.bootTimer);onStart(session);}
      for(const listener of [...session.frameListeners])listener();
    },
    onAbort:reason=>fail(new Error(`The PSP player stopped: ${reason || 'runtime error'}. Reopen this game.`)),
  };
  session.gameManager.Module=module;
  button.addEventListener('click',()=>{
    button.disabled=true;
    try {
      const AudioContext=window.AudioContext||window.webkitAudioContext;
      if(AudioContext){module.SDL2={audioContext:new AudioContext()};module.SDL2.audioContext.resume().catch(()=>{});}
      cover.remove();canvas.focus();session.bootTimer=setTimeout(()=>{if(!session.started)fail(new Error('The game did not finish starting. Try the software graphics profile.'));},45000);
      module.callMain(module.arguments.slice());
    }catch(error){fail(error);}
  });
  window.Module=module;
  window.PocketRuntime=session;
  onReady(session);
  await new Promise((resolve,reject)=>{
    const script=document.createElement('script');script.src=new URL('PPSSPPSDL.js',ENGINE_DATA).href;
    script.onload=resolve;script.onerror=()=>reject(new Error('The PSP runtime could not load. Reload this page.'));
    document.body.appendChild(script);
  });
}
