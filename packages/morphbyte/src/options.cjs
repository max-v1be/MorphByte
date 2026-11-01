"use strict";
const { fail } = require("./errors.cjs");
const { normalize, getEncoders } = require("./formats/index.cjs");
const concurrency = Math.max(1, Math.min(2, require("node:os").availableParallelism()));
const defaults = {
  mode: "balanced",
  operations: [],
  representation: "auto",
  metadata: "safe",
  overwrite: false,
  atomic: true,
  network: false,
  timeoutMs: 30000,
  maxInputBytes: 64 * 1024 * 1024,
  maxOutputBytes: 128 * 1024 * 1024,
  maxPixels: 40000000,
  maxPages: 100,
  maxFrames: 100,
  maxExpansionRatio: 200,
  pdf: { dpi: 144, pages: "all", pageSize: "A4", template: "key-value" },

  compression: {
    algorithm: "auto",
    encoder: "auto",
    lossless: "auto",
    fallback: "error",
    container: { algorithm: "none" },

  },

};

const allowed = new Set([
  ...Object.keys(defaults),
  "from",
  "to",
  "signal",
  "onProgress",
  "optimize",
  "base64Variant",
  "dataUri",
  "lineWidth",
]);
const compressionKeys = new Set([
  "mode",
  "algorithm",
  "encoder",
  "quality",
  "effort",
  "level",
  "lossless",
  "fallback",
  "container",
  "formatOptions",
]);


function validateKeys(obj, keys, label)
{
  if (!obj || typeof obj !== "object" || Array.isArray(obj))
  {
    fail("UNSUPPORTED_OPTION", `${label} must be an object`);
  }

  for (const k of Object.keys(obj))
  {
    if (!keys.has(k))
    {
      fail("UNSUPPORTED_OPTION", `Unknown ${label}.${k}`);
    }

  }

}


function mergeConfigured(...layers)
{
  const out = {};

  for (const x of layers)
  {
    if (!x)
    {
      continue;
    }

    validateKeys(x, allowed, "options");
    for (const [k, v] of Object.entries(x))
    {
      if (v === undefined)
      {
        continue;
      }

      if (k === "compression")
      {
        validateKeys(v, compressionKeys, "compression");
        out.compression = {
          ...out.compression,
          ...v,
          container: { ...out.compression?.container, ...v.container },

        };

      }

      else if (k === "pdf")
      {
        out.pdf = { ...out.pdf, ...v };

      }

      else
      {
        out[k] = v;
      }

    }

  }

  return out;
}


function merge(...layers)
{
  // Each conversion owns its defaults, including nested objects.
  return mergeConfigured(structuredClone(defaults), ...layers);
}


