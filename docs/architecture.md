# Architecture

The npm workspace contains one publishable package, `packages/morphbyte`. Runtime source is CommonJS with a generated ESM facade and TypeScript declarations. `scripts/build.mjs` copies the engine/adapters into the package; consumers need only the package and its declared dependencies. Both entry points are exercised in Node and Bun. No frontend or CLI is required.

1. The facade validates known options and resolves output path/directory/wrapper semantics.
2. Jobs enter a FIFO queue (2 workers maximum, 64 waiting). Deadlines include queue wait. CPU-heavy parsing, hashing, Base64, PDF layout, WASM rendering and native image processing happen outside the main JavaScript thread.
3. Input is read with byte limits; gzip/Zstd signatures and compound suffixes identify wrappers. Brotli requires a suffix because it has no dependable standalone signature. Binary signatures precede filename hints. Ambiguous YAML/TOML/CSV need an extension or `from` hint.
4. Built-in semantic routes dispatch directly to tested adapters. A Dijkstra-style minimum-cost, cycle-safe planner connects registered **custom** conversion edges; it does not yet compose arbitrary built-in and custom edges.
5. Optional image operations run in exact supplied order. Materialized PNG intermediates guarantee repeated resize/crop/composite ordering; direct image conversions avoid intermediate serialization. This trades peak performance for reliable ordering on advanced pipelines.
6. Worker results carry artifacts and diagnostics. The facade stages same-directory exclusive temporary files, flushes them, and commits with exclusive hardlinks (no overwrite) or rename (explicit overwrite). Temporary files are removed on success/failure. Symlink output ancestors and input/output aliases are rejected.

## Backends

The public API is in `engine.cjs`. Worker scheduling lives in `worker-pool.cjs`; output target resolution, path checks and file commits live in `output.cjs`. Both default resolution and configured converter instances use the option merge code in `options.cjs`.

Output wrapper validation is shared by `resolveOptions()` and conversion execution. A compound output suffix selects its wrapper unless an explicit algorithm conflicts; compressed file output without the corresponding suffix is rejected. Same-format copy is bypassed when the resolved metadata policy is `strip`, including policies inherited from converter defaults. Runtime build information reads the package manifest version.

| Directory | Responsibility |
|---|---|
| `packages/core-native` | C++23 Node-API asynchronous Base64 addon source; bounded admission of 8 tasks, RAII-owned input; optional and not locally built |
| `packages/morphbyte/src` | public facade, worker lifecycle, validation, detection, filesystem safety, error codes and declarations |
| `packages/formats` | format/codec registry, capabilities, trusted custom graph planner |
| `packages/image` | Sharp/libvips adapter; native codec execution, resource checks, ordered transforms |
| `packages/pdf` | bundled PDFium WASM loading/extraction/rendering; pdf-lib writing/merge/split; fontkit/Noto report text |
| `packages/data` | envelopes, strict Base64, JSON/YAML/XML/TOML/CSV/TSV adapters |
| `packages/tests` | API, fidelity, filesystem, limits, responsiveness and cancellation tests |
| `packages/benchmarks` | reproducible local comparison with Sharp and semantic-route measurements |

pdf-lib was selected because it is MIT licensed, cross-runtime and supports authoring and page copying independently of PDFium. It runs inside workers, since its layout and serialization are CPU-bound JavaScript. PDFium is the real PDF parser/renderer, but its distribution here is WASM rather than a native C++ binding. Neither backend provides OCR in this release. JSON reports embed bundled Noto subsets and fail for unavailable glyphs; fonts are not fetched from the network or borrowed from the host.

## Cancellation and memory

Abort/timeout removes queued jobs or terminates a running worker, waits for its termination and then admits another job. Native Sharp calls may finish before worker termination completes; there is no codec-level preemption guarantee. Successfully completed workers are reused and unreferenced when idle. The main thread performs asynchronous I/O and transfers buffered job results; stream/backpressure adapters are not yet implemented.

Each worker uses one libvips thread, a 32 MiB libvips cache and a 256 MiB V8 heap ceiling. Pixel/byte/page limits constrain known allocations, but worker threads share a process and this is **not** a hard per-job RSS/native/WASM memory or crash boundary. File writes follow computation and are not covered by the compute timeout. Custom JavaScript adapters run in the caller's thread with cooperative cancellation; their CPU/memory behavior is trusted.

The optional native addon uses `napi_async_work`, copies bounded Buffer input into owned storage and never calls JavaScript on a worker thread. Its own queue has bounded admission, not a custom scheduler; running Base64 loops do not yet support cooperative native cancellation. It has not passed a local compile/runtime gate, so it is not counted as a completed native engine.
