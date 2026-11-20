import {getGame, updateGame, getMemstick, putMemstick, getState, putState, getSetting, setSetting} from './storage.js';
import {startEngine, readMemstick, syncFilesystem, captureEngineState, loadEngineState} from './engine-loader.js';
import {normalizeGraphicsMode} from './graphics.js';

const $ = id => document.getElementById(id);
let game;
let emulator;
let started = false;
let quitting = false;
let saving = null;
let lastRecordedTime = 0;
let timer;
let toastTimer;
let busy = false;
let navigationReady = false;
let hasSavedState = false;
let graphicsMode = 'compatibility';
let contextLost = false;

function toast(message) {
  $('toast').textContent = message;
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {$('toast').hidden = true;}, 4200);
}

function showError(error) {
  console.error(error);
  $('player-message').hidden = false;
  $('player-message').classList.add('error');
  $('message-title').textContent = 'This session needs a hand.';
  $('message-text').textContent = error.message || 'Something went wrong. Reopen the game from your library.';
  $('message-action').hidden = false;
  $('save-status').textContent = 'Game not started';
}

async function refreshSlot() {
  if (!game) return;
  const slot = Number($('state-slot').value);
  const state = await getState(game.id, slot);
  hasSavedState = !!state;
  $('state-status').textContent = state
    ? `Slot ${slot} · Saved ${new Date(state.updatedAt).toLocaleString()}`
    : `Slot ${slot} is empty. Save a state to pick up at this exact moment.`;
  $('load-state').disabled = !state || !started || busy || quitting || contextLost;
}

function enableSessionControls() {
  const blocked = !started || busy || quitting || contextLost;
  $('pause-button').disabled = blocked;
  $('save-state').disabled = blocked;
  $('state-slot').disabled = blocked;
  $('load-state').disabled = blocked || !hasSavedState;
  $('emulator').inert = busy || quitting || contextLost;
  $('save-quit').disabled = !started || busy || quitting;
  $('graphics-apply').disabled = !game || busy || quitting;
}

async function persistSession({fresh = false} = {}) {
  if (!started) return;
  if (busy && !fresh) return;
  if (saving) {
    if (!fresh) return saving;
    // Autosaves can contain an older snapshot while the game keeps running.
    // A state/quit boundary must wait for it, then capture the paused game anew.
    // Retry a failed older write too; the new snapshot may still be saved.
    try { await saving; } catch (_) { /* the boundary below retries current data */ }
    return persistSession({fresh: true});
  }
  saving = (async () => {
    $('save-status').textContent = 'Syncing your memory stick…';
    emulator.gameManager.saveSaveFiles();
    // Capture the directory tree: PSP uses nested files, not a single .srm file.
    const files = readMemstick(emulator.gameManager.FS);
    await putMemstick(files);
    const now = Date.now();
    const elapsed = Math.max(0, now - lastRecordedTime);
    game = await updateGame(game.id, {playTimeMs: (game.playTimeMs || 0) + elapsed, lastPlayed: now});
    lastRecordedTime = now;
    // Pocket's own transaction above is the portable source of truth. Keep the
    // engine's IDBFS copy current as well, without claiming success on a failure.
    await syncFilesystem(emulator.gameManager.FS);
    $('save-status').textContent = `Memory stick synced · ${new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}`;
  })();
  try { await saving; }
  catch (error) { $('save-status').textContent = 'Save failed — keep this tab open'; throw error; }
  finally { saving = null; }
}

async function leave(destination = './', beforeNavigation = async () => {}) {
  if (quitting) return;
  if (busy) { toast('Finishing your save state. Try again in a moment.'); return; }
  quitting = true;
  enableSessionControls();
  $('library-button').disabled = true;
  try {
    if (started) { emulator.pause(); await persistSession({fresh: true}); }
    await beforeNavigation();
    clearInterval(timer);
    navigationReady = true;
    location.assign(destination);
  } catch (error) {
    quitting = false;
    navigationReady = false;
    $('library-button').disabled = false;
    enableSessionControls();
    toast(`Could not finish saving: ${error.message}. Your session is still open.`);
  }
}

async function applyGraphics() {
  if (!game || busy || quitting) return;
  const chosen = normalizeGraphicsMode($('graphics-mode').value);
  await leave(location.href, () => setSetting(`graphics:${game.id}`, chosen));
}

function loseGraphicsContext(event) {
  event.preventDefault();
  contextLost = true;
  if (started) emulator.pause();
  $('graphics-status').textContent = 'The browser lost its graphics context. Switch to Software and restart, or use Save & quit to keep your in-game saves.';
  $('recover-graphics').hidden = false;
  enableSessionControls();
}

async function saveState(existingState) {
  if (!started || busy || quitting || contextLost) return;
  busy = true;
  enableSessionControls();
  const wasPaused = emulator.paused;
  try {
    // PPSSPP needs its emulation thread available during serialization, just
    // as in the engine's native save-state action. Pause only after capture.
    if (wasPaused) emulator.play();
    const data = existingState || await captureEngineState(emulator.gameManager);
    if (!(data instanceof Uint8Array) || !data.byteLength) throw new Error('This game did not return a save state.');
    emulator.pause();
    const slot = Number($('state-slot').value);
    await putState(game.id, slot, data);
    await persistSession({fresh: true});
    await refreshSlot();
    toast(`Saved to slot ${slot}`);
  } catch (error) {
    console.error('Pocket saveState failed', JSON.stringify({message: error?.message, stack: error?.stack, value: String(error)}));
    toast(`State could not be saved: ${error.message || 'The emulator did not return a valid state.'}`);
  }
  finally {
    if (!quitting && !contextLost && !emulator.failed) { if (wasPaused) emulator.pause(); else emulator.play(); }
    busy = false;
    enableSessionControls();
    await refreshSlot();
  }
}

