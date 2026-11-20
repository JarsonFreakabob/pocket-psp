import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateGameFile, gameFingerprint, validateBackup, encodeBackup, importBackup,
} from './storage.js';

const snapshot = () => ({
  memstick: {
    files: [{ path: 'PSP/SAVEDATA/世界/DATA.BIN', data: new Uint8Array([0, 1, 127, 128, 254, 255]) }],
    updatedAt: 1730000000123,
  },
  states: [{ gameId: 'psp-example', slot: 2, data: new Uint8Array([255, 0, 42]), updatedAt: 1730000000456 }],
  settings: { touchControls: true, volume: 0.5, nested: { values: [null, '日本語', 3] } },
});

const fixture = () => ({
  format: 'pocket-psp-backup', version: 1, createdAt: '2026-11-02T12:00:00.000Z',
  memstick: { files: [{ path: 'PSP/SAVEDATA/DEMO/DATA.BIN', data: 'AAF/gP7/' }], updatedAt: 1730000000123 },
  states: [{ gameId: 'psp-example', slot: 2, data: '/wAq', updatedAt: 1730000000456 }],
  settings: { touchControls: true },
});

test('accepts supported game files and preserves the Unicode display name', () => {
  const result = validateGameFile(new File([new Uint8Array([1, 2])], '星のゲーム.ISO'));
  assert.deepEqual(result, { name: '星のゲーム', filename: '星のゲーム.ISO', size: 2, extension: 'iso' });
  for (const extension of ['cso', 'pbp', 'elf']) {
    assert.equal(validateGameFile(new File(['x'], `Demo.${extension}`)).extension, extension);
  }
});

test('rejects empty, unsupported, and non-file game imports', () => {
  assert.throws(() => validateGameFile(new File([], 'empty.iso')), /empty/i);
  assert.throws(() => validateGameFile(new File(['x'], 'game.zip')), /ISO.*CSO.*PBP.*ELF/i);
  assert.throws(() => validateGameFile({ name: 'fake.iso', size: 2 }), /file/i);
});

test('content identity ignores filename but changes when bytes change', async () => {
  const first = await gameFingerprint(new File([new Uint8Array([0, 1, 2, 255])], 'one.iso'));
  const copied = await gameFingerprint(new File([new Uint8Array([0, 1, 2, 255])], '別名.iso'));
  const changed = await gameFingerprint(new File([new Uint8Array([0, 1, 3, 255])], 'one.iso'));
  assert.equal(first, copied);
  assert.notEqual(first, changed);
  assert.match(first, /^psp-[a-f0-9]{64}$/);
});

test('large game identities cover middle bytes and stay stable across renamed imports', async () => {
  const first = new Uint8Array(3 * 1024 * 1024 + 1);
  first[0] = 91; first[1024 * 1024 + 37] = 5;
  const second = first.slice(); second[1024 * 1024 + 37] = 9;
  const left = await gameFingerprint(new File([first], 'First.iso'));
  const right = await gameFingerprint(new File([second], 'Second.iso'));
  assert.notEqual(left, right, 'different unsampled middle bytes must not share a game identity');
  assert.equal(await gameFingerprint(new File([second], 'Renamed.iso')), right);
});

test('backup codec round trips every binary byte and settings without game blobs', () => {
  const original = snapshot();
  const encoded = encodeBackup(original, '2026-11-02T12:00:00.000Z');
  assert.equal(encoded.memstick.files[0].data, 'AAF/gP7/');
  assert.equal(encoded.states[0].data, '/wAq');
  assert.equal('games' in encoded, false);
  const restored = validateBackup(JSON.parse(JSON.stringify(encoded)));
  assert.deepEqual(restored.memstick, original.memstick);
  assert.deepEqual(restored.states, original.states);
  assert.deepEqual(restored.settings, original.settings);
});

test('decodes independently supplied base64 bytes', () => {
  const restored = validateBackup(fixture());
  assert.deepEqual([...restored.memstick.files[0].data], [0, 1, 127, 128, 254, 255]);
  assert.deepEqual([...restored.states[0].data], [255, 0, 42]);
});

