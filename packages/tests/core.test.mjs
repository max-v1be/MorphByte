import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { PDFDocument, StandardFonts } from "pdf-lib";
import * as m from "morphbyte";
let dir, png, jpeg, document;
const p = (name) => path.join(dir, name);
const read = (name) => fs.readFile(p(name));
const sha = (b) => createHash("sha256").update(b).digest("hex");
const code = (expected) => (e) =>
{
  assert.equal(e.code, expected, e.stack);

  return true;
};

before(async () =>
{
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "morphbyte-"));
  png = await sharp({
    create: {
      width: 80,
      height: 40,
      channels: 4,
      background: { r: 220, g: 30, b: 10, alpha: 0.5 },

    },

  })

    .png()
    .toBuffer();
  jpeg = await sharp(png).flatten({ background: "#ffffff" }).jpeg().toBuffer();
  await fs.writeFile(p("image.png"), png);
  await fs.writeFile(p("image.jpg"), jpeg);
  await fs.writeFile(
    p("data.json"),
    JSON.stringify({
      title: "MorphByte — Україна",
      rows: [
        { name: "Alpha", value: 42 },

        { name: "Beta", value: 7 },

      ],
    }),

  );
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);

  for (let i = 0; i < 2; i++)
  {
    const page = pdf.addPage([240, 180]);

    page.drawText(`MorphByte page ${i + 1}`, { x: 20, y: 100, font, size: 16 });

  }

  document = Buffer.from(await pdf.save());
  await fs.writeFile(p("document.pdf"), document);
});

after(async () =>
{
  await fs.rm(dir, { recursive: true, force: true });

});

test("two-argument JPEG -> WebP and PNG -> JPEG preserve dimensions", async () =>
{
  const a = await m.convert(p("image.jpg"), p("out.webp"));
  const b = await m.convert(p("image.png"), p("out.jpg"));

  assert.equal((await sharp(await read("out.webp")).metadata()).width, 80);
  assert.equal((await sharp(await read("out.jpg")).metadata()).height, 40);
  assert.equal(a.selectedAlgorithm, "vp8");
  assert.equal(a.effectiveOptions.mode, "balanced");
  assert.equal(b.selectedAlgorithm, "jpeg");
  assert.ok(b.warnings.some((w) => w.code === "ALPHA_FLATTENED"));
});

test("two-argument PNG -> WebP -> PNG produces valid signatures", async () =>
{
  await m.convert(p("image.png"), p("round.webp"));
  await m.convert(p("round.webp"), p("round.png"));
  assert.equal((await m.detect(p("round.png"))).format, "png");
});

test("same-format default copies PNG, JSON and PDF byte-for-byte", async () =>
{
  for (const [src, dst] of [
    ["image.png", "copy.png"],
    ["data.json", "copy.json"],
    ["document.pdf", "copy.pdf"],
  ])
  {
    const result = await m.convert(p(src), p(dst));

    assert.deepEqual(await read(dst), await read(src));
    assert.ok(result.conversionPath.includes("copy"));
    assert.equal(result.backend, "copy");
  }

});

test("two-argument PDF -> structured JSON extracts page text and dimensions", async () =>
{
  const result = await m.convert(p("document.pdf"), p("document.json"));
  const json = JSON.parse(await read("document.json"));

  assert.equal(json.pageCount, 2);
  assert.equal(json.pages[0].width, 240);
  assert.match(json.pages[1].text, /MorphByte page 2/);
  assert.equal(result.fidelity, "extraction");
});

test("two-argument Unicode JSON -> PDF uses bundled fonts and pagination", async () =>
{
  await m.convert(p("data.json"), p("report.pdf"));
  const d = await PDFDocument.load(await read("report.pdf"));

  assert.ok(d.getPageCount() >= 1);
  const result = await m.convert(await read("report.pdf"), { format: "json" });

  const j = JSON.parse(Buffer.from(result.outputs[0].bytes));

  assert.match(j.pages.map((p) => p.text).join(""), /Україна/);
  const long = Buffer.from(
    JSON.stringify({
      items: Array.from({ length: 160 }, (_, i) => `Row ${i}: automatic pagination`),
    }),

  );
  const bytes = await m.convertBuffer(long, "pdf");

  assert.ok((await PDFDocument.load(bytes)).getPageCount() > 1);
});

test("two-argument PDF -> single PNG warns about page truncation", async () =>
{
  const result = await m.convert(p("document.pdf"), p("page.png"));

  assert.equal((await sharp(await read("page.png")).metadata()).width, 480);
  assert.ok(result.warnings.some((w) => w.code === "MULTIPAGE_TRUNCATED"));
});

