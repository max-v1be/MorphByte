import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import sharp from "sharp";
import { PDFDocument, StandardFonts } from "pdf-lib";
import * as m from "morphbyte";
const image = () =>
  sharp({
    create: { width: 64, height: 32, channels: 4, background: "#3187aa80" },

  })

    .png()
    .toBuffer();
const hasCode = (code) => (e) => e.code === code;

test("configured convertBuffer validates input before opening files", async () =>
{
  const converter = m.createConverter();

  for (const convertBuffer of [m.convertBuffer, converter.convertBuffer])
  {
    await assert.rejects(convertBuffer("missing.png", "jpeg"), hasCode("INVALID_INPUT"));
    const result = await convertBuffer(await image(), "jpeg");

    assert.equal((await sharp(result).metadata()).format, "jpeg");
  }

});

test("worker errors keep a single MorphByte prefix and their public code", async () =>
{
  await assert.rejects(
    m.convertBuffer(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), "png"),
    (error) =>
    {
      assert.equal(error.code, "CORRUPT_FILE");
      assert.ok(error instanceof m.MorphByteError);
      assert.equal(error.message.split("MorphByte: ").length - 1, 1);

      return true;
    },

  );
});

test("multiple ordered images -> PDF and PDF merge/split select real pages", async () =>
{
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "morphbyte-pages-"));

  try
  {
    const a = await image(),
      b = await sharp(a).resize(20, 10).png().toBuffer();
    const result = await m.convert([a, b], { format: "pdf" });

    const pdfBytes = result.outputs[0].bytes;
    const d = await PDFDocument.load(pdfBytes);

    assert.equal(d.getPageCount(), 2);
    assert.equal(d.getPage(1).getWidth(), 20);
    const merged = await m.convert([pdfBytes, pdfBytes], { format: "pdf" });

    assert.equal((await PDFDocument.load(merged.outputs[0].bytes)).getPageCount(), 4);
    const split = await m.convert(pdfBytes, { directory: dir, format: "pdf" });

    assert.equal(split.outputs.length, 2);
    assert.equal(
      (await PDFDocument.load(await fs.readFile(split.outputs[1].path))).getPageCount(),
      1,
    );
    const selected = await m.convert(
      pdfBytes,
      { format: "pdf" },

      { pdf: { pages: [2] } },

    );

    assert.equal(
      (await PDFDocument.load(selected.outputs[0].bytes)).getPage(0).getWidth(),
      20,
    );
  }

  finally
  {
    await fs.rm(dir, { recursive: true, force: true });

  }

});

test("format and route defaults respect explicit call > route > format > global", async () =>
{
  const c = m.createConverter({
    defaults: { compression: { quality: 50 } },

    formatDefaults: { webp: { compression: { quality: 60 } } },

    routeDefaults: { "png:webp": { compression: { quality: 70 } } },

  });

  const png = await image();

  assert.equal(
    (await c.convert(png, { format: "webp" })).effectiveOptions.compression.quality,
    70,
  );
  assert.equal(
    (await c.convert(png, { format: "webp" }, { compression: { quality: 90 } }))

      .effectiveOptions.compression.quality,
    90,
  );
});

test("corrupt recognized images are rejected even for copy/envelope", async () =>
{
  const b = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  await assert.rejects(m.convertBuffer(b, "png"), hasCode("CORRUPT_FILE"));
  await assert.rejects(m.convertBuffer(b, "json"), hasCode("CORRUPT_FILE"));
});

test("decompression expansion, output bytes and aggregate page limits", async () =>
{
  const b = gzipSync(Buffer.from(JSON.stringify({ text: "a".repeat(100000) })));

  await assert.rejects(
    m.convertBuffer(b, "json", { maxExpansionRatio: 2 }),

    hasCode("LIMIT_EXCEEDED"),
  );
  await assert.rejects(
    m.convertBuffer(await image(), "webp", { maxOutputBytes: 1 }),

    hasCode("LIMIT_EXCEEDED"),
  );
  await assert.rejects(
    m.convert([await image(), await image()], { format: "pdf" }, { maxPages: 1 }),

    hasCode("LIMIT_EXCEEDED"),
  );
});

test("pixel-perfect lossless WebP and ICC survive the image pipeline", async () =>
{
  const b = await sharp(await image())
    .withIccProfile("srgb")
    .png()
    .toBuffer();
  const out = await m.convertBuffer(b, "webp", {
    compression: { lossless: true },

  });

  assert.ok((await sharp(out).metadata()).icc);
  assert.deepEqual(await sharp(out).raw().toBuffer(), await sharp(b).raw().toBuffer());
});

