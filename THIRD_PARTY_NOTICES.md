# Third-party notices and distribution status

MorphByte's own source is MIT licensed. Dependencies retain their licenses. The lockfile records exact package versions and integrity hashes. No independently built third-party native binaries are committed or published by this project.

| Dependency | Declared license / role |
|---|---|
| Sharp | Apache-2.0; native Node-API image adapter |
| libvips | LGPL-2.1-or-later; dynamically linked in Sharp's platform distribution |
| PDFium / `@hyzyla/pdfium` | PDFium BSD-style and upstream third-party notices; wrapper MIT; bundled WASM |
| pdf-lib / `@pdf-lib/fontkit` | MIT; PDF authoring and font embedding |
| Noto Sans / `@fontsource/noto-sans` | SIL Open Font License 1.1; bundled font subsets |
| yaml | ISC |
| fast-xml-parser | MIT |
| smol-toml | MIT |
| csv-parse / csv-stringify | MIT |
| CMake.js / TypeScript / Bun tooling | build/development dependencies; respective MIT/Apache-2.0/MIT notices |

See installed dependency LICENSE files and Sharp platform packages for the full transitive image-codec inventory, upstream source URLs and notices. Runtime codec versions are exposed through `getBuildInfo()`. Dependencies are resolved by npm rather than copied into a monolithic binary. Preserve all notices when redistributing a bundled application. libvips LGPL obligations include license/source availability and the user's ability to replace/relink the dynamically linked library as applicable; do not statically combine or hide those libraries without a separate compliance review.

The PDFium wrapper package does not by itself establish that every PDFium third-party notice has been collected for a future custom distribution. Before publishing a bundled application or native prebuild, collect the exact PDFium build's licenses/source provenance, Sharp/libvips dependency notices and source/relocation information. This project's transitive native-license review is **incomplete**, and no statement of comprehensive legal clearance is made. No Ghostscript, GPL/AGPL document converter, or HEVC encoder is deliberately added by MorphByte. Check actual codec builds and any patents/license requirements separately before enabling extra backends.
