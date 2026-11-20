# Native PPSSPP runtime

These files vendor the browser build of **PPSSPP 1.20.4-wasm** published by the
unofficial [root-hunter PPSSPP web fork](https://github.com/root-hunter/ppsspp-web).
The original emulator is by Henrik Rydgard and the PPSSPP contributors.

The WebAssembly and `.data` files are byte-for-byte upstream artifacts. Pocket
changes three JavaScript boot hooks: honor `Module.noInitialRun`, expose
`Module.callMain`, and register a `Module.postMainLoop` callback. This lets the
Start button unlock audio and lets state operations wait for a completed frame.
No emulator instructions, CPU implementation, or native state data are patched.

`runtime-lock.json` records exact SHA-256 hashes and the publication's content
revision. The publisher exposes a content revision rather than a source SHA;
the recorded web repository and pinned WASM submodule commits are the source
snapshots observed when vendoring. The artifact hashes identify the delivered
runtime without relying on future changes to its hosted URLs.

Verify all native assets and reproduce the JavaScript hooks with:

```sh
node native/prepare-runtime.mjs
```

The unmodified generated JavaScript is retained as `PPSSPPSDL.upstream.js`.
Corresponding source and build instructions are available in the
[WASM fork](https://github.com/root-hunter/ppsspp-wasm/tree/4d0564bc687b86d2f88e132d79ea118e290b004b)
and [web build repository](https://github.com/root-hunter/ppsspp-web/tree/ea176fd67a0a46c5ff4a1e20fde27cde4268e2a5).
Their README and Makefile describe the Emscripten toolchain, release build,
assets, and GitHub Pages packaging.

PPSSPP is licensed under GNU GPL version 2 or later, with the third-party notices
preserved in [LICENSE.TXT](LICENSE.TXT). Pocket is independent of the official
PPSSPP project and Sony. Games and Sony firmware are not included.