test("multi-frame conversion emits non-suppressible content loss warning", async () =>
{
  const frames = Buffer.alloc(4 * 4 * 4 * 2);

  frames.fill(255, 0, 4 * 4 * 4);
  frames.fill(128, 4 * 4 * 4);
  const gif = await sharp(frames, {
    raw: { width: 4, height: 8, channels: 4, pageHeight: 4 },

  })

    .gif({ delay: [100, 100], loop: 0 })

    .toBuffer();
  const result = await m.convert(gif, { format: "png" });

  assert.ok(result.warnings.some((w) => w.code === "MULTIPAGE_TRUNCATED"));
});

test("batch stop policy and queued cancellation finish every result", async () =>
{
  const png = await image();
  const r = await m.convertBatch(
    [
      { input: Buffer.from("bad!"), output: { format: "webp" } },

      ...Array.from({ length: 4 }, () => ({
        input: png,
        output: { format: "webp" },

      })),

    ],
    { concurrency: 1 },

  );

  assert.equal(r.results.length, 5);
  assert.equal(r.failed, 5);
  const c = new AbortController();
  const jobs = Array.from({ length: 6 }, () =>
    m.convertBuffer(png, "avif", {
      signal: c.signal,
      compression: { effort: 8 },

    }),

  );

  setTimeout(() => c.abort(), 10);
  const settled = await Promise.allSettled(jobs);

  assert.equal(
    settled.filter((x) => x.status === "rejected" && x.reason.code === "ABORTED").length,
    6,
  );
  assert.ok((await m.convertBuffer(png, "webp")).length);
});

test("output symlink parents and conflicting wrappers are rejected", async (t) =>
{
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "morphbyte-links-"));

  try
  {
    await fs.mkdir(path.join(dir, "real"));

    try
    {
      await fs.symlink(
        path.join(dir, "real"),
        path.join(dir, "link"),
        process.platform === "win32" ? "junction" : "dir",
      );
    }

    catch (e)
    {
      if (["EPERM", "EACCES"].includes(e.code))
      {
        t.skip("Host does not permit symlinks");

        return;
      }

      throw e;
    }

    await assert.rejects(
      m.convert(await image(), path.join(dir, "link", "out.webp")),
      hasCode("INVALID_INPUT"),
    );
    assert.deepEqual(await fs.readdir(path.join(dir, "real")), []);
    await assert.rejects(
      m.convert(Buffer.from("{}"), path.join(dir, "out.json.gz"), {
        compression: { container: { algorithm: "brotli" } },

      }),

      hasCode("UNSUPPORTED_OPTION"),
    );
  }

  finally
  {
    await fs.rm(dir, { recursive: true, force: true });

  }

});

test("unsupported semantic operations and arbitrary binary text fail explicitly", async () =>
{
  await assert.rejects(
    m.convertBuffer(await image(), "txt", {
      operations: [{ type: "grayscale" }],

    }),

    hasCode("UNSUPPORTED_OPTION"),
  );
  await assert.rejects(
    m.convertBuffer(await image(), "json", { representation: "structured" }),

    hasCode("UNSUPPORTED_OPTION"),
  );
  await assert.rejects(
    m.convertBuffer(Buffer.from("{}"), "png"),
    hasCode("UNSUPPORTED_CONVERSION"),
  );
  await assert.rejects(
    m.convertBuffer(await image(), "heic"),
    hasCode("MISSING_BACKEND"),
  );
});

test("PDF metadata-only extraction honors requested fields", async () =>
{
  const d = await PDFDocument.create();

  d.setTitle("Metadata test");
  const f = await d.embedFont(StandardFonts.Helvetica);

  d.addPage().drawText("Private page text", { x: 20, y: 20, font: f });

  const result = JSON.parse(
    Buffer.from(
      await m.convertBuffer(await d.save(), "json", {
        pdf: { extract: ["metadata"] },

      }),

    ),
  );

  assert.equal(result.metadata.title, "Metadata test");
  assert.equal(result.pages[0].text, undefined);
});

test("repeated failures/conversions keep queue usable and progress is measurable", async () =>
{
  const png = await image(),
    events = [];

  for (let i = 0; i < 8; i++)
  {
    await assert.rejects(m.convertBuffer(Buffer.from("!"), "webp"));
    assert.ok(
      (
        await m.convertBuffer(png, "webp", {
          onProgress: (e) => events.push(e),
        })

      ).length,
    );
  }

  assert.ok(events.length);
  assert.ok(events.every((e) => e.completed <= e.total && e.unit === "files" && e.jobId));
});
