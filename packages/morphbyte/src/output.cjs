"use strict";
const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const registry = require("./formats/index.cjs");
const { pathFormat } = require("./detection.cjs");
const { fail, checkSignal, normalizedError } = require("./errors.cjs");


async function target(output, o)
{
  if (typeof output === "string")
  {
    const p = path.resolve(output);
    let directory = /[\\/]$/.test(output);

    try
    {
      directory ||= (await fs.stat(p)).isDirectory();
    }

    catch (e)
    {
      if (e.code !== "ENOENT")
      {
        throw normalizedError(e);
      }

    }

    const inferred = pathFormat(output);
    const format = registry.normalize(
      o.to || (directory ? "png" : inferred.format || ""),
    );

    if (!registry.formats.has(format))
    {
      fail(
        "UNKNOWN_FORMAT",
        "Output requires a recognized extension or an explicit format",
        { formats: [...registry.formats.keys()] },

      );
    }

    return { path: p, directory, format, wrapper: inferred.wrapper };

  }

  if (output && typeof output === "object")
  {
    if (output.directory)
    {
      const result = await target(String(output.directory) + path.sep, {
        ...o,
        to: output.format || o.to,
      });

      return result;
    }

    if (output.format)
    {
      const format = registry.normalize(output.format);

      if (!registry.formats.has(format))
      {
        fail("UNKNOWN_FORMAT", `Unknown output format ${format}`);
      }

      return { format, directory: false, wrapper: "none" };

    }

  }

  fail("INVALID_INPUT", "Output must be a path or a format/directory target");
}


function resolveWrapper(dest, o)
{
  const container = o.compression.container;

  if (dest.wrapper !== "none")
  {
    if (container.algorithm !== "none" && container.algorithm !== dest.wrapper)
    {
      fail(
        "UNSUPPORTED_OPTION",
        "Output suffix conflicts with selected compression wrapper",
      );
    }

    container.algorithm = dest.wrapper;
  }

  else if (dest.path && container.algorithm !== "none")
  {
    fail(
      "UNSUPPORTED_OPTION",
      "Compressed file output needs a compound wrapper extension",
    );
  }

}


async function noSymlinks(p)
{
  let current = path.resolve(p);

  for (;;)
  {
    try
    {
      const s = await fs.lstat(current);

      if (s.isSymbolicLink())
      {
        fail("INVALID_INPUT", `Output path contains a symlink: ${current}`);
      }

    }

    catch (e)
    {
      if (e.name === "MorphByteError")
      {
        throw e;
      }

      if (e.code !== "ENOENT")
      {
        throw e;
      }

    }

    const parent = path.dirname(current);

    if (parent === current)
    {
      break;
    }

    current = parent;
  }

}


async function checkAlias(input, p)
{
  if (Array.isArray(input))
  {
    for (const item of input)
    {
      await checkAlias(item, p);
    }

    return;
  }

  if (typeof input !== "string")
  {
    return;
  }

  const canonical = (value) =>
    process.platform === "win32"
      ? path.resolve(value).toLowerCase()
      : path.resolve(value);

  if (canonical(input) === canonical(p))
  {
    fail("INVALID_INPUT", "Input and output paths alias");
  }

  try
  {
    const [a, b] = await Promise.all([fs.stat(input), fs.stat(p)]);

    if (a.dev === b.dev && a.ino === b.ino)
    {
      fail("INVALID_INPUT", "Input and output refer to the same file");
    }

  }

  catch (e)
  {
    if (e.name === "MorphByteError")
    {
      throw e;
    }

    if (e.code !== "ENOENT")
    {
      throw e;
    }

  }

}


async function commit(outputs, dest, input, o)
{
  if (!dest.path)
  {
    return outputs.map((item) => ({
      ...item,
      bytes: new Uint8Array(item.bytes),
      size: item.bytes.length,
    }));

  }

  if (dest.directory)
  {
    await noSymlinks(dest.path);
    await fs.mkdir(dest.path, { recursive: true });

  }

  const entries = outputs.map((item) => ({
    ...item,
    path: dest.directory ? path.join(dest.path, item.name) : dest.path,
  }));

  for (const item of entries)
  {
    await noSymlinks(item.path);
    await checkAlias(input, item.path);

    if (!o.overwrite)
    {
      try
      {
        await fs.lstat(item.path);
        fail("IO_ERROR", `Output already exists: ${item.path}`);
      }

      catch (e)
      {
        if (e.code !== "ENOENT")
        {
          throw e;
        }

      }

    }

  }

  const staged = [];

  try
  {
    for (const item of entries)
    {
      checkSignal(o.signal);
      await fs.mkdir(path.dirname(item.path), { recursive: true });

      const tmp = path.join(path.dirname(item.path), `.morphbyte-${randomUUID()}.tmp`);

      staged.push({ ...item, tmp });

      const f = await fs.open(tmp, "wx", 0o600);

      try
      {
        await f.writeFile(item.bytes);
        await f.sync();
      }

      finally
      {
        await f.close();
      }

    }

    // Per-file atomic commit. Multi-file output is not a filesystem transaction.
    for (const item of staged)
    {
      checkSignal(o.signal);
      await noSymlinks(item.path);
      await checkAlias(input, item.path);

      if (o.overwrite)
      {
        await fs.rename(item.tmp, item.path);
      }

      else
      {
        await fs.link(item.tmp, item.path); // Fails if another writer created the destination.
        await fs.unlink(item.tmp);
      }

    }

  }

  catch (e)
  {
    throw normalizedError(e);
  }

  finally
  {
    await Promise.allSettled(staged.map((item) => fs.unlink(item.tmp)));
  }

  return entries.map(({ bytes, ...item }) => ({ ...item, size: bytes.length }));

}

module.exports = { target, resolveWrapper, checkAlias, commit };
