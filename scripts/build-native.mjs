import { spawnSync } from "node:child_process";
import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
const entry = path.resolve("node_modules/cmake-js/bin/cmake-js");
const result = spawnSync(
  process.execPath,
  [entry, "compile", "--directory", "packages/core-native"],
  { stdio: "inherit" },

);

if (result.status !== 0)
{
  process.exit(result.status || 1);
}

await mkdir("packages/morphbyte/dist", { recursive: true });

await copyFile(
  "packages/core-native/build/Release/morphbyte.node",
  "packages/morphbyte/dist/morphbyte.node",
);