function resolve(to, ...layers)
{
  to = normalize(to);
  const o = merge(...layers),
    c = o.compression;

  if (
    ![
      "fastest",
      "balanced",
      "smallest",
      "highest-quality",
      "lossless",
      "custom",
    ].includes(c.mode || o.mode)
  )
  {
    fail("UNSUPPORTED_OPTION", "Unknown compression mode");
  }

  for (const k of [
    "timeoutMs",
    "maxInputBytes",
    "maxOutputBytes",
    "maxPixels",
    "maxPages",
    "maxFrames",
    "maxExpansionRatio",
  ])
  {
    if (!Number.isSafeInteger(o[k]) || o[k] < 1)
    {
      fail("UNSUPPORTED_OPTION", `${k} must be a positive integer`);
    }

  }

  if (o.network !== false)
  {
    fail("UNSUPPORTED_OPTION", "Network input is not implemented");
  }

  if (o.atomic !== true)
  {
    fail("UNSUPPORTED_OPTION", "Only atomic output is supported");
  }

  if (
    !["safe", "strip"].includes(o.metadata) ||
    !["auto", "structured", "binary-envelope", "base64"].includes(o.representation)
  )
  {
    fail("UNSUPPORTED_OPTION", "Invalid metadata or representation policy");
  }

  if (!Array.isArray(o.operations))
  {
    fail("UNSUPPORTED_OPTION", "operations must be an array");
  }

  if (o.base64Variant && !["standard", "url"].includes(o.base64Variant))
  {
    fail("UNSUPPORTED_OPTION", "Invalid Base64 variant");
  }

  if (!["error", "auto", "compatible"].includes(c.fallback))
  {
    fail("UNSUPPORTED_OPTION", "Invalid fallback");
  }

  if (!["auto", true, false].includes(c.lossless))
  {
    fail("UNSUPPORTED_OPTION", "Invalid lossless");
  }

  validateKeys(c.container, new Set(["algorithm", "level"]), "container");

  if (!["none", "gzip", "brotli", "zstd", "lz4"].includes(c.container.algorithm))
  {
    fail("UNSUPPORTED_OPTION", "Unknown wrapper");
  }

  if (c.container.algorithm === "lz4")
  {
    fail("MISSING_BACKEND", "LZ4 backend is not installed; use gzip or Brotli");
  }

  if (
    c.container.level !== undefined &&
    (!Number.isInteger(c.container.level) ||
      c.container.level < 0 ||
      c.container.level > 22)
  )
  {
    fail("UNSUPPORTED_OPTION", "Invalid wrapper level");
  }

  const preset = c.mode || o.mode;
  let encoder = getEncoders({ format: to })[0];
  const warnings = [];

  if (
    (c.algorithm === "vp8l" && to === "webp") ||
    (to === "webp" && (c.lossless === true || preset === "lossless"))
  )
  {
    encoder = getEncoders({ format: to, algorithm: "vp8l" })[0];
  }

  if (encoder)
  {
    if (
      (c.algorithm !== "auto" && c.algorithm !== encoder.algorithm) ||
      (c.encoder !== "auto" && c.encoder !== encoder.encoder)
    )
    {
      if (c.fallback === "error")
      {
        fail(
          "MISSING_BACKEND",
          `Requested ${c.algorithm}/${c.encoder} unavailable for ${to}`,
          { available: getEncoders({ format: to }) },

        );
      }

      warnings.push({
        code: "ENCODER_FALLBACK",
        message: `Using ${encoder.encoder}/${encoder.algorithm}`,
      });

    }

    c.algorithm = encoder.algorithm;
    c.encoder = encoder.encoder;
    const quality = {
      jpeg: { fastest: 75, balanced: 82, smallest: 65, "highest-quality": 95 },

      webp: { fastest: 72, balanced: 78, smallest: 60, "highest-quality": 95 },

      avif: { fastest: 45, balanced: 50, smallest: 35, "highest-quality": 80 },

    };

    if (quality[to])
    {
      c.quality ??= quality[to][preset] ?? quality[to].balanced;
    }

    if (to === "webp" || to === "avif")
    {
      c.effort ??= preset === "fastest" ? 0 : preset === "smallest" ? 6 : 4;
    }

    if (to === "png")
    {
      c.level ??= preset === "fastest" ? 1 : preset === "smallest" ? 9 : 6;
    }

    if ((preset === "lossless" || c.lossless === true) && !encoder.lossless)
    {
      fail("UNSUPPORTED_OPTION", `Verified lossless encoding unavailable for ${to}`);
    }

  }

  else if (c.encoder !== "auto" || c.algorithm !== "auto")
  {
    fail("UNSUPPORTED_OPTION", `Content codec selection is unavailable for ${to}`);
  }

  if (
    c.quality !== undefined &&
    (!["jpeg", "webp", "avif"].includes(to) ||
      !Number.isInteger(c.quality) ||
      c.quality < 1 ||
      c.quality > 100)
  )
  {
    fail("UNSUPPORTED_OPTION", "quality is valid only for JPEG/WebP/AVIF (1..100)");
  }

  if (
    c.effort !== undefined &&
    (!["webp", "avif"].includes(to) ||
      !Number.isInteger(c.effort) ||
      c.effort < 0 ||
      c.effort > (to === "webp" ? 6 : 9))
  )
  {
    fail("UNSUPPORTED_OPTION", "Invalid effort");
  }

  if (
    c.level !== undefined &&
    (to !== "png" || !Number.isInteger(c.level) || c.level < 0 || c.level > 9)
  )
  {
    fail("UNSUPPORTED_OPTION", "Content level is supported only for PNG (0..9)");
  }

  if (c.formatOptions !== undefined)
  {
    fail(
      "UNSUPPORTED_OPTION",
      "Advanced codec-specific formatOptions are not implemented",
    );
  }

  if (!Number.isFinite(o.pdf.dpi) || o.pdf.dpi < 36 || o.pdf.dpi > 600)
  {
    fail("UNSUPPORTED_OPTION", "PDF DPI must be 36..600");
  }

  validateKeys(
    o.pdf,
    new Set(["dpi", "pages", "pageSize", "template", "extract", "password"]),
    "pdf",
  );

  if (o.pdf.template !== "key-value" || o.pdf.pageSize !== "A4")
  {
    fail("UNSUPPORTED_OPTION", "Only the bundled key-value A4 report is available");
  }

  if (o.pdf.extract && o.pdf.extract.some((x) => !["text", "metadata"].includes(x)))
  {
    fail("UNSUPPORTED_OPTION", "Unsupported PDF extraction field");
  }

  return { options: o, encoder, warnings };

}

module.exports = { defaults, concurrency, merge, mergeConfigured, resolve };
