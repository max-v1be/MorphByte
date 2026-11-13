# Changelog

## 0.1.1 — 2026-11-13

- Apply `metadata: "strip"` from converter global, format and route defaults to same-format image conversions. Per-call overrides retain their precedence; unchanged conversions still copy exact bytes.
- Make `resolveOptions()` and `convert()` enforce the same output compression rules. Conflicting suffixes and algorithms, or compressed file targets without a compound suffix, fail with `UNSUPPORTED_OPTION`.
- Read `getBuildInfo().version` from the package manifest so runtime diagnostics match the installed package.
- Raise the minimum `fast-xml-parser` version to 5.12.0 for [GHSA-474x-hrwr-fgx4](https://github.com/NaturalIntelligence/fast-xml-parser/security/advisories/GHSA-474x-hrwr-fgx4); update the lockfile and its required `is-unsafe` dependency. MorphByte does not enable the affected `stopNodes` option.
- Add regression coverage for metadata policies, wrapper resolution and package version reporting. Include this changelog in the npm package.

## 0.1.0

- Initial development preview: image, PDF, structured-data, Base64 and binary-envelope conversion; bounded workers, cancellation, limits and atomic file output.
