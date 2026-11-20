/** Local-only game library and portable save backups. No game data leaves this browser. */
const DATABASE_NAME = 'pocket-psp';
const DATABASE_VERSION = 1;
const MAX_BACKUP_BYTES = 256 * 1024 * 1024;
const CHUNK_BYTES = 1024 * 1024;
const encoder = new TextEncoder();
let databasePromise;

function object(value) {
  return value !== null && typeof value === 'object' &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function timestamp(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`Invalid ${label} timestamp.`);
  return value;
}

function gameId(value) {
  if (typeof value !== 'string' || !value || value.length > 256 || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new TypeError('Invalid game ID.');
  }
  return value;
}

function stateSlot(value) {
  if (!Number.isInteger(value) || value < 1 || value > 3) throw new TypeError('Save state slot must be 1, 2, or 3.');
  return value;
}

function relativePath(value) {
  if (typeof value !== 'string' || !value || value.length > 4096 ||
      /[\\:\u0000-\u001f\u007f]/u.test(value) || value.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new TypeError('Invalid save file path: use a relative path without traversal.');
  }
  return value;
}

function bytes(value) {
  if (value instanceof Uint8Array) return value.slice();
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice();
  throw new TypeError('Save data must be binary bytes.');
}

function saveFiles(files) {
  if (!Array.isArray(files)) throw new TypeError('Memory stick files must be an array.');
  const seen = new Set();
  let size = 0;
  const normalized = files.map(file => {
    if (!object(file)) throw new TypeError('Invalid memory stick file.');
    const path = relativePath(file.path);
    if (seen.has(path)) throw new TypeError(`Duplicate save file path: ${path}`);
    seen.add(path);
    const data = bytes(file.data);
    size += data.byteLength;
    if (size > MAX_BACKUP_BYTES) throw new RangeError('Memory stick data exceeds 256 MB.');
    return { path, data };
  });
  for (const { path } of normalized) {
    let separator = path.lastIndexOf('/');
    while (separator !== -1) {
      if (seen.has(path.slice(0, separator))) throw new TypeError('Save file path conflicts with a directory.');
      separator = path.lastIndexOf('/', separator - 1);
    }
  }
  return normalized;
}

function settingKey(key) {
  if (typeof key !== 'string' || !key || key.length > 256 || /[\u0000-\u001f\u007f]/u.test(key)) {
    throw new TypeError('Invalid setting key.');
  }
  return key;
}

function jsonValue(value, depth = 0, seen = new Set()) {
  if (depth > 30) throw new TypeError('Settings are nested too deeply.');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if ((!Array.isArray(value) && !object(value)) || seen.has(value)) throw new TypeError('Settings must contain valid JSON values.');
  seen.add(value);
  for (const child of Object.values(value)) jsonValue(child, depth + 1, seen);
  seen.delete(value);
}

function settingsObject(value) {
  if (!object(value)) throw new TypeError('Backup settings must be an object.');
  for (const [key, entry] of Object.entries(value)) {
    settingKey(key);
    jsonValue(entry);
  }
  // A JSON copy preserves values without retaining mutable references or prototypes.
  return JSON.parse(JSON.stringify(value));
}

function storageFailure(error) {
  const full = error?.name === 'QuotaExceededError';
  const message = full
    ? 'Browser storage is full. Export your saves, free storage, and try again.'
    : `Browser storage could not complete this operation. ${error?.message || 'Storage may be unavailable or blocked.'}`;
  const failure = new Error(message, { cause: error });
  failure.name = full ? 'QuotaExceededError' : 'StorageError';
  return failure;
}

function openDatabase() {
  if (databasePromise) return databasePromise;
  if (!globalThis.indexedDB) return Promise.reject(storageFailure(new Error('IndexedDB is unavailable in this browser.')));
  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    let rejected = false;
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('games')) db.createObjectStore('games', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('memstick')) db.createObjectStore('memstick', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('states')) {
        const states = db.createObjectStore('states', { keyPath: ['gameId', 'slot'] });
        states.createIndex('gameId', 'gameId');
      }
      if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', { keyPath: 'key' });
    };
    request.onerror = () => {
      rejected = true;
      databasePromise = undefined;
      reject(storageFailure(request.error));
    };
    request.onblocked = () => {
      rejected = true;
      databasePromise = undefined;
      reject(storageFailure(new Error('Close other Pocket PSP tabs, then try again.')));
    };
    request.onsuccess = () => {
      const db = request.result;
      if (rejected) { db.close(); return; }
      db.onversionchange = () => { db.close(); databasePromise = undefined; };
      resolve(db);
    };
  });
  return databasePromise;
}

