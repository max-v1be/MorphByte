# Implemented formats and routes

This is a tested route matrix for the Windows x64 development build, not a claim that every listed extension has every encoder. Use runtime capabilities because Sharp packages/codecs can vary. `canConvert` reports a possible route, not a promise that arbitrary contents satisfy it; e.g. JSON → PNG requires a valid binary envelope.

| Family | Implemented behavior | Verification |
|---|---|---|
| JPEG, PNG, WebP | decode/encode; native Sharp/libvips | conversions, dimensions, alpha, lossless WebP pixels |
| AVIF | AV1/AOM encode/decode when bundled | output encoding and codec fallback tests |
| GIF | decode/encode first frame | animated input warns on truncation |
| TIFF | decode/encode first page, LZW | backend exposed, no dedicated TIFF round-trip fixture yet |
| SVG | restricted SVG input to raster; gzip `.svgz` wrapper | external-resource rejection; no SVG encoder |
| HEIC/HEIF | recognized; installed backend required | unavailable on the tested prebuilt, returns `MISSING_BACKEND` |
| PDF → PNG/WebP/JPEG | PDFium rasterization; page selection/DPI/operations | PNG/WebP fixtures; JPEG shares tested image encoder |
| PDF → JSON/TXT | text, page dimensions, selected metadata | structured and metadata-only fixtures |
| JSON → PDF | built-in readable Unicode report | Ukrainian text extraction and pagination |
| Images → PDF | image-sized pages; image array → ordered pages | single/multiple page fixtures |
| PDFs → PDF | array merge; selected pages; directory split | page order/dimensions/count fixtures |
| Binary ↔ JSON | versioned SHA-256 envelope, signature-checked recovery | image/PDF byte equality, tampering/version errors |
| Binary ↔ Base64 TXT | standard/URL-safe, data URI, line wrap | exact image/PDF round-trips, invalid alphabet errors |
| JSON/YAML/XML/TOML | sound parser/serializer adapters | structural conversion fixtures |
| CSV/TSV | comma/tab, header row, UTF-8; flat object arrays | CSV fixture; TSV implementation shares delimiter path |
| gzip/Brotli/Zstd | bounded wrappers and compound extensions | JSON wrapper round-trips; Zstd runtime-gated |
| Custom formats | async trusted converters, costs, cycle-safe graph | two-format multi-hop registration test and example |

Only configured legal image combinations are available: JPEG/libjpeg-turbo; PNG/DEFLATE through Sharp's zlib-compatible library; WebP/VP8 or VP8L/libwebp; AVIF/AV1/AOM; GIF/LZW/cgif; TIFF/LZW/libtiff. Alternative encoders such as SVT-AV1, rav1e, Zopfli and MozJPEG are not selectable in this version even if the underlying distribution contains related code. Explicit unsupported choices fail unless the caller permits and receives a fallback warning. PNG/zlib version is taken from the actual zlib-ng build; JPEG encoder version is left unknown when Sharp does not expose it.

Presets map JPEG quality to 75/82/65/95 for fastest/balanced/smallest/highest-quality; WebP to 72/78/60/95; AVIF to 45/50/35/80. WebP/AVIF effort is 0 for fastest, 6 for smallest, 4 otherwise. PNG levels are 1/6/9 for fastest/balanced/smallest. Lossless mode is verified only for PNG, TIFF, PDF writing and WebP VP8L; other choices fail. Palette conversion to GIF is lossy. JPEG flattening uses white and emits `ALPHA_FLATTENED`.

Supported ordered image operations: resize (`cover`, `contain`, `fill`, `inside`, `outside`, width/height, kernels, gravity), integer crop with strict bounds, overlay with opacity/position/blend, extend, rotation, horizontal/vertical flip, flatten, grayscale, blur, sharpen, modulation, gamma, threshold, trim and normalize. Core geometry/alpha/overlay/ICC behavior is tested; the remaining adjustment methods are adapter integrations, not individually verified with a quality fixture yet.

Not implemented: animation-preserving encoding, multi-frame image directory extraction, JPEG XL/QOI/BMP/ICO/RAW specialized support, native PDFium linking, OCR, document/ebook/presentation adapters, spreadsheet/database adapters, PDF encryption/decryption editing, annotations/coordinate extraction, arbitrary templates/fonts, masks/text overlays/affine transforms, target-size search, alternative encoders, LZ4, HTTP/stream adapters, custom native codec loading, native prebuild publication. DOCX/EPUB ZIP repacking is not advertised. Missing optional backends are not treated as successful conversions.

XML rejects DTD/entities and reads scalar text as strings. XML output wraps values in `root`; CSV reads values as strings and requires a flat record array on write. TOML rejects values it cannot represent. Structural conversions emit loss warnings where roots/types/tables can change. Plain ambiguous text is not silently treated as YAML or Base64-decoded bytes unless the requested route/signature permits it.
