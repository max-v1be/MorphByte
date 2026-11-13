# MorphByte

MorphByte is an asynchronous Node.js/Bun **library** for image, PDF, structured-data and reversible binary conversions. Every basic conversion requires only `input` and `output`.

Current version: **0.1.1**. See [CHANGELOG.md](CHANGELOG.md) for changes and [CONTRIBUTING.md](CONTRIBUTING.md) for code style, source layout and development checks.

MorphByte is a development preview. Images use Sharp's native libvips bindings. PDF reading and rendering use PDFium WebAssembly in worker threads; PDF writing uses pdf-lib. The optional C++23 Base64 addon has not been compiled on the development host, which lacks a C++ compiler. See [progress](docs/progress.md) for the remaining work.

```js
import { convert } from "morphbyte";

await convert("input.png", "output.webp");
await convert("document.pdf", "document.json"); // text, dimensions, metadata
await convert("data.json", "report.pdf");       // bundled A4 Unicode report
await convert("document.pdf", "pages/");        // all pages, numbered PNGs
await convert("photo.webp", "photo.pdf");
await convert("photo.png", "photo.txt");        // Base64, not compression
await convert("photo.txt", "restored.png");
await convert("photo.png", "photo.json");       // versioned SHA-256 envelope
await convert("photo.json", "restored.png");
await convert("data.json", "data.json.gz");
```

HEIC support depends on the installed libvips build; it is unavailable in the tested Windows prebuilt. MorphByte does not advertise an installed HEVC encoder. Check `getCapabilities("heic")` before attempting HEIC routes.

## Build and run

Development requires Node.js 22+ and npm. Windows x64 was tested with Node 26.10.0 and Bun 1.4.4. Linux CI is supplied, but has not been executed locally. No Python, HTTP service, or system PDF renderer is needed for core routes.

```sh
npm ci
npm run build
npm run check
npm test

bun test --timeout 30000 packages/tests/core.test.mjs packages/tests/reliability.test.mjs
bun run scripts/bun-smoke.mjs
npm run bench

node examples/basic.mjs
```

If `bun` is not on PATH, the development dependency also provides a platform executable under `node_modules/@oven/`. The local verification used `node_modules/@oven/bun-windows-x64/bin/bun.exe` directly because npm blocked Bun's install script.

To use the library in another local project, run `npm pack --workspace morphbyte` after building, then install the generated `.tgz`. The desired public name is `morphbyte`; **nothing has been published or registered**, and registry availability has not been asserted.

The optional addon requires CMake 3.25+, a C++23 compiler, and Node development headers. On Windows install Visual Studio Build Tools with **Desktop development with C++**. On Linux install CMake, a recent C++ compiler, and standard native development tools. Then run:

```sh
npm run build:native
```

`getBuildInfo().nativeAddon` reports whether it loaded. The source build is separate from normal install; no MorphByte native prebuilds are shipped. Sharp distributes its own platform packages. See [third-party notices](THIRD_PARTY_NOTICES.md).

## Options and results

```js
import {
  convert, convertBuffer, convertBatch, createConverter,
  getDefaultOptions, resolveOptions, getCompressionOptions, getBuildInfo,
} from "morphbyte";

const result = await convert("photo.png", "resized.webp", {
  operations: [
    {type:"resize", width:800, height:600, fit:"contain", background:"#ffffff"},
    {type:"overlay", source:"watermark.png", gravity:"southeast", opacity:0.5},
  ],
  compression: {algorithm:"vp8", encoder:"libwebp", quality:78},
});

console.log(result.outputs, result.backend, result.effectiveOptions);

const bytes = await convertBuffer(await import("node:fs/promises").then(fs => fs.readFile("photo.png")), "webp");
const batch = await convertBatch([
  {input:"a.png", output:"a.webp"}, {input:"b.pdf", output:"b.json"},
], {concurrency:2, continueOnError:true});

const converter = createConverter({
  defaults:{mode:"balanced"},
  formatDefaults:{webp:{compression:{quality:75}}},
  routeDefaults:{"png:webp":{compression:{quality:85}}},
});
```

