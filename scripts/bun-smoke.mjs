import assert from "node:assert/strict";
import { createRequire } from "node:module";
import sharp from "sharp";
import { convertBuffer, convertBatch, getBuildInfo } from "morphbyte";
const require = createRequire(import.meta.url);
const cjs = require("morphbyte");

assert.equal(typeof cjs.convert, "function");
const png = await sharp({
  create: { width: 20, height: 10, channels: 4, background: "#ff000080" },

})

  .png()
  .toBuffer();
const webp = await convertBuffer(png, "webp");

assert.equal((await sharp(webp).metadata()).width, 20);
const pdf = await convertBuffer(
  Buffer.from(JSON.stringify({ message: "MorphByte Україна" })),

  "pdf",
);
const extracted = JSON.parse(Buffer.from(await convertBuffer(pdf, "json")));

assert.match(extracted.pages[0].text, /Україна/);
const rendered = await convertBuffer(pdf, "png");

assert.ok(rendered.length);
const envelope = await convertBuffer(png, "json");

assert.deepEqual(Buffer.from(await convertBuffer(envelope, "png")), png);
let ticks = 0;
const timer = setInterval(() => ticks++, 1);
const batch = await convertBatch(
  Array.from({ length: 4 }, () => ({ input: png, output: { format: "webp" } })),

);

clearInterval(timer);
assert.equal(batch.succeeded, 4);
assert.ok(ticks > 0);
const controller = new AbortController();

controller.abort();
await assert.rejects(
  convertBuffer(png, "webp", { signal: controller.signal }),

  (e) => e.code === "ABORTED",
);
console.log(
  "MorphByte Bun ESM/CJS, image/PDF/JSON/envelope, responsive batch and cancellation smoke passed.",
  getBuildInfo().runtime,
);
