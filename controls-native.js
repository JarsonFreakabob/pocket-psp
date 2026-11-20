// Native SDL mappings, verified against root-hunter/ppsspp-wasm (wasm branch):
// Core/KeyMapDefaults.cpp, SDL/SDLJoystick.cpp, Common/Input/KeyCodes.h and
// Common/Input/InputState.h. Keyboard device = 1, first SDL pad = 10;
// axis binding = 4000 + axis * 2 + (negative direction ? 1 : 0).
// Pocket uses Enter/V for Start/Select to match its visible keyboard guide.
const defaults = {
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

const shortcuts = new Map([
  ['Save State', '1-132'], ['Load State', '1-134'], ['Next Slot', '1-133'], ['Pause', '1-111'],
]);

function reserveKeyboard(action, value) {
  const controllerBindings = value.split(',').map(binding => binding.trim()).filter(binding =>
    binding && !binding.split(':').some(input => /^1-\d+$/.test(input.trim())));
  return [...new Set([shortcuts.get(action), ...controllerBindings])].join(',');
}

export function buildNativeControls(existingText = '') {
  const newline = existingText.includes('\r\n') ? '\r\n' : '\n';
  const lines = existingText ? existingText.split(/\r?\n/) : [];
  const seen = new Set();
  let start = -1;
  let end = lines.length;

  for (let index = 0; index < lines.length; index++) {
    const section = lines[index].match(/^\s*\[([^\]]+)\]/);
    if (!section) continue;
    if (start >= 0) { end = index; break; }
    if (section[1].trim() === 'ControlMapping') start = index;
  }

  if (start < 0) {
    if (lines.length && lines.at(-1) !== '') lines.push('');
    lines.push('[ControlMapping]');
    start = lines.length - 1;
    end = lines.length;
  }

  for (let index = start + 1; index < end; index++) {
    const entry = lines[index].match(/^(\s*)([^;#=][^=]*?)(\s*=\s*)(.*)$/);
    if (!entry) continue;
    const action = entry[2].trim();
    seen.add(action);
    if (!shortcuts.has(action)) continue;
    const comment = entry[4].match(/\s+[;#].*$/)?.[0] || '';
    const value = entry[4].slice(0, entry[4].length - comment.length).trim();
    lines[index] = `${entry[1]}${entry[2]}${entry[3]}${reserveKeyboard(action, value)}${comment}`;
  }

  const missing = Object.entries(defaults)
    .filter(([action]) => !seen.has(action))
    .map(([action, value]) => `${action} = ${value}`);
  // PPSSPP clears every default once this section exists, so sparse sections
  // must be completed. An explicit empty mapping remains deliberately unbound.
  while (end > start + 1 && lines[end - 1] === '') end--;
  lines.splice(end, 0, ...missing);
  if (lines.at(-1) !== '') lines.push('');
  return lines.join(newline);
}
