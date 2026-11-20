import test from 'node:test';
import assert from 'node:assert/strict';
import {chooseNativeGraphicsProfile, normalizeGraphicsMode} from './graphics.js';

test('invalid or stale stored profile values fall back to compatibility', () => {
  for (const mode of ['compatibility', 'software', 'balanced']) assert.equal(normalizeGraphicsMode(mode), mode);
  for (const mode of [undefined, null, '', 'vulkan', 'ARM64', 'constructor', '__proto__', {}, ['software'], 1]) {
    assert.equal(normalizeGraphicsMode(mode), 'compatibility');
    assert.deepEqual(chooseNativeGraphicsProfile(mode), chooseNativeGraphicsProfile('compatibility'));
  }
});

test('native PPSSPP starts at 1x with the original filtering and no rendering speed hacks', () => {
  assert.deepEqual(chooseNativeGraphicsProfile(), {
    GraphicsBackend: '0',
    SoftwareRenderer: 'False',
    InternalResolution: '1',
    HardwareTransform: 'True',
    SoftwareSkinning: 'True',
    FrameSkip: '0',
    AutoFrameSkip: 'False',
    SkipBufferEffects: 'False',
    SkipGPUReadbackMode: '0',
    TextureBackoffCache: 'False',
    TexScalingLevel: '1',
    TexHardwareScaling: 'False',
    TexDeposterize: 'False',
    TextureShader: 'Off',
    TextureFiltering: '1',
    AnisotropyLevel: '0',
    MultiSampleLevel: '0',
    HardwareTessellation: 'False',
  });
});

test('native software mode preserves 1x and changes only the rasterizer', () => {
  const expected = chooseNativeGraphicsProfile();
  expected.SoftwareRenderer = 'True';
  assert.deepEqual(chooseNativeGraphicsProfile('software'), expected);
});

test('native balanced mode raises only internal rendering resolution to 2x', () => {
  const expected = chooseNativeGraphicsProfile();
  expected.InternalResolution = '2';
  assert.deepEqual(chooseNativeGraphicsProfile('balanced'), expected);
});

test('native profile mutations stay isolated between sessions', () => {
  const session = chooseNativeGraphicsProfile();
  session.InternalResolution = '10';
  session.SkipBufferEffects = 'True';
  session.unknown = 'True';
  assert.equal(chooseNativeGraphicsProfile().InternalResolution, '1');
  assert.equal(chooseNativeGraphicsProfile('software').SkipBufferEffects, 'False');
  assert.equal(Object.hasOwn(chooseNativeGraphicsProfile(), 'unknown'), false);
});