test("two-argument PDF -> directory emits numbered PNG manifest for all pages", async () =>
{
  const result = await m.convert(p("document.pdf"), p("pages") + path.sep);

  assert.equal(result.outputs.length, 2);
  assert.equal(result.outputs[0].name, "page-0001.png");
  assert.equal(result.outputs[1].page, 2);
});

test("PDF page ranges and transforms apply before image encoding", async () =>
{
  const result = await m.convert(
    p("document.pdf"),
    { directory: p("selected"), format: "webp" },

    {
      pdf: { pages: [2], dpi: 72 },

      operations: [{ type: "resize", width: 120, height: 90, fit: "fill" }],

    },

  );

  assert.equal(result.outputs[0].page, 2);
  assert.equal(
    (await sharp(await fs.readFile(result.outputs[0].path)).metadata()).width,
    120,
  );
});

test("two-argument image -> PDF -> image is a valid pipeline", async () =>
{
  await m.convert(p("image.png"), p("image.pdf"));
  const pdf = await PDFDocument.load(await read("image.pdf"));

  assert.deepEqual(pdf.getPage(0).getSize(), { width: 80, height: 40 });

  await m.convert(p("image.pdf"), p("from-pdf.png"));
  assert.equal((await sharp(await read("from-pdf.png")).metadata()).width, 160);
});

test("two-argument image -> JSON envelope -> image preserves exact bytes", async () =>
{
  await m.convert(p("image.png"), p("image.json"));
  await m.convert(p("image.json"), p("restored.png"));
  assert.equal(sha(await read("restored.png")), sha(png));
});

test("PDF envelope roundtrip preserves exact bytes and detects tampering", async () =>
{
  const encoded = await m.convertBuffer(document, "json", {
    representation: "binary-envelope",
  });

  const restored = await m.convertBuffer(encoded, "pdf");

  assert.equal(sha(restored), sha(document));
  const bad = JSON.parse(Buffer.from(encoded));

  bad.sha256 = "0".repeat(64);
  await assert.rejects(
    m.convertBuffer(Buffer.from(JSON.stringify(bad)), "pdf"),
    code("HASH_MISMATCH"),
  );
  bad.sha256 = sha(document);
  bad.version = 7;
  await assert.rejects(
    m.convertBuffer(Buffer.from(JSON.stringify(bad)), "pdf"),
    code("INVALID_ENVELOPE"),
  );
});

test("two-argument binary -> Base64 TXT -> binary preserves exact bytes", async () =>
{
  await m.convert(p("image.png"), p("image.txt"));
  await m.convert(p("image.txt"), p("base64.png"));
  assert.deepEqual(await read("base64.png"), png);
  const txt = await m.convertBuffer(document, "txt", {
    representation: "base64",
  });

  assert.deepEqual(Buffer.from(await m.convertBuffer(txt, "pdf")), document);
  await assert.rejects(
    m.convertBuffer(Buffer.from("not a base64 file!"), "png"),
    code("INVALID_BASE64"),
  );
});

test("Base64 data URI, wrapping and URL-safe variant roundtrip", async () =>
{
  const txt = await m.convertBuffer(png, "txt", {
    representation: "base64",
    dataUri: true,
    lineWidth: 76,
  });

  assert.deepEqual(Buffer.from(await m.convertBuffer(txt, "png")), png);
  const url = await m.convertBuffer(png, "txt", {
    representation: "base64",
    base64Variant: "url",
  });

  assert.deepEqual(
    Buffer.from(await m.convertBuffer(url, "png", { base64Variant: "url" })),

    png,
  );
});

test("two-argument gzip/Brotli/Zstd compound suffixes roundtrip", async () =>
{
  for (const suffix of ["gz", "br", "zst"])
  {
    if (suffix === "zst" && !m.getCompressionOptions("json").wrappers.includes("zstd"))
    {
      continue;
    }

    await m.convert(p("data.json"), p(`data.json.${suffix}`));
    await m.convert(p(`data.json.${suffix}`), p(`unwrapped-${suffix}.json`));
    assert.deepEqual(await read(`unwrapped-${suffix}.json`), await read("data.json"));
  }

});

test("all five resize fit modes honor geometry contracts", async () =>
{
  const expected = {
    cover: [30, 30],
    contain: [30, 30],
    fill: [30, 30],
    inside: [30, 15],
    outside: [60, 30],
  };

  for (const [fit, dims] of Object.entries(expected))
  {
    const b = await m.convertBuffer(png, "png", {
      operations: [{ type: "resize", width: 30, height: 30, fit }],

    });

    const s = await sharp(b).metadata();

    assert.deepEqual([s.width, s.height], dims, fit);
  }

});

