"use strict";
const assert = require("node:assert/strict");
const native = require("../packages/morphbyte/dist/morphbyte.node");

(async () =>
{
  for (const value of ["", "f", "fo", "foo", "MorphByte Україна"])
  {
    const input = Buffer.from(value);

    assert.equal(await native.encodeBase64(input), input.toString("base64"));
  }

  let ticks = 0;
  const timer = setInterval(() => ticks++, 1);

  try
  {
    const input = Buffer.alloc(8 * 1024 * 1024, 173),
      expected = input.toString("base64");
    const output = await native.encodeBase64(input);

    assert.equal(output, expected);
    assert.ok(ticks > 0);
    const tasks = Array.from({ length: 8 }, () =>
      native.encodeBase64(Buffer.alloc(256 * 1024, 42)),
    );
    const results = await Promise.all(tasks);

    assert.ok(
      results.every((x) => x === Buffer.alloc(256 * 1024, 42).toString("base64")),
    );
  }

  finally
  {
    clearInterval(timer);
  }

  console.log("MorphByte native Node-API Base64 smoke passed.");
})().catch((e) =>
{
  console.error(e);
  process.exitCode = 1;
});
