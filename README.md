# Pocket · PSP for the browser

A static PSP emulator for GitHub Pages, with a local game library and persistent saves. Bring your own PSP game files; games and progress stay on your device.

**[Open Pocket](https://jarsonfreakabob.github.io/pocket-psp/)**

## Everyday use

1. Add a local ISO, CSO, PBP, or ELF to the library.
2. Choose a game and click **Start PSP**.
3. Save inside the game as usual. Pocket keeps the PSP memory stick in browser storage.
4. For an exact resume point, choose one of three slots and click **Save state**. **Load state** restores that slot directly.
5. Use **Save & quit** before leaving the player.

Normal saving and loading never requires downloading or uploading a file. The collapsed backup section in **Memory stick** is optional, for moving progress between browsers or keeping an extra copy.

The library supports search, sorting, favorites, custom titles, duplicate detection, and game removal. Press **Escape** inside the player to open PPSSPP settings. Keyboard, gamepad and touch controls are provided by the native browser core.

## ARM64 Chromebooks and graphics

Pocket runs WebAssembly in the browser, with no x86 program to install. Current Chrome on ChromeOS ARM64 can provide WebAssembly threads and WebGL 2. The individual game, graphics driver and available memory affect speed and compatibility.

**Compatibility · 1×** is the default: native PSP resolution, normal framebuffer effects and GPU readbacks, no frame skipping, and no texture upscaling. These conservative settings follow PPSSPP's [graphics troubleshooting guidance](https://www.ppsspp.org/docs/troubleshooting/graphics-dont-look-right/).

If textures or effects look wrong, choose **Software · fix rendering**, then **Apply & restart**. Software rendering uses the CPU and can be much slower. The selected mode is remembered per game. Applying a mode saves the memory stick before restarting; make an in-game save first to preserve current progress. **Sharper · 2×** is optional for faster devices.

If WebGL loses its graphics context, Pocket pauses play, leaves **Save & quit** available, and offers **Use Software & restart**. It does not silently discard your library or saved data.

An x64 development test is not a physical ARM64 hardware test. Verify your own games on the intended Chromebook before relying on a particular performance level.

For the Acer N23H7, begin with Compatibility at 1× and use Software only when needed for incorrect graphics. See [VERIFICATION.md](VERIFICATION.md) for the completed browser checks and their hardware limits.

## GitHub Pages

This directory is the repository root. In **Settings → Pages**, select **GitHub Actions**. The included `.github/workflows/pages.yml` runs the tests and deploys the static site on pushes to `main`, or through a manual workflow run.

All application URLs are relative, including the bundled runtime and its worker, so `https://USERNAME.github.io/REPOSITORY/` works. The `.nojekyll` marker also permits publishing the repository root directly from a branch.

## Local preview

Requires Node.js 20 or later; no package install or build step is needed:

```sh
node serve.mjs
```

Open **http://127.0.0.1:4173/**. Opening the HTML as a local file does not work. The first visit may reload once while the isolation service worker activates. HTTPS or localhost, service workers, SharedArrayBuffer, WebAssembly SIMD/threads, and WebGL 2 are required.

## Data and backups

IndexedDB holds game images, metadata, the PSP memory-stick mirror, three state slots per game, and settings. State slots contain real PPSSPP state bytes. Pocket syncs in-game saves every 15 seconds and waits for a fresh final save before quitting or changing the renderer.

**Memory stick → Optional: move progress to another browser** exports a versioned JSON backup of the memory stick, states and settings. Game images are excluded. Restoring validates the whole backup before atomically replacing progress and settings, while retaining games. Add the same game images in another browser to reconnect their content-based state slots.

Data is local to a browser, device, and site origin. Clearing site data removes it, and private browsing may discard it. The storage protection button requests persistence; the browser can decline. There is no cloud sync. Use one active player tab at a time.

## Verification

```sh
node --test storage.test.mjs player.test.mjs events.test.mjs engine-loader.test.mjs graphics.test.mjs controls-native.test.mjs
```

The suite covers file identity, binary backup round trips, invalid paths and backups, atomic validation, pending-save races, safe renderer restarts, graphics recovery, native profiles, and controller mappings. Browser verification must additionally launch a real PSP program and check visible graphics and state restoration; a startup callback alone is insufficient.

## Runtime and credits

The browser runtime is the PPSSPP SDL/WebAssembly fork maintained by [root-hunter](https://github.com/root-hunter/ppsspp-wasm), originally based on [PPSSPP](https://github.com/hrydgard/ppsspp). Runtime assets are bundled locally. See the vendor metadata, [engine notices](engine-notices.txt), and [third-party notices](THIRD-PARTY-NOTICES.md) for source, licenses, and provenance.

GitHub Pages cannot set custom response headers. The bundled MIT-licensed `coi-serviceworker` supplies COOP/COEP isolation within this repository's URL path. The optional Google Fonts stylesheet falls back to system fonts.

No commercial games, Sony firmware, or BIOS are included. PSP games and PSP homebrew are supported; PS1 EBOOTs, PS2 and Vita games are not. Pocket is an independent project, unaffiliated with Sony or the PPSSPP team.