test("operations preserve order, crop bounds and overlay alpha/position", async () =>
{
  const base = await sharp({
    create: { width: 10, height: 10, channels: 4, background: "#000000" },

  })

    .png()
    .toBuffer();
  const layer = await sharp({
    create: { width: 2, height: 2, channels: 4, background: "#ffffff" },

  })

    .png()
    .toBuffer();
  const out = await m.convertBuffer(base, "png", {
    operations: [
      { type: "resize", width: 20, height: 20, fit: "fill" },

      { type: "crop", x: 5, y: 5, width: 10, height: 10 },

      { type: "overlay", source: layer, x: 8, y: 8, opacity: 0.5 },

    ],
  });

  const { data, info } = await sharp(out)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  assert.equal(info.width, 10);
  assert.equal(data[0], 0);
  assert.ok(data[(9 * 10 + 9) * 4] >= 127 && data[(9 * 10 + 9) * 4] <= 128);
  await assert.rejects(
    m.convertBuffer(png, "png", {
      operations: [{ type: "crop", x: 79, y: 0, width: 2, height: 2 }],

    }),

    code("INVALID_INPUT"),
  );
});

test("capabilities, defaults, compression {} and unavailable encoder errors", async () =>
{
  assert.equal(m.getDefaultOptions({ to: "jpeg" }).compression.quality, 82);
  assert.equal(m.getDefaultOptions({ to: "avif" }).compression.quality, 50);
  for (const compression of [{}, { algorithm: "auto" }])

  {
    const r = await m.convert(png, { format: "webp" }, { compression });

    assert.equal(r.selectedEncoder, "libwebp");
    assert.equal(r.effectiveOptions.compression.algorithm, "vp8");
  }

  await assert.rejects(
    m.convertBuffer(png, "avif", { compression: { encoder: "svt-av1" } }),

    code("MISSING_BACKEND"),
  );
  const result = await m.convert(
    png,
    { format: "avif" },

    { compression: { encoder: "svt-av1", fallback: "compatible" } },

  );

  assert.equal(result.selectedEncoder, "aom");
  assert.ok(result.warnings.some((w) => w.code === "ENCODER_FALLBACK"));
  await assert.rejects(
    m.convertBuffer(png, "jpeg", { compression: { lossless: true } }),

    code("UNSUPPORTED_OPTION"),
  );
  const lossless = await m.convertBuffer(png, "webp", {
    compression: { lossless: true },

  });

  assert.equal((await sharp(lossless).metadata()).format, "webp");
  const resolved = await m.resolveOptions(p("image.png"), p("resolve.webp"));

  assert.equal(resolved.from, "png");
  assert.equal(resolved.compression.encoder, "libwebp");
});

test("isolated consumer defaults and per-call precedence", async () =>
{
  const c = m.createConverter({ defaults: { compression: { quality: 61 } } });

  const a = await c.convert(png, { format: "webp" });

  const b = await c.convert(png, { format: "webp" }, { compression: { quality: 91 } });

  assert.equal(a.effectiveOptions.compression.quality, 61);
  assert.equal(b.effectiveOptions.compression.quality, 91);
  assert.equal(m.getDefaultOptions({ to: "webp" }).compression.quality, 78);
});

test("structured JSON/YAML/XML/CSV/TOML use real parsers", async () =>
{
  const json = Buffer.from(JSON.stringify({ name: "MorphByte", count: 2 }));

  for (const format of ["yaml", "xml", "toml"])
  {
    const b = await m.convertBuffer(json, format);
    const out = await m.convertBuffer(b, "json", { from: format });

    const parsed = JSON.parse(Buffer.from(out));

    assert.equal(format === "xml" ? parsed.root.name : parsed.name, "MorphByte");
  }

  const rows = Buffer.from("[{\"name\":\"Alice\",\"count\":2},{\"name\":\"Bob\",\"count\":3}]");
  const csv = await m.convertBuffer(rows, "csv");
  const back = await m.convertBuffer(csv, "json", { from: "csv" });

  assert.equal(JSON.parse(Buffer.from(back))[1].name, "Bob");
  await assert.rejects(
    m.convertBuffer(
      Buffer.from(
        "<!DOCTYPE x [<!ENTITY x SYSTEM \"file:///etc/passwd\">]><root>&x;</root>",
      ),
      "json",
    ),
    code("INVALID_INPUT"),
  );
});

