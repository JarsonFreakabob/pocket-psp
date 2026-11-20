import test from 'node:test';
import assert from 'node:assert/strict';
import {buildNativeControls} from './controls-native.js';

function mappings(text) {
  const result = new Map();
  let section = '';
  for (const line of text.split(/\r?\n/)) {
    const header = line.match(/^\s*\[([^\]]+)\]/);
    if (header) { section = header[1].trim(); continue; }
    const entry = line.match(/^\s*([^;#=]+?)\s*=\s*(.*)$/);
    if (section === 'ControlMapping' && entry) result.set(entry[1].trim(), entry[2].trim());
  }
  return result;
}

test('first boot supplies all native QWERTY and SDL pad controls alongside Pocket shortcuts', () => {
  const actual = mappings(buildNativeControls());
  // Independently checked against root-hunter/ppsspp-wasm's wasm branch:
  // Core/KeyMapDefaults.cpp, SDL/SDLJoystick.cpp and Common/Input/{KeyCodes,InputState}.h.
  const expected = {
    Up: '1-19,10-19', Down: '1-20,10-20', Left: '1-21,10-21', Right: '1-22,10-22',
    Circle: '1-52,10-190', Cross: '1-54,10-189', Square: '1-29,10-191', Triangle: '1-47,10-188',
    Start: '1-66,10-197', Select: '1-50,10-196', L: '1-45,10-194', R: '1-51,10-195',
    'An.Up': '1-37,10-4003', 'An.Down': '1-39,10-4002',
    'An.Left': '1-38,10-4001', 'An.Right': '1-40,10-4000',
    RapidFire: '1-59', 'Fast-forward': '1-61', SpeedToggle: '1-68', Rewind: '1-67',
    'Analog limiter': '1-60', 'Toggle Debugger': '1-142', 'Pause (no menu)': '1-138',
    'Analog speed': '10-4036', Pause: '1-111,10-109,10-104,10-4034',
    'Save State': '1-132', 'Load State': '1-134', 'Next Slot': '1-133',
  };
  for (const [action, value] of Object.entries(expected)) assert.equal(actual.get(action), value, action);
});

test('repairing a partial control section preserves custom mappings, deliberate unbindings and unrelated sections', () => {
  const input = '; user preferences\r\n[General]\r\nVersion = 2\r\n\r\n[ControlMapping]\r\nCross = 11-190,1-33\r\nL =\r\nCustom future action = 11-777\r\n; retain this comment\r\n\r\n[Other]\r\nUp = untouched\r\n';
  const output = buildNativeControls(input);
  const actual = mappings(output);
  assert.equal(actual.get('Cross'), '11-190,1-33');
  assert.equal(actual.get('L'), '');
  assert.equal(actual.get('Custom future action'), '11-777');
  assert.equal(actual.get('Triangle'), '1-47,10-188');
  assert.ok(output.includes('; user preferences\r\n[General]\r\nVersion = 2'));
  assert.ok(output.includes('; retain this comment'));
  assert.ok(output.includes('[Other]\r\nUp = untouched'));
  assert.equal(output.includes('\n') && /(?<!\r)\n/.test(output), false);
});

test('reserved keyboard shortcuts replace stale keyboard bindings while preserving controller alternatives', () => {
  const input = '[ControlMapping]\nSave State = 1-135,11-190\nLoad State = 1-136:1-59,10-191\nNext Slot =\nPause = 10-104,1-131,11-109\n';
  const actual = mappings(buildNativeControls(input));
  assert.equal(actual.get('Save State'), '1-132,11-190');
  assert.equal(actual.get('Load State'), '1-134,10-191');
  assert.equal(actual.get('Next Slot'), '1-133');
  assert.equal(actual.get('Pause'), '1-111,10-104,11-109');
});

test('adding controls to another existing section is stable across repeated launches', () => {
  const once = buildNativeControls('[General]\nVersion = 2\n');
  assert.equal((once.match(/^\[ControlMapping\]$/gm) || []).length, 1);
  assert.equal(buildNativeControls(once), once);
  assert.equal(buildNativeControls(buildNativeControls()), buildNativeControls());
});
