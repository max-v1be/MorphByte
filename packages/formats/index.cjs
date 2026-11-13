"use strict";
const sharp = require("sharp");
const imageFormats = ["jpeg", "png", "webp", "avif", "gif", "tiff", "heic", "svg"];
const definitions = [
  ["jpeg", ["jpg", "jpeg"], "image/jpeg"],
  ["png", ["png"], "image/png"],
  ["webp", ["webp"], "image/webp"],
  ["avif", ["avif"], "image/avif"],
  ["heic", ["heic", "heif"], "image/heic"],
  ["gif", ["gif"], "image/gif"],
  ["tiff", ["tif", "tiff"], "image/tiff"],
  ["svg", ["svg"], "image/svg+xml"],
  ["pdf", ["pdf"], "application/pdf"],
  ["json", ["json"], "application/json"],
  ["txt", ["txt", "base64"], "text/plain"],
  ["yaml", ["yaml", "yml"], "application/yaml"],
  ["xml", ["xml"], "application/xml"],
  ["toml", ["toml"], "application/toml"],
  ["csv", ["csv"], "text/csv"],
  ["tsv", ["tsv"], "text/tab-separated-values"],
];
const formats = new Map(
  definitions.map(([id, extensions, mime]) => [
    id,
    {
      id,
      extensions,
      mimeTypes: [mime],
      category: imageFormats.includes(id) ? "image" : id === "pdf" ? "document" : "data",
    },

  ]),
);
const aliases = {
  jpg: "jpeg",
  heif: "heic",
  tif: "tiff",
  yml: "yaml",
  base64: "txt",
};

const normalize = (x) => aliases[String(x).toLowerCase()] || String(x).toLowerCase();


function imageAvailable(format, direction = "output")
{
  const id = ["avif", "heic"].includes(format) ? "heif" : format;

  if (format === "heic")
  {
    return !!sharp.format.heif?.[direction]?.fileSuffix?.some((x) =>
      [".heic", ".heif"].includes(x),
    );
  }

  return !!sharp.format[id]?.[direction]?.buffer;
}

const codecs = {
  jpeg: { algorithm: "jpeg", encoder: "libjpeg-turbo", quality: 82 },

  png: { algorithm: "deflate", encoder: "zlib", level: 6 },

  webp: { algorithm: "vp8", encoder: "libwebp", quality: 78, effort: 4 },

  avif: { algorithm: "av1", encoder: "aom", quality: 50, effort: 4 },

  gif: { algorithm: "lzw", encoder: "cgif" },

  tiff: { algorithm: "lzw", encoder: "libtiff" },

  pdf: { algorithm: "deflate", encoder: "pdf-lib" },

};


function getCapabilities(id)
{
  id = normalize(id);
  const f = formats.get(id);

  if (!f)
  {
    return undefined;
  }

  return {
    ...f,
    decode: f.category !== "image" || imageAvailable(id, "input"),
    encode: f.category !== "image" || imageAvailable(id),
    backend:
      f.category === "image"
        ? "sharp/libvips"
        : id === "pdf"
          ? "PDFium WASM / pdf-lib"
          : "worker parsers",
    streaming: false,
    animation: false,
    metadata: "safe ICC where supported",
    ...(f.capabilities || {}),

  };

}


function getEncoders({ format, algorithm } = {})

{
  const id = normalize(format),
    c = codecs[id];

  if (!c || !getCapabilities(id)?.encode)
  {
    return [];
  }

  const alternatives = id === "webp" ? [c, { ...c, algorithm: "vp8l" }] : [c];

  return alternatives
    .filter((c) => !algorithm || algorithm === "auto" || c.algorithm === algorithm)
    .map((c) => ({
      ...c,
      id: c.encoder,
      installed: true,
      version:
        sharp.versions[c.encoder.replace("lib", "")] ||
        sharp.versions[id] ||
        (id === "pdf" ? "1.17.1" : id === "png" ? sharp.versions["zlib-ng"] : undefined),
      lossless: ["png", "tiff", "pdf"].includes(id) || c.algorithm === "vp8l",
      qualityRange: ["jpeg", "webp", "avif"].includes(id) ? [1, 100] : undefined,
    }));

}

const adapters = new Map();


function registerFormat(f)
{
  if (
    !f ||
    !/^[a-z][a-z0-9-]*$/.test(f.id) ||
    formats.has(f.id) ||
    !Array.isArray(f.extensions) ||
    !f.extensions.length ||
    f.extensions.some((e) => !/^\w[\w-]*$/.test(e)) ||
    !Array.isArray(f.mimeTypes) ||
    !f.mimeTypes.every((m) => /^[\w.+-]+\/[\w.+-]+$/.test(m))
  )
  {
    throw new TypeError("MorphByte: invalid or duplicate format");
  }

  if (
    f.extensions.some((e) => [...formats.values()].some((x) => x.extensions.includes(e)))
  )
  {
    throw new TypeError("MorphByte: duplicate extension");
  }

  formats.set(f.id, {
    ...f,
    extensions: [...f.extensions],
    mimeTypes: [...f.mimeTypes],
    category: f.category || "data",
    custom: true,
  });

}


function registerConverter(c)
{
  if (
    !c ||
    !formats.has(c.from) ||
    !formats.has(c.to) ||
    typeof c.convert !== "function" ||
    (c.cost !== undefined && (!Number.isFinite(c.cost) || c.cost < 0))
  )
  {
    throw new TypeError("MorphByte: invalid converter");
  }

  const id = c.id || `${c.from}:${c.to}`;

  if (adapters.has(id))
  {
    throw new TypeError("MorphByte: duplicate converter");
  }

  adapters.set(id, { ...c, id });

  return id;
}


function plan(from, to)
{
  const queue = [{ format: from, path: [], cost: 0 }],

    best = new Map();

  while (queue.length)
  {
    queue.sort((a, b) => a.cost - b.cost);
    const n = queue.shift();

    if (n.format === to)
    {
      return n.path;
    }

    if (best.has(n.format) && best.get(n.format) <= n.cost)
    {
      continue;
    }

    best.set(n.format, n.cost);
    for (const a of adapters.values())
    {
      if (a.from === n.format)
      {
        queue.push({
          format: a.to,
          path: [...n.path, a],
          cost: n.cost + (a.cost ?? 1),
        });

      }

    }

  }

  return null;
}

const dataFormats = ["json", "yaml", "xml", "toml", "csv", "tsv"];


function builtinRoute(from, to)
{
  if (!formats.has(from) || !formats.has(to))
  {
    return false;
  }

  if (from === to)
  {
    return true;
  }

  if (to === "json" || to === "txt")
  {
    return formats.has(from);
  }

  if (from === "json" || from === "txt")
  {
    return formats.has(to);
  }

  if (dataFormats.includes(from) && dataFormats.includes(to))
  {
    return true;
  }

  if (from === "pdf" && imageFormats.includes(to))
  {
    return imageAvailable(to);
  }

  if (imageFormats.includes(from) && to === "pdf")
  {
    return imageAvailable(from, "input");
  }

  return (
    imageFormats.includes(from) &&
    imageFormats.includes(to) &&
    imageAvailable(from, "input") &&
    imageAvailable(to)
  );
}

module.exports = {
  formats,
  adapters,
  plan,
  normalize,
  imageFormats,
  dataFormats,
  codecs,
  getCapabilities,
  getEncoders,
  registerFormat,
  registerConverter,
  builtinRoute,
};
