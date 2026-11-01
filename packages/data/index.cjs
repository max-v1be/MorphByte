"use strict";
const { createHash } = require("node:crypto");
const { fail } = require("../errors.cjs");
const { signature } = require("../detection.cjs");
const { formats } = require("../formats/index.cjs");
const hash = (b) => createHash("sha256").update(b).digest("hex");


function strictBase64(s, variant = "standard")
{
  s = s.trim();
  const uri = /^data:([^;,]*);base64,(.*)$/s.exec(s);

  if (uri)
  {
    s = uri[2];
  }

  s = s.replace(/[\r\n]/g, "");
  const url = variant === "url";

  if (
    !s ||
    !(url ? /^[A-Za-z0-9_-]+={0,2}$/ : /^[A-Za-z0-9+/]+={0,2}$/).test(s) ||
    s.length % 4 === 1
  )
  {
    fail("INVALID_BASE64", "Invalid Base64 alphabet or padding");
  }

  const b = Buffer.from(s, url ? "base64url" : "base64");
  // Buffer decoding accepts malformed input; verify the canonical encoding below.
  if (
    b.toString(url ? "base64url" : "base64").replace(/=+$/, "") !== s.replace(/=+$/, "")
  )
  {
    fail("INVALID_BASE64", "Noncanonical Base64");
  }

  if (!url && s.length % 4 !== 0)
  {
    fail("INVALID_BASE64", "Standard Base64 requires padding");
  }

  return b;
}


function envelope(b, format)
{
  return Buffer.from(
    JSON.stringify(
      {
        $schema: "morphbyte/binary-envelope",
        version: 1,
        format,
        mediaType: formats.get(format)?.mimeTypes[0],
        encoding: "base64",
        byteLength: b.length,
        sha256: hash(b),
        data: b.toString("base64"),
      },

      null,
      2,
    ) + "\n",
  );
}


function decodeEnvelope(j, target, o)
{
  if (
    j?.$schema !== "morphbyte/binary-envelope" ||
    j.version !== 1 ||
    j.encoding !== "base64" ||
    !Number.isSafeInteger(j.byteLength) ||
    j.byteLength < 0 ||
    typeof j.data !== "string" ||
    !/^[a-f0-9]{64}$/.test(j.sha256)
  )
  {
    fail("INVALID_ENVELOPE", "Invalid or unversioned binary envelope");
  }

  if (j.byteLength > o.maxInputBytes)
  {
    fail("LIMIT_EXCEEDED", "Envelope byte limit exceeded");
  }

  const b = strictBase64(j.data);

  if (b.length !== j.byteLength)
  {
    fail("INVALID_ENVELOPE", "Envelope length mismatch");
  }

  if (hash(b) !== j.sha256)
  {
    fail("HASH_MISMATCH", "Envelope SHA-256 mismatch");
  }

  if (
    j.format !== target ||
    j.mediaType !== formats.get(target)?.mimeTypes[0] ||
    signature(b) !== target
  )
  {
    fail("INVALID_ENVELOPE", "Envelope type, signature or requested target mismatch");
  }

  return b;
}


function parse(b, format)
{
  const s = b.toString("utf8");

  try
  {
    switch (format)
    {
      case "json":
        return JSON.parse(s);
      case "yaml":
        return require("yaml").parse(s, {
          maxAliasCount: 20,
          uniqueKeys: true,
        });

      case "toml":
        return require("smol-toml").parse(s);
      case "xml":
      {
        if (/<!DOCTYPE|<!ENTITY/i.test(s))
        {
          fail("INVALID_INPUT", "XML DTD and entities are forbidden");
        }

        const { XMLParser, XMLValidator } = require("fast-xml-parser");
        const valid = XMLValidator.validate(s);

        if (valid !== true)
        {
          fail("CORRUPT_FILE", "Invalid XML", valid);
        }

        return new XMLParser({
          ignoreAttributes: false,
          processEntities: false,
          parseTagValue: false,
        }).parse(s);
      }

      case "csv":
      case "tsv":
        return require("csv-parse/sync").parse(s, {
          columns: true,
          skip_empty_lines: true,
          delimiter: format === "tsv" ? "\t" : ",",
          max_record_size: 1024 * 1024,
        });

      default:
        fail("UNSUPPORTED_CONVERSION", `Cannot parse ${format}`);
    }

  }

  catch (e)
  {
    if (e.name === "MorphByteError")
    {
      throw e;
    }

    fail("CORRUPT_FILE", `Invalid ${format}: ${e.message}`);
  }

}


function serialize(j, format)
{
  try
  {
    switch (format)
    {
      case "json":
        return Buffer.from(JSON.stringify(j, null, 2) + "\n");
      case "yaml":
        return Buffer.from(require("yaml").stringify(j));
      case "toml":
        return Buffer.from(require("smol-toml").stringify(j));
      case "xml":
        return Buffer.from(
          new (require("fast-xml-parser").XMLBuilder)({
            ignoreAttributes: false,
            format: true,
          }).build({ root: j }),

        );
      case "csv":
      case "tsv":
        if (
          !Array.isArray(j) ||
          !j.every(
            (row) =>
              row &&
              typeof row === "object" &&
              !Array.isArray(row) &&
              Object.values(row).every(
                (v) => v === null || ["string", "number", "boolean"].includes(typeof v),
              ),
          )
        )
        {
          fail("UNSUPPORTED_CONVERSION", "CSV requires an array of flat records");
        }

        return Buffer.from(
          require("csv-stringify/sync").stringify(j, {
            header: true,
            delimiter: format === "tsv" ? "\t" : ",",
          }),

        );
      default:
        fail("UNSUPPORTED_CONVERSION", `Cannot serialize ${format}`);
    }

  }

  catch (e)
  {
    if (e.name === "MorphByteError")
    {
      throw e;
    }

    fail("UNSUPPORTED_CONVERSION", `Cannot represent data as ${format}: ${e.message}`);
  }

}

module.exports = {
  hash,
  strictBase64,
  envelope,
  decodeEnvelope,
  parse,
  serialize,
};
