import assert from "node:assert/strict";
import fs from "node:fs/promises";
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
const packageRoot = path.dirname(path.dirname(entry));
const manifest = JSON.parse(
  await fs.readFile(path.join(packageRoot, "package.json"), "utf8"),
);
const expected = JSON.parse(
  await fs.readFile(
    new URL("../packages/morphbyte/package.json", import.meta.url),
    "utf8",
  ),
);

assert.equal((await fs.lstat(packageRoot)).isSymbolicLink(), false);
assert.equal(manifest.version, expected.version);
assert.equal(cjs.getBuildInfo().version, manifest.version);
assert.equal(esm.getBuildInfo().version, manifest.version);
assert.ok(
  (await fs.readFile(path.join(packageRoot, "CHANGELOG.md"), "utf8")).includes(
    `## ${manifest.version}`,
  ),
);
assert.equal(typeof cjs.convert, "function");
assert.equal(typeof esm.convert, "function");
const xml = await esm.convertBuffer(
  Buffer.from(JSON.stringify({ message: "MorphByte Україна XML", value: 42 })),

  "xml",
);
const structured = JSON.parse(Buffer.from(await cjs.convertBuffer(xml, "json")));

assert.equal(structured.root.message, "MorphByte Україна XML");
assert.equal(structured.root.value, "42");
await assert.rejects(
  cjs.convertBuffer(Buffer.from("<root><broken>"), "json", { from: "xml" }),

  (error) => error.code === "CORRUPT_FILE",
);
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
  "MorphByte installed-tarball version/changelog, ESM/CJS, XML/PDF/Unicode/image/envelope smoke passed:",
  entry,
);
