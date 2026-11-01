import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import sharp from "sharp";
import {
  convert,
  convertBatch,
  getEncoders,
  getCompressionOptions,
  createConverter,
} from "morphbyte";
const dir = await mkdtemp(path.join(os.tmpdir(), "morphbyte-example-")),
  p = (name) => path.join(dir, name);

try
{
  const png = await sharp({
    create: { width: 120, height: 80, channels: 4, background: "#277da8" },

  })

    .png()
    .toBuffer();

  await writeFile(p("input.png"), png);
  await writeFile(
    p("data.json"),
    JSON.stringify({ title: "MorphByte Україна", items: [1, 2, 3] }),

  );
  await convert(p("input.png"), p("output.webp"));
  await convert(p("data.json"), p("report.pdf"));
  await convert(p("report.pdf"), p("report.json"));
  await convert(p("report.pdf"), p("pages") + path.sep);
  await convert(p("input.png"), p("image.pdf"));
  await convert(p("input.png"), p("image.json"));
  await convert(p("image.json"), p("restored.png"));
  await convert(p("input.png"), p("image.txt"));
  await convert(p("image.txt"), p("restored-base64.png"));
  await convert(p("data.json"), p("data.json.gz"));
  assert.deepEqual(await readFile(p("restored.png")), png);
  assert.deepEqual(await readFile(p("restored-base64.png")), png);
  console.log(
    "Installed AVIF encoders:",
    getEncoders({ format: "avif", algorithm: "av1" }),

  );
  console.log("WebP controls:", getCompressionOptions("webp"));

  try
  {
    await convert(p("input.png"), p("unavailable.avif"), {
      compression: { encoder: "svt-av1", fallback: "error" },

    });

  }

  catch (e)
  {
    assert.equal(e.code, "MISSING_BACKEND");
    console.log("Expected error:", e.code);
  }

  await convert(p("input.png"), p("empty-options.webp"), { compression: {} });

  await convert(p("input.png"), p("auto.webp"), {
    compression: { algorithm: "auto" },

  });

  const c = createConverter({ formatDefaults: { webp: { mode: "smallest" } } });

  await c.convert(p("input.png"), p("preset.webp"));
  console.log(
    await convertBatch(
      [
        { input: p("input.png"), output: p("batch.webp") },

        { input: p("report.pdf"), output: p("batch.txt") },

      ],
      { concurrency: 2, continueOnError: true },

    ),
  );
  console.log("MorphByte examples passed; temporary artifacts will be removed.");
}

finally
{
  await rm(dir, { recursive: true, force: true });

}
