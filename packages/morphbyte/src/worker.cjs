"use strict";
const { parentPort } = require("node:worker_threads");
const sharp = require("sharp");
const { readInput, signature, wrap } = require("./detection.cjs");
const { resolve } = require("./options.cjs");
const { imageFormats, dataFormats, getCapabilities } = require("./formats/index.cjs");
const data = require("./data/index.cjs");
const pdf = require("./pdf/index.cjs");
const image = require("./image/index.cjs");
const { fail } = require("./errors.cjs");
let native;

try
{
  native = require("./morphbyte.node");
}

catch
{
}

const warning = (code, message) => ({ code, message });


async function execute(job)
{
  const { options: o, encoder, warnings } = resolve(job.to, job.options);

  if (Array.isArray(job.input))
  {
    if (job.to !== "pdf" || job.directory || !job.input.length)
    {
      fail("UNSUPPORTED_CONVERSION", "Input arrays require a single PDF output");
    }

    if (job.input.length > o.maxPages)
    {
      fail("LIMIT_EXCEEDED", "Input document count limit exceeded");
    }

    const sources = [];
    let inputBytes = 0;

    for (const input of job.input)
    {
      const s = await readInput(input, o);

      sources.push(s);
      inputBytes += s.inputBytes;

      if (inputBytes > o.maxInputBytes)
      {
        fail("LIMIT_EXCEEDED", "Aggregate input byte limit exceeded");
      }

    }

    let outputs, backend;

    if (sources.every((s) => s.format === "pdf"))
    {
      if (o.operations.length)
      {
        fail("UNSUPPORTED_OPTION", "Image operations cannot edit PDF vector pages");
      }

      outputs = await pdf.rewritePdf(
        sources.map((s) => s.bytes),
        o,
        false,
      );
      backend = "pdf-lib";
    }

    else if (sources.every((s) => imageFormats.includes(s.format)))
    {
      for (const s of sources)
      {
        if (s.format === "svg")
        {
          image.safeSvg(s.bytes);
        }

      }

      outputs = [
        {
          bytes: await pdf.imagesPdf(
            sources.map((s) => s.bytes),
            o,
            warnings,
          ),
        },

      ];
      backend = "sharp/pdf-lib";
    }

    else
    {
      fail(
        "UNSUPPORTED_CONVERSION",
        "Use an array of images or an array of PDFs; mixed families are unsupported",
      );
    }

    const outputBytes = outputs.reduce((n, x) => n + x.bytes.length, 0);

    if (outputBytes > o.maxOutputBytes)
    {
      fail("LIMIT_EXCEEDED", "Output byte limit exceeded");
    }

    return {
      outputs,
      sourceFormat: sources[0].format,
      targetFormat: "pdf",
      conversionPath: [sources[0].format, "pdf"],
      fidelity: "structured",
      inputBytes,
      outputBytes,
      warnings,
      effectiveOptions: o,
      backend,
      selectedAlgorithm: "deflate",
      selectedEncoder: "pdf-lib",
      selectedEncoderVersion: "1.17.1",
    };

  }

  const source = await readInput(job.input, o),
    b = source.bytes,
    from = source.format,
    to = job.to;

  if (from === "svg")
  {
    image.safeSvg(b);
  }

  if (job.action === "detect")
  {
    return { ...source, bytes: undefined, filename: undefined };

  }

  if (job.action === "probe")
  {
    let meta = {};

    if (imageFormats.includes(from))
    {
      meta = await image.image(b, o).metadata();
    }

    if (from === "pdf")
    {
      meta = await pdf.readPdf(b, o, (doc) => ({ pages: doc.getPageCount() }));

    }

    return {
      format: from,
      mimeType: require("./formats/index.cjs").formats.get(from)?.mimeTypes[0],
      size: source.inputBytes,
      confidence: source.confidence,
      ...meta,
    };

  }

  const modifying =
    job.modify ||
    o.operations.length ||
    o.representation !== "auto" ||
    o.optimize === true;

  if (imageFormats.includes(from))
  {
    let meta;

    try
    {
      meta = await image.image(b, o).metadata();
    }

    catch (e)
    {
      fail(
        /pixel limit/i.test(e.message)
          ? "LIMIT_EXCEEDED"
          : from === "heic"
            ? "MISSING_BACKEND"
            : "CORRUPT_FILE",
        e.message,
      );
    }

    if (meta.width * meta.height > o.maxPixels || (meta.pages || 1) > o.maxFrames)
    {
      fail("LIMIT_EXCEEDED", "Image dimension/frame limit exceeded");
    }

  }

  if (
    from === "pdf" &&
    ((to === from && !modifying) || o.representation === "binary-envelope")
  )
  {
    await pdf.readPdf(b, o, () => true);
  }

  if (
    o.operations.length &&
    !(
      (imageFormats.includes(from) && (imageFormats.includes(to) || to === "pdf")) ||
      (from === "pdf" && imageFormats.includes(to))
    )
  )
  {
    fail("UNSUPPORTED_OPTION", "Image operations require an image-producing route");
  }

  if (
    o.representation === "structured" &&
    !(
      (dataFormats.includes(from) && dataFormats.includes(to)) ||
      (from === "pdf" && ["json", "txt"].includes(to))
    )
  )
  {
    fail("UNSUPPORTED_OPTION", "Structured representation unavailable on this route");
  }

  if (o.representation === "base64" && !(to === "txt" || from === "txt"))
  {
    fail("UNSUPPORTED_OPTION", "Base64 representation requires a TXT endpoint");
  }

  let outputs,
    fidelity = "lossless",
    backend = "worker",
    route = [from, to];
  const progress = (e) => parentPort.postMessage({ progress: e });

  progress({ stage: "decode", completed: 1, total: 1, unit: "files" });

  if (from === to && !modifying)
  {
    outputs = [{ bytes: b }];

    route = [from, "copy", to];
    backend = "copy";
  }

  else if (from === "pdf" && to === "pdf")
  {
    outputs = await pdf.rewritePdf([b], o, job.directory);
    backend = "pdf-lib";
    fidelity = "structured";
    warnings.push(
      warning(
        "PDF_REWRITTEN",
        "Pages copied through pdf-lib; document-level metadata, signatures and outlines may change",
      ),
    );
  }

  else if (o.representation === "base64" && to === "txt")
  {
    let encoded = native ? await native.encodeBase64(b) : b.toString("base64");

    if (o.base64Variant === "url")
    {
      encoded = encoded.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    }

    if (o.lineWidth)
    {
      if (!Number.isInteger(o.lineWidth) || o.lineWidth < 4 || o.lineWidth > 10000)
      {
        fail("UNSUPPORTED_OPTION", "Invalid Base64 line width");
      }

      encoded = encoded.match(new RegExp(`.{1,${o.lineWidth}}`, "g")).join("\n");
    }

    if (o.dataUri)
    {
      encoded = `data:${require("./formats/index.cjs").formats.get(from)?.mimeTypes[0] || "application/octet-stream"};base64,${encoded}`;
    }

    outputs = [{ bytes: Buffer.from(encoded) }];

    backend = native ? "morphbyte-native" : "worker/base64";
  }

  else if (
    to === "json" &&
    (o.representation === "binary-envelope" ||
      (!dataFormats.includes(from) && from !== "pdf" && from !== "txt"))
  )
  {
    outputs = [{ bytes: data.envelope(b, from) }];

    backend = "worker/envelope";
  }

  else if (from === "json" && !dataFormats.includes(to))
  {
    const j = data.parse(b, "json");

    if (
      j?.$schema === "morphbyte/binary-envelope" ||
      o.representation === "binary-envelope"
    )
    {
      outputs = [{ bytes: data.decodeEnvelope(j, to, o) }];

      backend = "worker/envelope";
    }

    else if (to === "pdf")
    {
      outputs = [{ bytes: await pdf.reportPdf(j, o) }];

      backend = "pdf-lib/fontkit";
      fidelity = "structured";
    }

    else if (to === "txt")
    {
      outputs = [{ bytes: Buffer.from(JSON.stringify(j, null, 2) + "\n") }];

      fidelity = "structured";
    }

    else
    {
      fail(
        "UNSUPPORTED_CONVERSION",
        `JSON requires a valid binary envelope to restore ${to}`,
      );
    }

  }

  else if (from === "txt" && !dataFormats.includes(to) && to !== "txt")
  {
    const decoded = data.strictBase64(b.toString("utf8"), o.base64Variant);

    if (signature(decoded) !== to)
    {
      fail("INVALID_BASE64", "Decoded signature does not match requested target");
    }

    outputs = [{ bytes: decoded }];

    backend = "worker/base64";
  }

  else if (from === "pdf" && to === "json")
  {
    outputs = [{ bytes: data.serialize(await pdf.extract(b, o), "json") }];

    backend = "PDFium WASM/pdf-lib";
    fidelity = "extraction";
    warnings.push(
      warning(
        "STRUCTURED_EXTRACTION",
        "Text/metadata extraction does not preserve PDF layout or original bytes",
      ),
    );
  }

  else if (from === "pdf" && to === "txt")
  {
    const doc = await pdf.extract(b, o);

    outputs = [{ bytes: Buffer.from(doc.pages.map((p) => p.text).join("\n\f\n")) }];

    backend = "PDFium WASM";
    fidelity = "extraction";
  }

  else if (from === "pdf" && imageFormats.includes(to))
  {
    outputs = await pdf.rasterize(b, to, o, job.directory, warnings, progress);
    backend = "PDFium WASM/sharp";
    fidelity = "lossy";
  }

  else if (imageFormats.includes(from) && to === "pdf")
  {
    outputs = [{ bytes: await pdf.imagesPdf([b], o, warnings) }];

    backend = "sharp/pdf-lib";
    fidelity = "lossless";
  }

  else if (imageFormats.includes(from) && imageFormats.includes(to))
  {
    if (!getCapabilities(to)?.encode)
    {
      fail("MISSING_BACKEND", `No installed ${to} encoder`);
    }

    outputs = [{ bytes: await image.transform(b, to, o, warnings) }];

    backend = "sharp/libvips";
    fidelity =
      ["jpeg", "avif", "gif"].includes(to) ||
      (to === "webp" && o.compression.algorithm !== "vp8l")
        ? "lossy"
        : "lossless";
  }

  else if (dataFormats.includes(from) && dataFormats.includes(to))
  {
    outputs = [{ bytes: data.serialize(data.parse(b, from), to) }];

    backend = "worker/parsers";
    fidelity = "structured";

    if (
      ["xml", "csv", "tsv", "toml"].includes(from) ||
      ["xml", "csv", "tsv", "toml"].includes(to)
    )
    {
      warnings.push(
        warning(
          "STRUCTURAL_LOSS",
          "Text format conversion can change root names, scalar types or table structure",
        ),
      );
    }

  }

  else if (to === "txt")
  {
    const encoded = native ? await native.encodeBase64(b) : b.toString("base64");

    outputs = [{ bytes: Buffer.from(encoded) }];

    backend = native ? "morphbyte-native" : "worker/base64";
  }

  else if (from === "txt" && to === "json")
  {
    outputs = [{ bytes: data.serialize(data.parse(b, "json"), "json") }];

    backend = "worker/json";
    fidelity = "structured";
  }

  else
  {
    fail("UNSUPPORTED_CONVERSION", `No implemented route ${from} -> ${to}`);
  }

  if (o.operations.length && !imageFormats.includes(from) && from !== "pdf")
  {
    fail("UNSUPPORTED_OPTION", "Image operations require an image or PDF input");
  }

  if (o.operations.length && to === "json")
  {
    fail(
      "UNSUPPORTED_OPTION",
      "Image operations are unavailable for JSON envelopes/extraction",
    );
  }

  let total = 0;

  for (const output of outputs)
  {
    output.bytes = await wrap(
      output.bytes,
      o.compression.container.algorithm,
      true,
      o,
      o.compression.container.level,
    );
    total += output.bytes.length;

    if (total > o.maxOutputBytes)
    {
      fail("LIMIT_EXCEEDED", "Output byte limit exceeded");
    }

  }

  if (backend === "copy")
  {
    o.compression.algorithm = "none";
    o.compression.encoder = "copy";
  }

  return {
    outputs,
    sourceFormat: from,
    targetFormat: to,
    conversionPath: route,
    fidelity,
    inputBytes: source.inputBytes,
    outputBytes: total,
    warnings,
    effectiveOptions: { ...o, signal: undefined, onProgress: undefined },

    backend,
    selectedAlgorithm: backend === "copy" ? "none" : encoder?.algorithm,
    selectedEncoder: backend === "copy" ? "copy" : encoder?.encoder,
    selectedEncoderVersion: encoder?.version,
  };

}

parentPort.on("message", async (job) =>
{
  try
  {
    parentPort.postMessage({ result: await execute(job) });

  }

  catch (e)
  {
    parentPort.postMessage({
      error: {
        code: e.code && typeof e.code === "string" ? e.code : "ENCODER_ERROR",
        message: e.message,
        details: e.details,
      },

    });

  }

});