Options are optional, including `compression:{}`. Precedence is call > route defaults > target-format defaults > consumer defaults > built-in format/global defaults. Consumer defaults are isolated. Unknown or unsupported options fail rather than being silently ignored. Custom adapters execute trusted JavaScript; they must cooperate with cancellation and avoid blocking the event loop.

An effective `metadata:"strip"` policy also re-encodes same-format images when inherited from converter defaults. Without requested changes, same-format conversion remains an exact byte copy. Both `resolveOptions()` and `convert()` reject conflicting output suffixes and compression algorithms; compressed file outputs require the matching compound suffix such as `.json.gz` or `.json.br`.

Results contain `outputs[]`, source/target formats, selected route, fidelity, backend, resolved options, codec selection, warnings, byte counts and duration. File outputs return paths/sizes; `{format:"webp"}` returns bytes. `convertBuffer` returns a single `Uint8Array`. Batch results preserve item order and include each error; `continueOnError` defaults to false.

## Defaults

| Policy | Default |
|---|---|
| Mode / encoder / algorithm | balanced / auto / auto |
| Operations | none; original dimensions |
| Same format, no changes | exact byte copy, including original JSON whitespace |
| JPEG | quality 82, 4:2:0, white alpha background |
| WebP | VP8, quality 78, effort 4; explicit lossless selects VP8L |
| AVIF | AV1/AOM, quality 50, effort 4 |
| PNG | DEFLATE level 6, truecolor |
| PDF render | 144 DPI, page 1 for a file, all pages for a directory |
| PDF to JSON | structured extraction; OCR off |
| JSON to PDF | A4, 48pt margins, 10pt Noto Sans, automatic pagination |
| Report glyphs | Latin, Cyrillic, Greek; unsupported glyphs fail clearly |
| Image to PDF | image-sized page in points, no clipping; arrays preserve order |
| Outer wrapper | none, inferred from `.gz`, `.br`, `.zst`; LZ4 unavailable |
| Metadata | safe ICC retained, orientation normalized, EXIF/XMP/IPTC stripped with warning |
| Concurrency / queue | at most 2 workers, 1 libvips thread each; 64 waiting jobs |
| Limits | input 64 MiB; output 128 MiB; 40 million pixels; 100 pages/frames |
| Timeout / expansion | 30 seconds for queued computation; 200× decompression, 1 KiB floor |
| Writes / network | atomic per file; no overwrite; network disabled |

Lossy codec quality numbers are format-specific, not interchangeable. Presets and explicit settings are inspectable with `getDefaultOptions({to:"avif"})`. `smallest` selects documented settings, not an exhaustive optimizer or guaranteed minimum. Automatic codec selection uses deterministic installed backends, not a measured universal ranking. See [formats](docs/formats.md), [architecture](docs/architecture.md), [security](docs/security.md) and [performance](docs/performance.md).

## Reversibility and fidelity

PDF structured extraction and JSON reports are semantic transformations. For exact PDF recovery:

```js
await convert("report.pdf", "report-envelope.json", {representation:"binary-envelope"});
await convert("report-envelope.json", "recovered.pdf");
```

Envelope recovery validates version, declared length, SHA-256, media type, target and decoded signature. Binary Base64 text is raw byte encoding; PDF → TXT defaults to text extraction unless `{representation:"base64"}` is requested. Same-format copy does not validate every compressed pixel/stream; image headers and PDF loading are checked, but this is not a complete file-integrity verifier.

Animation-preserving re-encoding is not implemented. Animated/multipage image conversion takes frame 1 and emits `MULTIPAGE_TRUNCATED`; unmodified same-format copies retain all original bytes. A single PDF image destination also emits this warning for omitted pages. Multi-file commits are atomic individually and can leave completed pages after an I/O failure. These constraints are part of the current API contract.
