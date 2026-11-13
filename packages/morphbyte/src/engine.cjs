"use strict";
const sharp = require("sharp");
const registry = require("./formats/index.cjs");
const { fail, MorphByteError, checkSignal, normalizedError } = require("./errors.cjs");
const { merge, mergeConfigured, resolve, concurrency } = require("./options.cjs");
const { pathFormat, readBounded } = require("./detection.cjs");
const { runWorker, queueLimit } = require("./worker-pool.cjs");
const { target, resolveWrapper, checkAlias, commit } = require("./output.cjs");
const { version } = require("../package.json");


function publicOptions(o)
{
  const { signal, onProgress, ...plain } = o;

  return plain;
}


async function detect(input)
{
  const o = merge();

  return runWorker(
    { action: "detect", input, to: "json", options: publicOptions(o) },

    undefined,
  );
}


async function probe(input)
{
  const o = merge();

  return runWorker(
    { action: "probe", input, to: "json", options: publicOptions(o) },

    undefined,
  );
}


function getDefaultOptions({ from, to } = {})

{
  return publicOptions(resolve(to || "json").options);
}


async function resolveOptions(input, output, options)
{
  const o = merge(options);
  const dest = await target(output, o);
  const result = resolve(dest.format, options);

  resolveWrapper(dest, result.options);
  const source = await runWorker(
    { action: "detect", input, to: "json", options: publicOptions(o) },

    o.signal,
  );

  return {
    from: source.format,
    to: dest.format,
    ...publicOptions(result.options),
    backend: registry.getCapabilities(dest.format)?.backend,
  };

}


async function convertWith(defaults, input, output, options)
{
  const started = performance.now(),
    initial = merge(defaults, options);

  checkSignal(initial.signal);
  const dest = await target(output, initial),
    resolved = resolve(dest.format, defaults, options),
    o = resolved.options;

  resolveWrapper(dest, o);

  if (dest.path)
  {
    await checkAlias(input, dest.path);
  }

  const hint = registry.normalize(
    o.from || (typeof input === "string" ? pathFormat(input).format : ""),
  );
  const custom = registry.plan(hint, dest.format);
  let result;

  if (custom?.length)
  {
    if (
      o.operations.length ||
      o.representation !== "auto" ||
      o.compression.container.algorithm !== "none"
    )
    {
      fail(
        "UNSUPPORTED_OPTION",
        "Custom adapters must implement their own operations and wrapper policies",
      );
    }

    let bytes =
      typeof input === "string"
        ? await readBounded(input, o.maxInputBytes)
        : Buffer.from(input);

    if (bytes.length > o.maxInputBytes)
    {
      fail("LIMIT_EXCEEDED", "Custom input byte limit exceeded");
    }

    const inputBytes = bytes.length;
    let fidelity = "lossless";
    const warnings = [];
    let deadline;
    const controller = new AbortController(),
      abort = () => controller.abort();

    o.signal?.addEventListener("abort", abort, { once: true });

    if (o.signal?.aborted)
    {
      controller.abort();
    }

    try
    {
      const work = async () =>
      {
        for (const adapter of custom)
        {
          checkSignal(controller.signal);

          if (
            adapter.canConvert &&
            !(await adapter.canConvert({
              from: adapter.from,
              to: adapter.to,
              options: o,
            }))

          )
          {
            fail("UNSUPPORTED_CONVERSION", "Custom adapter rejected input");
          }

          const value = await adapter.convert({
            input: bytes,
            from: adapter.from,
            to: adapter.to,
            options: o,
            signal: controller.signal,
          });

          if (!(value instanceof Uint8Array))
          {
            fail("ENCODER_ERROR", "Custom adapter must return Uint8Array");
          }

          bytes = Buffer.from(value);

          if (bytes.length > o.maxOutputBytes)
          {
            fail("LIMIT_EXCEEDED", "Custom output byte limit exceeded");
          }

          const rank = { lossless: 0, structured: 1, lossy: 2, extraction: 3 };

          const next = adapter.fidelity || "structured";

          if (rank[next] > rank[fidelity])
          {
            fidelity = next;
          }

        }

        return bytes;
      };

      bytes = await Promise.race([
        work(),
        new Promise((_, reject) =>
        {
          deadline = setTimeout(() =>
          {
            reject(new MorphByteError("TIMEOUT", "Custom adapter deadline exceeded"));
            controller.abort();
          }, o.timeoutMs);
          controller.signal.addEventListener(
            "abort",
            () => reject(new MorphByteError("ABORTED", "Custom adapter aborted")),
            { once: true },

          );
        }),

      ]);
    }

    finally
    {
      clearTimeout(deadline);
      o.signal?.removeEventListener("abort", abort);
    }

    result = {
      outputs: [{ bytes }],

      sourceFormat: hint,
      targetFormat: dest.format,
      conversionPath: [hint, ...custom.map((a) => a.to)],
      fidelity,
      inputBytes,
      outputBytes: bytes.length,
      warnings,
      effectiveOptions: publicOptions(o),
      backend: custom.map((a) => a.id).join(" -> "),
    };

  }

  else
  {
    if (registry.formats.get(hint)?.custom || registry.formats.get(dest.format)?.custom)
    {
      fail("UNSUPPORTED_CONVERSION", `No registered converter ${hint} -> ${dest.format}`);
    }

    const requested = mergeConfigured(defaults, options);

    const modify =
      Object.keys(requested.compression || {}).some((k) => k !== "container") ||
      requested.mode !== undefined ||
      o.optimize === true ||
      o.metadata === "strip" ||
      dest.directory ||
      o.pdf.pages !== "all";

    result = await runWorker(
      {
        input,
        to: dest.format,
        directory: dest.directory,
        options: publicOptions(o),
        modify,
      },

      o.signal,
      o.onProgress,
    );
  }

  result.warnings.push(...resolved.warnings);
  checkSignal(o.signal);
  result.outputs = await commit(result.outputs, dest, input, o);
  result.durationMs = performance.now() - started;

  return result;
}