async function loadState() {
  if (!started || busy || quitting || contextLost) return;
  busy = true;
  enableSessionControls();
  const wasPaused = emulator.paused;
  try {
    const slot = Number($('state-slot').value);
    const state = await getState(game.id, slot);
    if (!state) throw new Error('This slot is empty.');
    emulator.pause();
    // Flush the current stick first; loading a quick state must not discard
    // an in-game save that the user has already made.
    await persistSession({fresh: true});
    if (contextLost || emulator.failed) throw new Error('The graphics context was lost. Restart with the recovery controls before loading a state.');
    emulator.play();
    await loadEngineState(emulator.gameManager, state.data);
    toast(`Loaded slot ${slot}`);
  } catch (error) { toast(`State could not be loaded: ${error.message}`); }
  finally {
    if (!contextLost && !emulator.failed) { if (wasPaused) emulator.pause(); else emulator.play(); }
    busy = false;
    enableSessionControls();
    await refreshSlot();
  }
}

$('library-button').addEventListener('click', () => leave());
document.querySelector('.brand').addEventListener('click', event => {event.preventDefault(); leave();});
$('save-quit').addEventListener('click', () => leave());
$('graphics-apply').addEventListener('click', () => applyGraphics().catch(error=>toast(error.message)));
$('recover-graphics').addEventListener('click', () => {
  $('graphics-mode').value = 'software';
  applyGraphics().catch(error=>toast(error.message));
});
$('emulator').addEventListener('webglcontextlost', loseGraphicsContext, true);
$('emulator').addEventListener('webglcontextrestored', () => {
  contextLost = false;
  $('graphics-status').textContent = 'The graphics context is available again. Resume play, or apply Software mode if the picture is still incorrect.';
  $('pause-button').textContent = '▷ Resume';
  enableSessionControls();
}, true);
$('pause-button').addEventListener('click', () => {
  if (!started || busy || quitting || contextLost) return;
  if (emulator.paused) emulator.play(); else emulator.pause();
  $('pause-button').textContent = emulator.paused ? '▷ Resume' : 'Ⅱ Pause';
});
$('save-state').addEventListener('click', () => saveState());
$('load-state').addEventListener('click', loadState);
$('state-slot').addEventListener('change', () => refreshSlot().catch(error => toast(error.message)));
$('fullscreen').addEventListener('click', async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else if ($('play-area').requestFullscreen) await $('play-area').requestFullscreen();
    else toast('Use your browser’s fullscreen control on this device.');
  } catch (error) { toast(`Fullscreen unavailable: ${error.message}`); }
});
$('help-button').addEventListener('click', () => $('help-dialog').showModal());
$('close-help').addEventListener('click', () => $('help-dialog').close());
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && started) persistSession().catch(error => console.error('Pocket save failed', error));
});
window.addEventListener('pagehide', () => { if (started && !quitting) persistSession().catch(console.error); });
window.addEventListener('beforeunload', event => {
  if (started && !navigationReady && (saving || busy || quitting)) { event.preventDefault(); event.returnValue = ''; }
});

async function boot() {
  if (location.protocol === 'file:') throw new Error('Pocket needs a web address. Publish it to GitHub Pages or run the included local server.');
  const id = new URLSearchParams(location.search).get('game');
  if (!id) {
    $('message-title').textContent = 'Your library is waiting.';
    $('message-text').textContent = 'Choose a PSP game from your library, or add an ISO, CSO, PBP, or ELF file to get started.';
    $('message-action').hidden = false;
    $('save-status').textContent = 'No game selected';
    return;
  }
  game = await getGame(id);
  if (!game?.blob) throw new Error('This game is not stored in this browser. Add it again from your library.');
  $('game-title').textContent = game.name;
  document.title = `${game.name} · Pocket`;
  graphicsMode = normalizeGraphicsMode(await getSetting(`graphics:${game.id}`, 'compatibility'));
  $('graphics-mode').value = graphicsMode;
  $('graphics-apply').disabled = false;
  await refreshSlot();
  const memory = await getMemstick();
  await startEngine({
    game, files: memory.files, graphicsMode,
    onReady: instance => {
      emulator = instance;
      $('player-message').hidden = true;
      $('save-status').textContent = 'Ready · Click Start PSP to begin';
      instance.on('saveState', event => saveState(event.state));
      instance.on('loadState', loadState);
      instance.on('exit', () => {
        if (!quitting) showError(new Error('The emulator stopped. Your latest synced saves remain in your library.'));
      });
    },
    onStart: instance => {
      emulator = instance;
      started = true;
      lastRecordedTime = Date.now();
      $('save-status').textContent = 'Memory stick ready · Syncs every 15s';
      enableSessionControls();
      refreshSlot().catch(error => toast(error.message));
      updateGame(game.id, {lastPlayed: lastRecordedTime}).then(updated => {game = updated;}).catch(error => toast(error.message));
      timer = setInterval(() => persistSession().catch(error => toast(`Save failed: ${error.message}`)), 15000);
    },
    onError: showError,
  });
}
boot().catch(showError);
