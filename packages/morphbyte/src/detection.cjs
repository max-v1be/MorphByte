"use strict";
const fs = require("node:fs/promises");
const path = require("node:path");
const zlib = require("node:zlib");
const { promisify } = require("node:util");
const { formats, normalize } = require("./formats/index.cjs");
const { fail } = require("./errors.cjs");
const wrappers = { gz: "gzip", br: "brotli", zst: "zstd", lz4: "lz4" };


async function readBounded(filename, maxBytes)
{
  let f;

  try
  {
    f = await fs.open(filename, "r");
    const stat = await f.stat();

    if (!stat.isFile())
    {
      fail("INVALID_INPUT", "Input must be a regular file");
    }

    if (stat.size > maxBytes)
    {
      fail("LIMIT_EXCEEDED", "Input byte limit exceeded");
    }

    const chunks = [];
    let size = 0;

    for await (const chunk of f.createReadStream({ autoClose: false }))

    {
      size += chunk.length;

      if (size > maxBytes)
      {
        fail("LIMIT_EXCEEDED", "Input byte limit exceeded while reading");
      }

      chunks.push(chunk);
    }

    return Buffer.concat(chunks, size);
  }

  finally
  {
    await f?.close();
  }

}


function pathFormat(p)
{
  let ext = path.extname(p).slice(1).toLowerCase(),
    wrapper = wrappers[ext] || "none";

  if (wrapper !== "none")
  {
    p = p.slice(0, -ext.length - 1);
    ext = path.extname(p).slice(1).toLowerCase();
  }

  if (ext === "svgz")
  {
    return { format: "svg", wrapper: "gzip" };

  }

  return {
    format: [...formats.values()].find((f) => f.extensions.includes(ext))?.id,
    wrapper,
  };

}


function signature(b)
{
  if (b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
  {
    return "png";
  }

  if (b[0] === 255 && b[1] === 216 && b[2] === 255)
  {
    return "jpeg";
  }

  if (b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP")
  {
    return "webp";
  }

  if (/^GIF8[79]a/.test(b.toString("ascii", 0, 6)))
  {
    return "gif";
  }

  if (b.toString("ascii", 0, 5) === "%PDF-")
  {
    return "pdf";
  }

  if (b.toString("hex", 0, 4) === "49492a00" || b.toString("hex", 0, 4) === "4d4d002a")
  {
    return "tiff";
  }

  if (b.toString("ascii", 4, 8) === "ftyp")
  {
    const brands = b.toString("ascii", 8, Math.min(b.length, 64));

    if (/avif|avis/.test(brands))
    {
      return "avif";
    }

    if (/heic|heix|hevc|hevx|mif1/.test(brands))
    {
      return "heic";
    }

  }

}


function text(b)
{
  try
  {
    return new TextDecoder("utf-8", { fatal: true }).decode(b);
  }

  catch
  {
    return null;
  }

}


function detectBytes(b, hint)
{
  const sig = signature(b);

  if (sig)
  {
    return { format: sig, confidence: 1, method: "signature" };

  }

  const s = text(b);

  if (s === null || s.includes("\u0000"))
  {
    fail("UNKNOWN_FORMAT", "Unrecognized binary signature");
  }

  const t = s.trim();

  if (t)
  {
    try
    {
      JSON.parse(t);

      return { format: "json", confidence: 1, method: "parse" };

    }

    catch
    {
    }

  }

  if (/^(?:<\?xml[^>]*>\s*)?<svg[\s>]/i.test(t))
  {
    return { format: "svg", confidence: 0.95, method: "signature" };

  }

  if (/^(?:<\?xml[^>]*>\s*)?<[^>]+>/.test(t))
  {
    return { format: "xml", confidence: 0.8, method: "text" };

  }

  if (["yaml", "toml", "csv", "tsv"].includes(hint))
  {
    return { format: hint, confidence: 0.5, method: "hint" };

  }

  if (hint && formats.get(hint)?.custom)
  {
    return { format: hint, confidence: 0.5, method: "hint" };

  }

  return { format: "txt", confidence: 0.5, method: "utf8" };

}


async function readInput(input, o)
{
  let b, hint, filename;

  if (typeof input === "string")
  {
    if (/^[a-z]+:\/\//i.test(input))
    {
      fail("UNSUPPORTED_OPTION", "Network input is disabled");
    }

    filename = path.resolve(input);

    try
    {
      b = await readBounded(filename, o.maxInputBytes);
    }

    catch (e)
    {
      if (e.code && e.name === "MorphByteError")
      {
        throw e;
      }

      fail("IO_ERROR", `Cannot read input: ${e.message}`);
    }

    hint = pathFormat(input).format;
  }

  else if (input instanceof Uint8Array)
  {
    b = Buffer.from(input);
  }

  else
  {
    fail("INVALID_INPUT", "Expected a file path or Uint8Array");
  }

  if (b.length > o.maxInputBytes)
  {
    fail("LIMIT_EXCEEDED", "Input byte limit exceeded");
  }

  const inputBytes = b.length;
  let wrapper = "none";

  if (b[0] === 31 && b[1] === 139)
  {
    wrapper = "gzip";
  }

  else if (b.toString("hex", 0, 4) === "28b52ffd")
  {
    wrapper = "zstd";
  }

  else if (filename && pathFormat(filename).wrapper !== "none")
  {
    wrapper = pathFormat(filename).wrapper;
  }

  if (wrapper !== "none")
  {
    b = await wrap(b, wrapper, false, o);
  }

  const detected = detectBytes(b, normalize(o.from || hint));

  if (o.from && normalize(o.from) !== detected.format)
  {
    fail("INVALID_INPUT", `Content is ${detected.format}, not ${o.from}`);
  }

  return { ...detected, bytes: b, inputBytes, filename, wrapper };

}


async function wrap(b, algorithm, encode, o, level)
{
  if (algorithm === "none")
  {
    return b;
  }

  const fn = {
    gzip: encode ? zlib.gzip : zlib.gunzip,
    brotli: encode ? zlib.brotliCompress : zlib.brotliDecompress,
    zstd: encode ? zlib.zstdCompress : zlib.zstdDecompress,
  }[algorithm];

  if (!fn)
  {
    fail("MISSING_BACKEND", `${algorithm} is unavailable in this runtime`);
  }

  const opts = {
    maxOutputLength: encode
      ? o.maxOutputBytes
      : Math.min(o.maxInputBytes, Math.max(1024, b.length * o.maxExpansionRatio)),
  };

  if (encode && level !== undefined)
  {
    if (algorithm === "gzip")
    {
      if (level > 9)
      {
        fail("UNSUPPORTED_OPTION", "gzip level must be 0..9");
      }

      opts.level = level;
    }

    if (algorithm === "brotli")
    {
      if (level > 11)
      {
        fail("UNSUPPORTED_OPTION", "Brotli level must be 0..11");
      }

      opts.params = { [zlib.constants.BROTLI_PARAM_QUALITY]: level };

    }

    if (algorithm === "zstd")
    {
      opts.params = { [zlib.constants.ZSTD_c_compressionLevel]: level };

    }

  }

  try
  {
    return await promisify(fn)(b, opts);
  }

  catch (e)
  {
    fail(
      e.code === "ERR_BUFFER_TOO_LARGE"
        ? "LIMIT_EXCEEDED"
        : encode
          ? "ENCODER_ERROR"
          : "CORRUPT_FILE",
      e.message,
    );
  }

}

module.exports = {
  pathFormat,
  signature,
  text,
  detectBytes,
  readInput,
  readBounded,
  wrap,
};
