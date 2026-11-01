import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";
const project = path.resolve(process.argv[2] || ".test-output/consumer");
const require = createRequire(path.join(project, "package.json"));
const entry = require.resolve("morphbyte");

assert.ok(
  entry.startsWith(path.join(project, "node_modules", "morphbyte")),
  "Smoke must resolve the installed tarball",
);
const cjs = require("morphbyte");
const esm = await import(pathToFileURL(entry.replace(/index\.cjs$/, "index.js")).href);

assert.equal(typeof cjs.convert, "function");
assert.equal(typeof esm.convert, "function");
const pdf = await esm.convertBuffer(
  Buffer.from(JSON.stringify({ message: "MorphByte Україна package test" })),

  "pdf",
);
const result = JSON.parse(Buffer.from(await cjs.convertBuffer(pdf, "json")));

assert.match(result.pages[0].text, /Україна/);
const image = await esm.convertBuffer(pdf, "png");

assert.ok(image.length);
const envelope = await esm.convertBuffer(image, "json");

assert.deepEqual(
  Buffer.from(await cjs.convertBuffer(envelope, "png")),
  Buffer.from(image),
);
console.log(
  "MorphByte installed-tarball ESM/CJS, PDF/Unicode/image/envelope smoke passed:",
  entry,
);
