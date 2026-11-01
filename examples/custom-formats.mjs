import assert from "node:assert/strict";
import {
  registerFormat,
  registerConverter,
  convert,
  unregisterFormat,
  getConversions,
} from "morphbyte";
registerFormat({
  id: "record",
  extensions: ["record"],
  mimeTypes: ["application/x-morphbyte-record"],
});

registerFormat({
  id: "record64",
  extensions: ["record64"],
  mimeTypes: ["application/x-morphbyte-record64"],
});

registerConverter({
  from: "json",
  to: "record",
  fidelity: "structured",
  convert: async ({ input, signal }) =>
  {
    signal.throwIfAborted();

    return Buffer.from("RECORD:" + Buffer.from(input));
  },

});

registerConverter({
  from: "record",
  to: "record64",
  fidelity: "lossless",
  convert: async ({ input, signal }) =>
  {
    signal.throwIfAborted();

    return Buffer.from(Buffer.from(input).toString("base64"));
  },

});

try
{
  const result = await convert(
    Buffer.from("{\"value\":42}"),
    { format: "record64" },

    { from: "json" },

  );

  assert.deepEqual(result.conversionPath, ["json", "record", "record64"]);
  console.log(getConversions("json"), result.conversionPath);
}

finally
{
  unregisterFormat("record");
  unregisterFormat("record64");
}