/** Resolve only at transaction completion, never at request success. */
async function transaction(names, mode, operation) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    let tx;
    try { tx = db.transaction(names, mode); }
    catch (error) { reject(storageFailure(error)); return; }
    let result;
    let failure;
    tx.oncomplete = () => resolve(result);
    tx.onerror = event => { failure ||= event.target.error || tx.error; };
    tx.onabort = () => reject(storageFailure(failure || tx.error));
    function guard(fn) {
      try { fn(); }
      catch (error) {
        failure = error;
        try { tx.abort(); } catch { reject(storageFailure(error)); }
      }
    }
    guard(() => operation({
      store: name => tx.objectStore(name),
      result: value => { result = value; },
      read: (request, callback) => {
        request.onsuccess = () => guard(() => callback(request.result));
      },
    }));
  });
}

function metadata(record) {
  if (!record) return null;
  const { blob, ...info } = record;
  return info;
}

export function validateGameFile(file) {
  if (!(file instanceof Blob) || typeof file.name !== 'string' || !file.name) throw new TypeError('Choose a game file to import.');
  const extension = file.name.match(/\.([^.]+)$/u)?.[1]?.toLowerCase();
  if (!['iso', 'cso', 'pbp', 'elf'].includes(extension)) throw new TypeError('Supported game files are ISO, CSO, PBP, and ELF.');
  if (!Number.isSafeInteger(file.size) || file.size <= 0) throw new TypeError('This game file is empty.');
  return { name: file.name.replace(/\.[^.]+$/u, '') || file.name, filename: file.name, size: file.size, extension };
}

async function digest(data) {
  if (!globalThis.crypto?.subtle) throw new Error('Game import requires a secure HTTPS or localhost connection.');
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  return [...hash].map(value => value.toString(16).padStart(2, '0')).join('');
}

/** Complete content identity, stable across renames and import order with bounded memory. */
export async function gameFingerprint(file) {
  validateGameFile(file);
  if (file.size > 2 * CHUNK_BYTES) return `psp-${await fullFingerprint(file)}`;
  return `psp-${await digest(await new Blob([encoder.encode(`${file.size}:`), file]).arrayBuffer())}`;
}

async function equalBlobs(first, second) {
  if (first.size !== second.size) return false;
  for (let offset = 0; offset < first.size; offset += CHUNK_BYTES) {
    const [left, right] = await Promise.all([
      first.slice(offset, offset + CHUNK_BYTES).arrayBuffer(),
      second.slice(offset, offset + CHUNK_BYTES).arrayBuffer(),
    ]);
    const a = new Uint8Array(left);
    const b = new Uint8Array(right);
    if (a.some((value, index) => value !== b[index])) return false;
  }
  return true;
}

// Chained SHA-256 covers every byte without allocating an entire multi-GB image.
async function fullFingerprint(file) {
  let previous = encoder.encode(`${file.size}:`);
  for (let offset = 0; offset < file.size; offset += CHUNK_BYTES) {
    const block = await file.slice(offset, offset + CHUNK_BYTES).arrayBuffer();
    previous = encoder.encode(await digest(await new Blob([previous, block]).arrayBuffer()));
  }
  return new TextDecoder().decode(previous);
}

export function getGames() {
  return transaction(['games'], 'readonly', ({ store, read, result }) => {
    read(store('games').getAll(), rows => result(rows.map(metadata)));
  });
}

export function getGame(id) {
  gameId(id);
  return transaction(['games'], 'readonly', ({ store, read, result }) => {
    read(store('games').get(id), row => result(row || null));
  });
}

export async function importGame(file) {
  const info = validateGameFile(file);
  const id = await gameFingerprint(file);
  const existing = await getGame(id);
  if (existing && await equalBlobs(existing.blob, file)) return metadata(existing);
  if (existing) throw new Error('A game identity conflict was detected. Neither image was changed.');
  const record = {
    id, name: info.name, filename: info.filename, size: info.size,
    addedAt: Date.now(), lastPlayed: null, playTimeMs: 0, favorite: false, blob: file,
  };
  return transaction(['games'], 'readwrite', ({ store, read, result }) => {
    const games = store('games');
    read(games.get(id), duplicate => {
      if (duplicate) { result(metadata(duplicate)); return; }
      games.add(record);
      result(metadata(record));
    });
  });
}

