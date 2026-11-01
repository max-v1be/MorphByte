"use strict";
const sharp = require("sharp");
const { fail } = require("../errors.cjs");
const { readBounded } = require("../detection.cjs");

sharp.concurrency(1);
sharp.cache({ memory: 32, files: 0, items: 50 });

const integer = (n, label) =>
{
  if (!Number.isSafeInteger(n) || n < 1)
  {
    fail("UNSUPPORTED_OPTION", `${label} must be a positive integer`);
  }

  return n;
};


function image(b, o)
{
  return sharp(b, {
    limitInputPixels: o.maxPixels,
    failOn: "warning",
    animated: false, // Frame truncation is reported by transform().
  });

}


function safeSvg(b)
{
  const s = b.toString("utf8");

  if (
    /<!DOCTYPE|<!ENTITY|<script|<foreignObject|\bon\w+\s*=|\b(?:href|src)\s*=\s*["'](?!#)|url\s*\(\s*[^#]/i.test(
      s,
    )
  )
  {
    fail("INVALID_INPUT", "SVG scripts, entities and external resources are forbidden");
  }

}


async function transform(b, to, o, warnings)
{
  let meta = await image(b, o).metadata();

  if (meta.width * meta.height > o.maxPixels)
  {
    fail("LIMIT_EXCEEDED", "Image pixel limit exceeded");
  }

  if ((meta.pages || 1) > o.maxFrames)
  {
    fail("LIMIT_EXCEEDED", "Image frame limit exceeded");
  }

  if ((meta.pages || 1) > 1)
  {
    warnings.push({
      code: "MULTIPAGE_TRUNCATED",
      message:
        "Only the first image frame is encoded; animation preservation is not implemented",
    });

  }

  if (meta.hasAlpha && ["jpeg"].includes(to))
  {
    warnings.push({
      code: "ALPHA_FLATTENED",
      message: "Transparency flattened on white",
    });

  }

  // Materialize each stage so operation order is exact, including repeated resizes.
  let initial = image(b, o).autoOrient();

  if (o.metadata === "safe")
  {
    initial = initial.keepIccProfile();
  }

  let current = o.operations.length ? await initial.png().toBuffer() : null;

  for (const op of o.operations)
  {
    let p = image(current, o);
    const m = await p.metadata();

    if (!op || typeof op.type !== "string")
    {
      fail("UNSUPPORTED_OPTION", "Invalid image operation");
    }

    const keys = {
      resize: [
        "width",
        "height",
        "fit",
        "background",
        "withoutEnlargement",
        "withoutReduction",
        "kernel",
        "position",
      ],
      crop: ["x", "y", "width", "height"],
      overlay: ["source", "x", "y", "gravity", "opacity", "blend"],
      extend: ["top", "right", "bottom", "left", "background"],
      rotate: ["angle", "background"],
      flip: ["axis"],
      flatten: ["background"],
      grayscale: [],
      blur: ["sigma"],
      sharpen: ["sigma"],
      modulate: ["brightness", "saturation", "hue"],
      gamma: ["value"],
      threshold: ["value"],
      trim: ["threshold"],
      normalize: [],
    }[op.type];

    if (!keys)
    {
      fail("UNSUPPORTED_OPTION", `Unsupported operation: ${op.type}`);
    }

    for (const k of Object.keys(op))
    {
      if (k !== "type" && !keys.includes(k))
      {
        fail("UNSUPPORTED_OPTION", `Unsupported ${op.type}.${k}`);
      }

    }

    switch (op.type)
    {
      case "resize":
      {
        if (op.width === undefined && op.height === undefined)
        {
          fail("UNSUPPORTED_OPTION", "Resize requires width or height");
        }

        const w = op.width === undefined ? undefined : integer(op.width, "width"),
          h = op.height === undefined ? undefined : integer(op.height, "height");
        const scale =
          op.fit === "fill"
            ? null
            : op.fit === "outside" || op.fit === "cover"
              ? Math.max((w || 0) / m.width, (h || 0) / m.height)
              : Math.min((w || Infinity) / m.width, (h || Infinity) / m.height);
        const pixels =
          scale === null
            ? w * h
            : Math.max(
                (w || 1) * (h || 1),
                Math.ceil(m.width * scale) * Math.ceil(m.height * scale),
              );

        if (!Number.isFinite(pixels) || pixels > o.maxPixels)
        {
          fail("LIMIT_EXCEEDED", "Resize pixel limit exceeded");
        }

        if (
          op.fit &&
          !["cover", "contain", "fill", "inside", "outside"].includes(op.fit)
        )
        {
          fail("UNSUPPORTED_OPTION", "Invalid resize fit");
        }

        p = p.resize(w, h, {
          fit: op.fit || "inside",
          background: op.background || "#ffffff00",
          withoutEnlargement: op.withoutEnlargement,
          withoutReduction: op.withoutReduction,
          kernel: op.kernel || "lanczos3",
          position: op.position || "centre",
        });

        break;
      }

      case "crop":
      {
        const { x, y } = op;

        if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y) || x < 0 || y < 0)
        {
          fail("UNSUPPORTED_OPTION", "Crop x/y must be nonnegative integers");
        }

        integer(op.width, "crop width");
        integer(op.height, "crop height");

        if (x + op.width > m.width || y + op.height > m.height)
        {
          fail("INVALID_INPUT", "Crop exceeds image bounds");
        }

        p = p.extract({ left: x, top: y, width: op.width, height: op.height });

        break;
      }

      case "overlay":
      {
        let over =
          typeof op.source === "string"
            ? await readBounded(op.source, o.maxInputBytes)
            : Buffer.from(op.source || []);

        if (over.length > o.maxInputBytes)
        {
          fail("LIMIT_EXCEEDED", "Overlay byte limit exceeded");
        }

        if (/<svg/i.test(over.toString("utf8", 0, 500)))
        {
          safeSvg(over);
        }

        let layer = image(over, o).ensureAlpha();

        if (op.opacity !== undefined)
        {
          if (!Number.isFinite(op.opacity) || op.opacity < 0 || op.opacity > 1)
          {
            fail("UNSUPPORTED_OPTION", "Opacity must be 0..1");
          }

          const { data, info } = await layer.raw().toBuffer({ resolveWithObject: true });

          for (let i = 3; i < data.length; i += 4)
          {
            data[i] = Math.round(data[i] * op.opacity);
          }

          layer = sharp(data, { raw: info });

        }

        const data = await layer.png().toBuffer();

        p = p.composite([
          {
            input: data,
            gravity: op.gravity || "southeast",
            ...(op.x === undefined ? {} : { left: op.x }),

            ...(op.y === undefined ? {} : { top: op.y }),

            blend: op.blend || "over",
          },

        ]);
        break;
      }

      case "extend":
      {
        const q = {};

        for (const k of ["top", "right", "bottom", "left"])
        {
          q[k] = op[k] ?? 0;

          if (!Number.isSafeInteger(q[k]) || q[k] < 0)
          {
            fail("UNSUPPORTED_OPTION", "Invalid padding");
          }

        }

        if ((m.width + q.left + q.right) * (m.height + q.top + q.bottom) > o.maxPixels)
        {
          fail("LIMIT_EXCEEDED", "Extended pixel limit exceeded");
        }

        p = p.extend({ ...q, background: op.background || "#ffffff00" });

        break;
      }

      case "rotate":
        if (!Number.isFinite(op.angle))
        {
          fail("UNSUPPORTED_OPTION", "Invalid rotation");
        }

        if ((m.width + m.height) ** 2 > o.maxPixels)
        {
          fail("LIMIT_EXCEEDED", "Rotation pixel bound exceeded");
        }

        p = p.rotate(op.angle, { background: op.background || "#ffffff00" });

        break;
      case "flip":
        if (!["horizontal", "vertical"].includes(op.axis))
        {
          fail("UNSUPPORTED_OPTION", "Invalid flip axis");
        }

        p = op.axis === "horizontal" ? p.flop() : p.flip();
        break;
      case "flatten":
        p = p.flatten({ background: op.background || "#ffffff" });

        break;
      case "grayscale":
        p = p.grayscale();
        break;
      case "blur":
        p = p.blur(op.sigma ?? 1);
        break;
      case "sharpen":
        p = p.sharpen(op.sigma ?? 1);
        break;
      case "modulate":
      {
        const { type, ...args } = op;

        p = p.modulate(args);
        break;
      }

      case "gamma":
        p = p.gamma(op.value ?? 2.2);
        break;
      case "threshold":
        p = p.threshold(op.value ?? 128);
        break;
      case "trim":
        p = p.trim({ threshold: op.threshold ?? 10 });

        break;
      case "normalize":
        p = p.normalize();
        break;
    }

    if (o.metadata === "safe")
    {
      p = p.keepIccProfile();
    }

    current = await p.png().toBuffer();

    if (current.length > o.maxOutputBytes)
    {
      fail("LIMIT_EXCEEDED", "Intermediate byte limit exceeded");
    }

  }

  let p = current ? image(current, o) : initial;

  if (o.metadata === "safe" && meta.icc)
  {
    p = p.keepIccProfile();
  }

  if (o.metadata === "safe" && (meta.exif || meta.xmp || meta.iptc))
  {
    warnings.push({
      code: "METADATA_STRIPPED",
      message: "EXIF/XMP/IPTC stripped; safe ICC preserved where supported",
    });

  }

  const c = o.compression;

  if (to === "jpeg")
  {
    p = p
      .flatten({ background: "#ffffff" })

      .jpeg({ quality: c.quality, mozjpeg: false, chromaSubsampling: "4:2:0" });

  }

  else if (to === "png")
  {
    p = p.png({ compressionLevel: c.level ?? 6 });

  }

  else if (to === "webp")
  {
    p = p.webp({
      quality: c.quality,
      effort: c.effort,
      lossless: c.algorithm === "vp8l",
    });

  }

  else if (to === "avif")
  {
    p = p.avif({ quality: c.quality, effort: c.effort });

  }

  else if (to === "gif")
  {
    p = p.gif();
  }

  else if (to === "tiff")
  {
    p = p.tiff({ compression: "lzw" });

  }

  else
  {
    fail("MISSING_BACKEND", `No verified image encoder for ${to}`);
  }

  return p.toBuffer();
}

module.exports = { image, transform, safeSvg };