const convert = (input, output, options) =>
  convertWith(undefined, input, output, options);


async function convertBufferWith(convertFn, input, output, options)
{
  if (!(input instanceof Uint8Array))
  {
    fail("INVALID_INPUT", "convertBuffer expects Uint8Array");
  }

  const dest = typeof output === "string" ? { format: output } : output;

  if (
    !dest ||
    typeof dest !== "object" ||
    Array.isArray(dest) ||
    typeof dest.format !== "string" ||
    !dest.format ||
    "directory" in dest ||
    Object.keys(dest).some((key) => key !== "format")
  )
  {
    fail("INVALID_INPUT", "convertBuffer requires a format or a format-only target");
  }

  const result = await convertFn(input, { format: dest.format }, options);

  if (result.outputs.length !== 1 || !result.outputs[0].bytes)
  {
    fail("INVALID_INPUT", "convertBuffer requires a single in-memory output");
  }

  return result.outputs[0].bytes;
}

const convertBuffer = (input, output, options) =>
  convertBufferWith(convert, input, output, options);


async function convertBatch(items, options = {})

{
  for (const k of Object.keys(options))
  {
    if (!["concurrency", "continueOnError", "signal", "onProgress"].includes(k))
    {
      fail("UNSUPPORTED_OPTION", `Unknown batch option ${k}`);
    }

  }

  if (!Array.isArray(items))
  {
    fail("INVALID_INPUT", "Batch items must be an array");
  }

  const count = options.concurrency ?? concurrency;

  if (!Number.isSafeInteger(count) || count < 1 || count > 32)
  {
    fail("UNSUPPORTED_OPTION", "Batch concurrency must be 1..32");
  }

  const results = new Array(items.length);
  let next = 0,
    stopped = false;

  await Promise.all(
    Array.from({ length: Math.min(count, items.length) }, async () =>
    {
      while (!stopped)
      {
        const i = next++;

        if (i >= items.length)
        {
          break;
        }

        const item = items[i];

        try
        {
          checkSignal(options.signal);

          if (!item || !("input" in item) || !("output" in item))
          {
            fail("INVALID_INPUT", "Batch item requires input and output");
          }

          results[i] = {
            status: "fulfilled",
            value: await convert(item.input, item.output, {
              ...item.options,
              signal: options.signal || item.options?.signal,
              onProgress: options.onProgress || item.options?.onProgress,
            }),

          };

        }

        catch (e)
        {
          results[i] = { status: "rejected", error: normalizedError(e) };

          if (!options.continueOnError)
          {
            stopped = true;
          }

        }

      }

    }),

  );
  for (let i = 0; i < results.length; i++)
  {
    results[i] ??= {
      status: "rejected",
      error: new MorphByteError("ABORTED", "Batch stopped before starting this item"),
    };

  }

  return {
    results,
    succeeded: results.filter((r) => r.status === "fulfilled").length,
    failed: results.filter((r) => r.status === "rejected").length,
  };

}


