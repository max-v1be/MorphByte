import { mkdir, cp, copyFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = fileURLToPath(new URL("../", import.meta.url));
const dest = path.join(root, "packages/morphbyte/dist");

await mkdir(dest, { recursive: true });

await cp(path.join(root, "docs"), path.join(root, "packages/morphbyte/docs"), {
  recursive: true,
});

await cp(path.join(root, "packages/morphbyte/src"), dest, {
  recursive: true,
  filter: (p) => !p.endsWith(".ts"),
});

for (const name of ["formats", "image", "pdf", "data"])
{
  await cp(path.join(root, "packages", name), path.join(dest, name), {
    recursive: true,
  });

}

await copyFile(
  path.join(root, "packages/morphbyte/src/index.d.ts"),
  path.join(dest, "index.d.ts"),
);
await writeFile(
  path.join(dest, "index.cjs"),
  "module.exports = require(\"./engine.cjs\");\n",
);
const api = [
  "convert",
  "convertBuffer",
  "convertBatch",
  "probe",
  "detect",
  "getFormats",
  "getConversions",
  "canConvert",
  "getCapabilities",
  "getEncoderOptions",
  "getCompressionOptions",
  "getCompressionAlgorithms",
  "getEncoders",
  "getDefaultOptions",
  "resolveOptions",
  "getBuildInfo",
  "registerFormat",
  "registerConverter",
  "unregisterFormat",
  "unregisterConverter",
  "createConverter",
  "MorphByteError",
];

await writeFile(
  path.join(dest, "index.js"),
  `import api from "./engine.cjs";\n\nexport const {${api.join(",")}} = api;\n`,
);
for (const file of [
  "README.md",
  "CHANGELOG.md",
  "CONTRIBUTING.md",
  "LICENSE",
  "THIRD_PARTY_NOTICES.md",
])
{
  try
  {
    await copyFile(path.join(root, file), path.join(root, "packages/morphbyte", file));
  }

  catch (e)
  {
    if (e.code !== "ENOENT")
    {
      throw e;
    }

  }

}

console.log("MorphByte JavaScript and declarations built.");