export function updateGame(id, patch) {
  gameId(id);
  if (!object(patch)) throw new TypeError('Game changes must be an object.');
  const allowed = new Set(['name', 'lastPlayed', 'playTimeMs', 'favorite']);
  for (const [key, value] of Object.entries(patch)) {
    if (!allowed.has(key)) throw new TypeError(`Game field cannot be changed: ${key}`);
    if (key === 'name' && (typeof value !== 'string' || !value.trim() || value.length > 1024)) throw new TypeError('Enter a game name.');
    if (key === 'favorite' && typeof value !== 'boolean') throw new TypeError('Favorite must be true or false.');
    if (key === 'lastPlayed' && value !== null) timestamp(value, 'last played');
    if (key === 'playTimeMs' && (!Number.isFinite(value) || value < 0)) throw new TypeError('Play time must be a nonnegative number.');
  }
  return transaction(['games'], 'readwrite', ({ store, read, result }) => {
    const games = store('games');
    read(games.get(id), record => {
      if (!record) throw new Error('This game is no longer in your library.');
      Object.assign(record, patch);
      games.put(record);
      result(metadata(record));
    });
  });
}

export function deleteGame(id) {
  gameId(id);
  return transaction(['games', 'states'], 'readwrite', ({ store, read }) => {
    store('games').delete(id);
    read(store('states').index('gameId').openCursor(IDBKeyRange.only(id)), function remove(cursor) {
      if (cursor) { cursor.delete(); cursor.continue(); }
    });
  });
}

export function getMemstick() {
  return transaction(['memstick'], 'readonly', ({ store, read, result }) => {
    read(store('memstick').get('main'), row => result(row ? { files: row.files, updatedAt: row.updatedAt } : { files: [], updatedAt: 0 }));
  });
}

export function putMemstick(files) {
  const record = { files: saveFiles(files), updatedAt: Date.now() };
  return transaction(['memstick'], 'readwrite', ({ store, result }) => {
    store('memstick').put({ id: 'main', ...record });
    result(record);
  });
}

export function getState(id, slot) {
  gameId(id); stateSlot(slot);
  return transaction(['states'], 'readonly', ({ store, read, result }) => {
    read(store('states').get([id, slot]), row => result(row || null));
  });
}

export function putState(id, slot, data) {
  gameId(id); stateSlot(slot);
  const record = { gameId: id, slot, data: bytes(data), updatedAt: Date.now() };
  if (!record.data.byteLength || record.data.byteLength > MAX_BACKUP_BYTES) throw new RangeError('Save state must contain 1 byte to 256 MB of data.');
  return transaction(['states'], 'readwrite', ({ store, result }) => {
    store('states').put(record);
    result(record);
  });
}

export function getStates() {
  return transaction(['states'], 'readonly', ({ store, read, result }) => {
    read(store('states').getAll(), rows => result(rows.map(({ data, ...info }) => ({ ...info, size: data.byteLength }))));
  });
}

export function getSetting(key, fallback = null) {
  settingKey(key);
  return transaction(['settings'], 'readonly', ({ store, read, result }) => {
    read(store('settings').get(key), row => result(row ? row.value : fallback));
  });
}

export function setSetting(key, value) {
  settingKey(key); jsonValue(value);
  const copy = JSON.parse(JSON.stringify(value));
  return transaction(['settings'], 'readwrite', ({ store, result }) => {
    store('settings').put({ key, value: copy });
    result(copy);
  });
}

function toBase64(data) {
  const input = bytes(data);
  const parts = [];
  for (let offset = 0; offset < input.length; offset += 32768) {
    parts.push(String.fromCharCode(...input.subarray(offset, offset + 32768)));
  }
  return btoa(parts.join(''));
}

function fromBase64(value) {
  if (typeof value !== 'string' || value.length > MAX_BACKUP_BYTES ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)) {
    throw new TypeError('Backup contains invalid base64 save data.');
  }
  let binary;
  try { binary = atob(value); } catch { throw new TypeError('Backup contains invalid base64 save data.'); }
  // The decoder may accept nonzero padding bits; portable backups must be canonical.
  if (btoa(binary) !== value) throw new TypeError('Backup contains noncanonical base64 save data.');
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

