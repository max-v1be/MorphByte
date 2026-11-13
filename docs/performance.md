# Performance and reproducibility

Run `npm run build && npm run bench` on an otherwise idle host. Results are written to `docs/benchmarks/latest.json` with CPU, OS, architecture, runtime, codec versions, warmup count, repetitions, median/p95, files/sec, output bytes, sampled process RSS and process CPU time. The workload is deterministic seeded 1024×768 noise encoded as quality-90 JPEG. Noise is deliberately difficult to compress and is not representative of every photograph.

The Sharp comparison uses the same libvips distribution, orientation handling, no metadata, WebP quality 78/effort 4 and one codec thread. Before measuring, the harness requires **identical decoded output pixels** and reports both output sizes. MorphByte includes worker messaging, runtime checks and diagnostics. Two warmups and ten sequential conversions are used. This is not a statistically comprehensive codec benchmark or cold-start/load test. Import time is recorded; first-conversion startup is not isolated. CPU percentage is process CPU divided by wall time and may exceed 100%.

RSS is process-wide and includes other live workers and native/WASM allocations. Sampling every 5 ms can miss transients; use OS tooling for peak-memory certification. No perceptual metric is substituted for the exact decoded-pixel equality check of this matched comparison. Reports include actual errors by failing the benchmark instead of inventing a result.

An initial measurement identified an unnecessary PNG intermediate on no-operation image routes. That serialization was removed; ordered operation pipelines still use materialized intermediates to guarantee exact operation order. The JSON report retains the historical v0.1.0 measurement from 2026-11-01; it was not rerun for v0.1.1. There is no claim of universal superiority over Sharp, and no unmeasured speedup is advertised.

Additional measured workloads cover JSON/gzip, PDF text/metadata extraction, JPEG binary envelopes and Base64 text. Not yet measured: HEIC, alternate encoders, target-size search, multipage saturation, cold-start distributions, process-isolated crash behavior, repeat-run native leaks, or a representative real-world image corpus.