function createConverter({
  defaults = {},

  formatDefaults = {},

  routeDefaults = {},

} = {})

{
  merge(defaults);
  // Resolved codecs belong to one target; save only the caller's overrides.
  const cloneOptions = (options) => ({
    ...structuredClone(publicOptions(options)),
    ...(options.signal ? { signal: options.signal } : {}),

    ...(options.onProgress ? { onProgress: options.onProgress } : {}),

  });

  const saved = cloneOptions(defaults),
    formats = Object.fromEntries(
      Object.entries(formatDefaults).map(([k, v]) => [k, cloneOptions(v)]),
    ),
    routes = Object.fromEntries(
      Object.entries(routeDefaults).map(([k, v]) => [k, cloneOptions(v)]),
    );
  const layers = async (input, output, options) =>
  {
    const initial = merge(saved, options);

    checkSignal(initial.signal);
    const dest = await target(output, initial);
    let from;

    if (Object.keys(routes).length)
    {
      const inspection = merge(saved, formats[dest.format], options);
      const hint = registry.normalize(
        inspection.from || (typeof input === "string" ? pathFormat(input).format : ""),
      );

      if (registry.formats.get(hint)?.custom)
      {
        from = hint;
      }

      else
      {
        const { compression, mode, ...sourceOptions } = publicOptions(inspection);
        const source = await runWorker(
          { action: "detect", input, to: "json", options: sourceOptions },

          inspection.signal,
        );

        from = source.format;
      }

    }

    return mergeConfigured(
      saved,
      formats[dest.format],
      from ? routes[`${from}:${dest.format}`] : undefined,
    );
  };

  const instance = {
    convert: async (input, output, options) =>
      convertWith(await layers(input, output, options), input, output, options),
    convertBuffer: (input, output, options) =>
      convertBufferWith(instance.convert, input, output, options),
    getDefaultOptions: (args = {}) =>
      publicOptions(
        resolve(
          args.to || "json",
          saved,
          formats[args.to],
          routes[`${args.from}:${args.to}`],
        ).options,
      ),
  };

  return instance;
}

Object.assign(exports, {
  convert,
  convertBuffer,
  convertBatch,
  probe,
  detect,
  getDefaultOptions,
  resolveOptions,
  createConverter,
  MorphByteError,
  getFormats: () => [...registry.formats.values()].map((f) => structuredClone(f)),
  getCapabilities: registry.getCapabilities,
  getConversions: (from) =>
    [...registry.formats.keys()].filter(
      (to) =>
        registry.builtinRoute(registry.normalize(from), to) ||
        registry.plan(registry.normalize(from), to),
    ),
  canConvert: (from, to) =>
    registry.builtinRoute(registry.normalize(from), registry.normalize(to)) ||
    !!registry.plan(registry.normalize(from), registry.normalize(to)),
  getEncoders: registry.getEncoders,
  getEncoderOptions: (format) => registry.getEncoders({ format }),

  getCompressionAlgorithms: (format) => [
    ...new Set(registry.getEncoders({ format }).map((e) => e.algorithm)),
  ],
  getCompressionOptions: (format) => ({
    format,
    encoders: registry.getEncoders({ format }),

    defaults: getDefaultOptions({ to: format }).compression,
    wrappers: [
      "none",
      "gzip",
      "brotli",
      ...(typeof require("node:zlib").zstdCompress === "function" ? ["zstd"] : []),
    ],
  }),

  registerFormat: registry.registerFormat,
  registerConverter: registry.registerConverter,
  unregisterConverter: (id) => registry.adapters.delete(id),
  unregisterFormat: (id) =>
  {
    if (!registry.formats.get(id)?.custom)
    {
      return false;
    }

    for (const [key, a] of registry.adapters)
    {
      if (a.from === id || a.to === id)
      {
        registry.adapters.delete(key);
      }

    }

    return registry.formats.delete(id);
  },

  getBuildInfo: () =>
  {
    let native = false;

    try
    {
      native = !!require("./morphbyte.node");
    }

    catch
    {
    }

    return {
      name: "MorphByte",
      version,
      platform: process.platform,
      arch: process.arch,
      runtime: process.versions.bun ? "bun" : "node",
      versions: process.versions,
      codecs: sharp.versions,
      nativeAddon: native,
      pdfBackend: "PDFium WASM",
      workerConcurrency: concurrency,
      queueCapacity: queueLimit,
    };

  },

});
