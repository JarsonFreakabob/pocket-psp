export function normalizeGraphicsMode(mode) {
  return mode === 'software' || mode === 'balanced' ? mode : 'compatibility';
}

// Native PPSSPPSDL INI names and values come from Core/Config.cpp in its fork:
// https://github.com/root-hunter/ppsspp-wasm/blob/wasm/Core/Config.cpp
// These are [Graphics] entries. Keep other INI sections and preferences when
// applying them before a full game restart. Conservative defaults follow:
// https://www.ppsspp.org/docs/troubleshooting/graphics-dont-look-right/
const NATIVE_COMPATIBILITY_OPTIONS = Object.freeze({
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
  // Native PPSSPP uses 1 for no texture upscaling; 0 is clamped back to 1.
  TexScalingLevel: '1',
  TexHardwareScaling: 'False',
  TexDeposterize: 'False',
  TextureShader: 'Off',
  TextureFiltering: '1',
  AnisotropyLevel: '0',
  MultiSampleLevel: '0',
  HardwareTessellation: 'False',
});

export function chooseNativeGraphicsProfile(mode = 'compatibility') {
  const options = {...NATIVE_COMPATIBILITY_OPTIONS};
  switch (normalizeGraphicsMode(mode)) {
    case 'software':
      options.SoftwareRenderer = 'True';
      break;
    case 'balanced':
      options.InternalResolution = '2';
      break;
  }
  return options;
}