/** Pure validation: no IndexedDB is opened until every field has passed. */
export function validateBackup(value) {
  if (!object(value) || value.format !== 'pocket-psp-backup' || value.version !== 1) throw new TypeError('This is not a supported Pocket PSP backup (version 1).');
  if (typeof value.createdAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T/u.test(value.createdAt) || !Number.isFinite(Date.parse(value.createdAt))) throw new TypeError('Invalid backup creation timestamp.');
  if (!object(value.memstick) || !Array.isArray(value.memstick.files) || !Array.isArray(value.states)) throw new TypeError('Backup is missing its memory stick or save states.');
  let encodedBytes = 0;
  const decodedFiles = value.memstick.files.map(file => {
    if (!object(file)) throw new TypeError('Invalid memory stick file.');
    relativePath(file.path);
    encodedBytes += typeof file.data === 'string' ? file.data.length : 0;
    if (encodedBytes > MAX_BACKUP_BYTES) throw new RangeError('Backup is too large (maximum 256 MB).');
    return { path: file.path, data: fromBase64(file.data) };
  });
  const memstick = { files: saveFiles(decodedFiles), updatedAt: timestamp(value.memstick.updatedAt, 'memory stick') };
  const seen = new Set();
  const states = value.states.map(state => {
    if (!object(state)) throw new TypeError('Invalid save state.');
    const id = gameId(state.gameId);
    const slot = stateSlot(state.slot);
    const key = JSON.stringify([id, slot]);
    if (seen.has(key)) throw new TypeError('Backup contains a duplicate game save state slot.');
    seen.add(key);
    encodedBytes += typeof state.data === 'string' ? state.data.length : 0;
    if (encodedBytes > MAX_BACKUP_BYTES) throw new RangeError('Backup is too large (maximum 256 MB).');
    const data = fromBase64(state.data);
    if (!data.byteLength) throw new TypeError('Backup contains an empty save state.');
    return { gameId: id, slot, data, updatedAt: timestamp(state.updatedAt, 'save state') };
  });
  return { format: value.format, version: 1, createdAt: value.createdAt, memstick, states, settings: settingsObject(value.settings) };
}

/** Pure codec, also used by the downloadable backup and Node behavioral tests. */
export function encodeBackup(snapshot, createdAt = new Date().toISOString()) {
  const backup = {
    format: 'pocket-psp-backup', version: 1, createdAt,
    memstick: { files: snapshot.memstick.files.map(file => ({ path: file.path, data: toBase64(file.data) })), updatedAt: snapshot.memstick.updatedAt },
    states: snapshot.states.map(state => ({ gameId: state.gameId, slot: state.slot, data: toBase64(state.data), updatedAt: state.updatedAt })),
    settings: settingsObject(snapshot.settings),
  };
  validateBackup(backup);
  return backup;
}

export async function exportBackup() {
  const snapshot = await transaction(['memstick', 'states', 'settings'], 'readonly', ({ store, read, result }) => {
    const value = { memstick: { files: [], updatedAt: 0 }, states: [], settings: {} };
    read(store('memstick').get('main'), row => { if (row) value.memstick = { files: row.files, updatedAt: row.updatedAt }; });
    read(store('states').getAll(), rows => { value.states = rows; });
    read(store('settings').getAll(), rows => { value.settings = Object.fromEntries(rows.map(row => [row.key, row.value])); });
    result(value);
  });
  const blob = new Blob([JSON.stringify(encodeBackup(snapshot))], { type: 'application/json' });
  if (blob.size > MAX_BACKUP_BYTES) throw new RangeError('Backup is too large (maximum 256 MB).');
  return blob;
}

/** Replace saves and settings together. A failed write rolls the complete transaction back. */
export async function importBackup(file) {
  if (!(file instanceof Blob)) throw new TypeError('Choose a JSON backup file.');
  if (!file.size || file.size > MAX_BACKUP_BYTES) throw new RangeError('Backup is empty or too large (maximum 256 MB).');
  let parsed;
  try { parsed = JSON.parse(await file.text()); }
  catch { throw new TypeError('Backup is not valid JSON.'); }
  const backup = validateBackup(parsed);
  const counts = { files: backup.memstick.files.length, states: backup.states.length, settings: Object.keys(backup.settings).length };
  return transaction(['memstick', 'states', 'settings'], 'readwrite', ({ store, result }) => {
    store('memstick').clear();
    store('states').clear();
    store('settings').clear();
    store('memstick').put({ id: 'main', ...backup.memstick });
    for (const state of backup.states) store('states').put(state);
    for (const [key, value] of Object.entries(backup.settings)) store('settings').put({ key, value });
    result(counts);
  });
}

export function clearSavedData() {
  return transaction(['memstick', 'states'], 'readwrite', ({ store }) => {
    store('memstick').clear();
    store('states').clear();
  });
}

export async function requestPersistence() {
  if (!globalThis.navigator?.storage?.persist) return false;
  try { return Boolean(await navigator.storage.persist()); }
  catch { return false; }
}