test("custom graph adapters register, execute multi-hop and unregister", async () =>
{
  m.registerFormat({
    id: "record",
    extensions: ["record"],
    mimeTypes: ["application/x-morphbyte-record"],
  });

  m.registerFormat({
    id: "record64",
    extensions: ["record64"],
    mimeTypes: ["application/x-morphbyte-record64"],
  });

  const a = m.registerConverter({
    from: "json",
    to: "record",
    fidelity: "structured",
    convert: async ({ input }) => Buffer.from("RECORD:" + Buffer.from(input).toString()),
  });

  const b = m.registerConverter({
    from: "record",
    to: "record64",
    fidelity: "lossless",
    convert: async ({ input }) => Buffer.from(Buffer.from(input).toString("base64")),
  });

  try
  {
    assert.ok(m.canConvert("json", "record64"));
    assert.ok(m.getConversions("json").includes("record64"));
    const r = await m.convert(
      Buffer.from("{\"x\":1}"),
      { format: "record64" },

      { from: "json" },

    );

    assert.deepEqual(r.conversionPath, ["json", "record", "record64"]);
    assert.match(
      Buffer.from(Buffer.from(r.outputs[0].bytes).toString(), "base64").toString(),
      /^RECORD:/,
    );
  }

  finally
  {
    m.unregisterConverter(a);
    m.unregisterConverter(b);
    m.unregisterFormat("record");
    m.unregisterFormat("record64");
  }

});

test("bounded batch reports per-item failures and event loop remains responsive", async () =>
{
  let ticks = 0;
  const timer = setInterval(() => ticks++, 1);

  try
  {
    const r = await m.convertBatch(
      Array.from({ length: 8 }, (_, i) => ({
        input: i === 7 ? Buffer.from("garbage!") : png,
        output: { format: "webp" },

      })),

      { concurrency: 4, continueOnError: true },

    );

    assert.equal(r.succeeded, 7);
    assert.equal(r.failed, 1);
    assert.ok(ticks > 0);
  }

  finally
  {
    clearInterval(timer);
  }

});

test("AbortSignal, timeout and queue cleanup allow later jobs", async () =>
{
  const c = new AbortController();

  c.abort();
  await assert.rejects(
    m.convertBuffer(png, "webp", { signal: c.signal }),

    code("ABORTED"),
  );
  await assert.rejects(m.convertBuffer(png, "avif", { timeoutMs: 1 }), code("TIMEOUT"));
  const big = await sharp({
    create: { width: 1500, height: 1500, channels: 3, background: "#aabbcc" },

  })

    .png()
    .toBuffer();
  const running = new AbortController();
  const job = m.convertBuffer(big, "avif", {
    signal: running.signal,
    compression: { effort: 9 },

  });

  setTimeout(() => running.abort(), 10);
  await assert.rejects(job, code("ABORTED"));
  assert.ok((await m.convertBuffer(png, "webp")).length > 0);
});

test("no overwrite, input aliases, hardlinks, limits, unknown formats and SVG resources", async () =>
{
  await assert.rejects(m.convert(p("image.png"), p("image.png")), code("INVALID_INPUT"));
  await fs.link(p("image.png"), p("hardlink.png"));
  await assert.rejects(
    m.convert(p("image.png"), p("hardlink.png"), { overwrite: true }),

    code("INVALID_INPUT"),
  );
  await assert.rejects(m.convert(p("image.png"), p("copy.png")), code("IO_ERROR"));
  await assert.rejects(
    m.convertBuffer(png, "webp", { maxInputBytes: 1 }),

    code("LIMIT_EXCEEDED"),
  );
  await assert.rejects(
    m.convertBuffer(png, "png", {
      operations: [{ type: "resize", width: 100000, height: 100000 }],

    }),

    code("LIMIT_EXCEEDED"),
  );
  await assert.rejects(m.convert(png, p("unknown.extension")), code("UNKNOWN_FORMAT"));
  await assert.rejects(
    m.convertBuffer(png, "webp", { notAnOption: true }),

    code("UNSUPPORTED_OPTION"),
  );
  await assert.rejects(
    m.convertBuffer(
      Buffer.from(
        "<svg xmlns=\"http://www.w3.org/2000/svg\"><image href=\"https://example.com/x.png\"/></svg>",
      ),
      "png",
    ),
    code("INVALID_INPUT"),
  );
  assert.ok(!(await fs.readdir(dir)).some((x) => x.startsWith(".morphbyte-")));
});

test("signature detection ignores misleading file extension and probe exposes dimensions", async () =>
{
  await fs.writeFile(p("misleading.jpg"), png);
  assert.equal((await m.detect(p("misleading.jpg"))).format, "png");
  assert.equal((await m.probe(png)).width, 80);
});
