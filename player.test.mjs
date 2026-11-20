import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {normalizeGraphicsMode} from './graphics.js';

// Execute the actual player controller with a small browser/storage harness.
// The first database write stays pending while the emulated game writes again.
const source = (await readFile(new URL('./player.js', import.meta.url), 'utf8'))
  .replace(/^import .*;\r?\n/gm, '')
  .replace(/boot\(\)\.catch\(showError\);\s*$/, '');

function fixture({failNewest = false} = {}) {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, {value: '1', textContent: '', disabled: false, hidden: false, classList: {add() {}}, addEventListener() {}});
    return elements.get(id);
  };
  let currentVersion = 1;
  let durableVersion;
  let releaseFirst;
  const firstWrite = new Promise(resolve => {releaseFirst = resolve;});
  const captures = [];
  const navigations = [];
  const loadedVersions = [];
  const windowHandlers = new Map();
  const navigationPrompts = [];
  const stateCapturePaused = [];
  const graphicsSettings = [];
  const destinations = [];
  const unloadAttempt = () => {
    const event = {prevented: false, preventDefault() {this.prevented = true;}};
    windowHandlers.get('beforeunload')?.(event);
    return event;
  };
  const emulator = {
    paused: false,
    pause() {this.paused = true;},
    play() {this.paused = false;},
    gameManager: {FS: {}, saveSaveFiles() {}, getState: () => {stateCapturePaused.push(emulator.paused); return new Uint8Array([7]);}, loadState() {loadedVersions.push(durableVersion);}},
  };
  const context = vm.createContext({
    console, Date, URLSearchParams, Uint8Array, normalizeGraphicsMode,
    setTimeout: () => 1, clearTimeout() {}, clearInterval() {},
    document: {getElementById: element, querySelector: () => element('brand'), addEventListener() {}},
    window: {addEventListener: (name, handler) => {windowHandlers.set(name, handler);}},
    location: {href:'http://localhost/player.html?game=test-game', assign: destination => {destinations.push(destination);navigationPrompts.push(unloadAttempt().prevented); navigations.push(durableVersion);}},
    readMemstick: () => [{path: 'PSP/SAVEDATA/GAME/DATA.BIN', data: new Uint8Array([currentVersion])}],
    async putMemstick(files) {
      const version = files[0].data[0];
      captures.push(version);
      if (captures.length === 1) await firstWrite;
      if (failNewest && version === 2) throw new Error('Disk full');
      durableVersion = version;
    },
    updateGame: async () => ({id: 'test-game', name: 'Test', playTimeMs: 0}),
    syncFilesystem: async () => {},
    captureEngineState: async manager => manager.getState(),
    loadEngineState: async (manager, data) => manager.loadState(data),
    getState: async () => ({data: new Uint8Array([8]), updatedAt: 0}),
    putState: async () => {},
    setSetting: async (key,value) => {graphicsSettings.push({key,value,durableVersion});},
    testEmulator: emulator,
  });
  element('graphics-mode').value='compatibility';
  vm.runInContext(`${source}\ngame={id:'test-game',playTimeMs:0}; emulator=testEmulator; started=true; lastRecordedTime=Date.now(); globalThis.playerTest={persistSession,leave,saveState,loadState,applyGraphics,loseGraphicsContext};`, context);
  return {
    api: context.playerTest, captures, navigations, loadedVersions, elements, navigationPrompts, unloadAttempt, stateCapturePaused, graphicsSettings, destinations, emulator,
    writeNewerSave: () => {currentVersion = 2;},
    releaseFirst,
  };
}

test('Save & quit captures changes made after an already pending autosave', async () => {
  const f = fixture();
  const autosave = f.api.persistSession();
  f.writeNewerSave();
  const leaving = f.api.leave();
  f.releaseFirst();
  await Promise.all([autosave, leaving]);
  assert.deepEqual(f.captures, [1, 2]);
  assert.deepEqual(f.navigations, [2], 'navigation must wait for the newest snapshot');
});

test('Save & quit keeps the page open if the newest snapshot fails', async () => {
  const f = fixture({failNewest: true});
  const autosave = f.api.persistSession();
  f.writeNewerSave();
  const leaving = f.api.leave();
  f.releaseFirst();
  await Promise.all([autosave, leaving]);
  assert.deepEqual(f.navigations, []);
  assert.match(f.elements.get('toast').textContent, /Disk full/);
});

