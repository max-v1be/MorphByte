import os from "node:os";
import fs from "node:fs/promises";
import sharp from "sharp";
sharp.concurrency(1);
const importStart = performance.now();
const { convertBuffer, getBuildInfo } = await import("morphbyte");
const importMs = performance.now() - importStart;
const size = 1024 * 768 * 3;
const pixels = Buffer.alloc(size);
let seed = 1729;

for (let i = 0; i < size; i++)
{
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  pixels[i] = seed >>> 24;
}

const jpeg = await sharp(pixels, {
  raw: { width: 1024, height: 768, channels: 3 },

})

  .jpeg({ quality: 90 })

  .toBuffer();
const json = Buffer.from(
  JSON.stringify({
    items: Array.from({ length: 5000 }, (_, i) => ({
      id: i,
      label: `MorphByte ${i}`,
    })),

  }),

);
const pdf = await convertBuffer(
  Buffer.from("{\"title\":\"MorphByte benchmark\",\"count\":42}"),
  "pdf",
);
const warmup = 2,
  iterations = 10,
  results = [];


async function measure(name, operation)
{
  for (let i = 0; i < warmup; i++)
  {
    await operation();
  }

  const values = [];
  let peakRss = process.memoryUsage().rss,
    bytes = 0;
  const cpuStart = process.cpuUsage(),
    start = performance.now();
  const sampler = setInterval(() =>
  {
    peakRss = Math.max(peakRss, process.memoryUsage().rss);
  }, 5);

  try
  {
    for (let i = 0; i < iterations; i++)
    {
      const t = performance.now(),
        output = await operation();

      values.push(performance.now() - t);
      bytes = output.length;
      peakRss = Math.max(peakRss, process.memoryUsage().rss);
    }

  }

  finally
  {
    clearInterval(sampler);
  }

  const elapsed = performance.now() - start,
    cpu = process.cpuUsage(cpuStart);

  values.sort((a, b) => a - b);
  results.push({
    name,
    iterations,
    warmup,
    medianMs: values[Math.floor(values.length / 2)],
    p95Ms: values[Math.ceil(values.length * 0.95) - 1],
    filesPerSecond: iterations / (elapsed / 1000),
    outputBytes: bytes,
    peakProcessRssBytes: peakRss,
    cpuMs: (cpu.user + cpu.system) / 1000,
    cpuPercent: (cpu.user + cpu.system) / 10 / elapsed,
  });

}

const morph = () => convertBuffer(jpeg, "webp");
const direct = () =>
  sharp(jpeg).autoOrient().webp({ quality: 78, effort: 4, lossless: false }).toBuffer();
const [a, b] = await Promise.all([morph(), direct()]);
const da = await sharp(a).raw().toBuffer(),
  db = await sharp(b).raw().toBuffer();

if (!da.equals(db))
{
  throw new Error("Benchmark invalid: decoded output pixels differ");
}

await measure("MorphByte JPEG -> WebP 1024x768 q78 effort4", morph);
await measure("Sharp JPEG -> WebP 1024x768 q78 effort4", direct);
await measure("MorphByte JSON -> gzip", () =>
  convertBuffer(
    json,
    { format: "json" },

    { compression: { container: { algorithm: "gzip" } } },

  ),
);
await measure("MorphByte PDF -> structured JSON", () => convertBuffer(pdf, "json"));
await measure("MorphByte JPEG -> binary JSON envelope", () =>
  convertBuffer(jpeg, "json"),
);
await measure("MorphByte JPEG -> Base64 TXT", () => convertBuffer(jpeg, "txt"));
const report = {
  timestamp: new Date().toISOString(),
  cpu: os.cpus()[0].model,
  logicalCpus: os.availableParallelism(),
  os: `${os.type()} ${os.release()}`,
  arch: os.arch(),
  build: getBuildInfo(),
  importMs,
  image: { width: 1024, height: 768, inputBytes: jpeg.length, seed: 1729 },

  comparison: {
    decodedPixelsEqual: da.equals(db),
    morphByteOutputBytes: a.length,
    sharpOutputBytes: b.length,
    quality: 78,
    effort: 4,
    metadata: "strip",
    sharpMainThreadCodecConcurrency: 1,
    note: "Sequential warm conversions; includes MorphByte worker messaging. Ordered operations, when requested, materialize intermediate PNGs. RSS is process-wide, sampled every 5ms; native allocations are included, transients can be missed. No universal speed claim.",
  },

  results,
};

await fs.mkdir("docs/benchmarks", { recursive: true });

await fs.writeFile("docs/benchmarks/latest.json", JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ importMs, results }, null, 2));