test('round trips a realistic multi-megabyte save without a regular-expression stack overflow', () => {
  const source = snapshot();
  const data = new Uint8Array(2 * 1024 * 1024 + 7);
  for (let index = 0; index < data.length; index++) data[index] = index % 251;
  source.states[0].data = data;
  const restored = validateBackup(encodeBackup(source));
  assert.deepEqual(restored.states[0].data, data);
});

test('rejects unsafe or ambiguous memory stick paths', () => {
  for (const path of ['../secret', 'PSP/../secret', '/absolute', 'C:/drive', 'PSP\\SAVE', 'PSP//SAVE', './save', 'PSP/./SAVE', 'PSP/\u0000SAVE']) {
    const data = fixture();
    data.memstick.files[0].path = path;
    assert.throws(() => validateBackup(data), /path/i, path);
  }
});

test('rejects duplicate paths and state slots instead of silently overwriting', () => {
  const files = fixture();
  files.memstick.files.push({ ...files.memstick.files[0] });
  assert.throws(() => validateBackup(files), /duplicate/i);
  const states = fixture();
  states.states.push({ ...states.states[0] });
  assert.throws(() => validateBackup(states), /duplicate/i);
});

test('rejects file paths which would also have to be directories in either order', () => {
  for (const paths of [['PSP', 'PSP/SAVEDATA/DATA.BIN'], ['PSP/SAVEDATA/DATA.BIN', 'PSP']]) {
    const data = fixture();
    data.memstick.files = paths.map(path => ({ path, data: 'AA==' }));
    assert.throws(() => validateBackup(data), /path|directory/i);
  }
});

test('rejects malformed base64 including noncanonical padding bits', () => {
  for (const base64 of ['*bad*', 'AAA', 'AA=A', 'AA==junk', 'AB==', 'AAB=', ' AAE=', 'AAE=\n']) {
    const data = fixture();
    data.memstick.files[0].data = base64;
    assert.throws(() => validateBackup(data), /base64/i, base64);
  }
});

test('accepts empty memory stick files and rejects invalid state slots', () => {
  const data = fixture();
  data.memstick.files[0].data = '';
  assert.equal(validateBackup(data).memstick.files[0].data.byteLength, 0);
  for (const slot of [0, 4, 1.5, '1', null]) {
    const invalid = fixture();
    invalid.states[0].slot = slot;
    assert.throws(() => validateBackup(invalid), /slot/i);
  }
});

test('rejects wrong formats, invalid timestamps, and non-JSON settings', () => {
  for (const mutation of [
    (data) => { data.version = 2; },
    (data) => { data.format = 'other'; },
    (data) => { data.createdAt = 'yesterday'; },
    (data) => { data.memstick.updatedAt = -1; },
    (data) => { data.states[0].gameId = ''; },
    (data) => { data.settings.volume = Infinity; },
    (data) => { data.settings = []; },
  ]) {
    const data = fixture();
    mutation(data);
    assert.throws(() => validateBackup(data));
  }
});

test('validates the entire backup before accessing browser storage', async () => {
  const invalid = fixture();
  invalid.states.push({ gameId: 'other', slot: 3, data: '!!!!', updatedAt: 1730000000456 });
  await assert.rejects(importBackup(new Blob([JSON.stringify(invalid)])), /base64/i);
  await assert.rejects(importBackup(new Blob(['not JSON'])), /JSON/i);
  const traversal = fixture();
  traversal.memstick.files[0].path = '../escape';
  await assert.rejects(importBackup(new Blob([JSON.stringify(traversal)])), /path/i);
});

test('rejects an oversized backup before reading its content', async () => {
  // Blob slices share their bytes, so this exercises the size guard cheaply.
  const chunk = new Blob([new Uint8Array(1024 * 1024)]);
  const oversized = new Blob(Array(257).fill(chunk));
  await assert.rejects(importBackup(oversized), /256.*MB|too large/i);
});