test('loading a state flushes the latest memory stick after pending autosave', async () => {
  const f = fixture();
  const autosave = f.api.persistSession();
  f.writeNewerSave();
  const loading = f.api.loadState();
  f.releaseFirst();
  await Promise.all([autosave, loading]);
  assert.deepEqual(f.captures, [1, 2]);
  assert.deepEqual(f.loadedVersions, [2]);
});

test('saving a state flushes the latest memory stick after pending autosave', async () => {
  const f = fixture();
  const autosave = f.api.persistSession();
  f.writeNewerSave();
  const storing = f.api.saveState();
  f.releaseFirst();
  await Promise.all([autosave, storing]);
  assert.deepEqual(f.captures, [1, 2]);
});

test('closing the tab is guarded while Save & quit is pending, but completed navigation is allowed', async () => {
  const f = fixture();
  const leaving = f.api.leave();
  assert.equal(f.unloadAttempt().prevented, true);
  f.releaseFirst();
  await leaving;
  assert.deepEqual(f.navigationPrompts, [false]);
});

test('quitting disables pause, state selection, state save/load, and emulator interaction', async () => {
  const f = fixture();
  const leaving = f.api.leave();
  for (const id of ['pause-button', 'state-slot', 'save-state', 'load-state']) {
    assert.equal(f.elements.get(id)?.disabled, true, id);
  }
  assert.equal(f.elements.get('emulator')?.inert, true);
  f.releaseFirst();
  await leaving;
});

test('closing the tab is guarded during a save-state write before the stick write begins', async () => {
  const f = fixture();
  const storing = f.api.saveState();
  assert.equal(f.unloadAttempt().prevented, true);
  f.releaseFirst();
  await storing;
});

test('a running game is serialized before pausing, matching the native PSP engine flow', async () => {
  const f = fixture();
  const storing = f.api.saveState();
  f.releaseFirst();
  await storing;
  assert.deepEqual(f.stateCapturePaused, [false]);
});

test('renderer changes save the newest memory stick before persisting the profile and restarting', async()=>{
  const f=fixture();
  const autosave=f.api.persistSession();f.writeNewerSave();
  f.elements.get('graphics-mode').value='software';
  const applying=f.api.applyGraphics();
  assert.deepEqual(f.graphicsSettings,[]);
  f.releaseFirst();await Promise.all([autosave,applying]);
  assert.deepEqual(f.captures,[1,2]);
  assert.deepEqual(f.graphicsSettings,[{key:'graphics:test-game',value:'software',durableVersion:2}]);
  assert.deepEqual(f.destinations,['http://localhost/player.html?game=test-game']);
});

test('a failed final save prevents graphics restart and does not change the stored profile',async()=>{
  const f=fixture({failNewest:true});const autosave=f.api.persistSession();f.writeNewerSave();
  f.elements.get('graphics-mode').value='software';const applying=f.api.applyGraphics();
  f.releaseFirst();await Promise.all([autosave,applying]);
  assert.deepEqual(f.graphicsSettings,[]);assert.deepEqual(f.navigations,[]);
});

test('graphics context loss pauses play and keeps in-game Save & quit available',()=>{
  const f=fixture();let prevented=false;
  f.api.loseGraphicsContext({preventDefault(){prevented=true;}});
  assert.equal(prevented,true);
  assert.equal(f.elements.get('save-state').disabled,true);
  assert.equal(f.elements.get('save-quit').disabled,false);
  assert.equal(f.elements.get('recover-graphics').hidden,false);
});

test('a state save finishing after graphics loss preserves the recovery pause',async()=>{
  const f=fixture();const storing=f.api.saveState();
  await new Promise(resolve=>setImmediate(resolve));
  f.api.loseGraphicsContext({preventDefault(){}});f.releaseFirst();await storing;
  assert.equal(f.emulator.paused,true);
});

test('a state load interrupted by graphics loss does not call the native loader or resume',async()=>{
  const f=fixture();const loading=f.api.loadState();
  await new Promise(resolve=>setImmediate(resolve));
  f.api.loseGraphicsContext({preventDefault(){}});f.releaseFirst();await loading;
  assert.equal(f.emulator.paused,true);assert.deepEqual(f.loadedVersions,[]);
});
