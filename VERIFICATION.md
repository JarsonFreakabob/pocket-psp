# Verification record

Verified on 20 November 2026 using Chrome 157 on Windows x64, in fresh automated browser profiles. Browser graphics tests used Chrome's SwiftShader backend; this is not a test of an ARM64 Chromebook's GPU driver.

- **51 automated tests passed** across storage, player boundaries, event handling, the native adapter, graphics profiles, and controller mappings.
- All application JavaScript passed syntax checks.
- Runtime SHA-256 checks passed. The WebAssembly and data artifacts are unchanged upstream files; the three JavaScript boot hooks reproduce deterministically.
- The actual application launched PPSSPP's public PSPDEV cube test program and displayed its graphics, with audio context running, in both Compatibility and Software modes.
- In each mode, native frames stopped when paused and continued after resuming.
- A real PPSSPP state was saved to IndexedDB, the player was closed and reopened, and the identical state bytes were loaded successfully. Emulation continued after restoration.
- Normal state save/load caused **zero file downloads**.
- A corrupt state was rejected with an error instead of a success message.
- Changing renderers preserved a freshly written binary file in the PSP memory stick and remembered the selected graphics mode.
- An actual WebGL context loss disabled state actions, retained Save & quit, and offered Software recovery. Recovery preserved fresh memory-stick bytes and restarted active emulation.
- Library and player fit a 375-pixel viewport without horizontal overflow.
- Browser isolation, runtime loading and saves were tested at a nested URL path, matching GitHub Pages repository hosting.
- An independent final review found no remaining must-fix adapter or player issues.

Earlier browser storage checks also verified duplicate imports, library edits across reloads, binary memory-stick/state round trips, and backup validation/restore.

The test game is not included in this package. Commercial game compatibility, performance, audible output, physical gamepads, and the Acer N23H7's ARM64 hardware have not been verified. Start with Compatibility at 1× on that device; try Software if rendering is incorrect.

GitHub Pages is published at [jarsonfreakabob.github.io/pocket-psp](https://jarsonfreakabob.github.io/pocket-psp/). The [initial deployment](https://github.com/JarsonFreakabob/pocket-psp/actions/runs/44759988739) passed all 51 tests, syntax checks and native asset verification on GitHub's Linux runner.

The live hosted origin was also tested in a fresh Chrome profile: browser isolation activated, the native runtime rendered the PSP program, pause/resume worked, and the saved state's exact bytes survived exiting and reopening before successful restoration. Invalid state data was rejected, changing the renderer preserved fresh memory-stick bytes, and ordinary save/load caused zero downloads. Local preview saves belong to a different site origin and do not automatically move to the hosted URL.
