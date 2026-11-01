"use strict";
const fs = require("node:fs/promises");
const sharp = require("sharp");
const { PDFDocument } = require("pdf-lib");
const fontkit = require("@pdf-lib/fontkit");
const { PDFiumLibrary } = require("@hyzyla/pdfium");
const { fail } = require("../errors.cjs");
const { transform, image } = require("../image/index.cjs");


function selectPages(selection, count, maxPages)
{
  if (count > maxPages)
  {
    fail("LIMIT_EXCEEDED", "PDF page limit exceeded");
  }

  let pages;

  if (selection === "all")
  {
    pages = Array.from({ length: count }, (_, i) => i + 1);
  }

  else if (Array.isArray(selection))
  {
    pages = [...selection];
  }

  else if (
    typeof selection === "string" &&
    /^\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*$/.test(selection)
  )
  {
    pages = [];
    for (const part of selection.split(","))
    {
      const [a, b = a] = part.split("-").map(Number);

      if (b < a || b - a > maxPages)
      {
        fail("INVALID_INPUT", "Invalid PDF page range");
      }

      for (let p = a; p <= b; p++)
      {
        pages.push(p);
      }

    }

  }

  else
  {
    fail(
      "UNSUPPORTED_OPTION",
      "pages must be all, a range string or a one-based page list",
    );
  }

  if (
    !pages.length ||
    pages.length > maxPages ||
    pages.some((p) => !Number.isSafeInteger(p) || p < 1 || p > count)
  )
  {
    fail("INVALID_INPUT", "PDF page selection is out of bounds");
  }

  return pages;
}


async function readPdf(b, o, action)
{
  const lib = await PDFiumLibrary.init();
  let doc;

  try
  {
    doc = await lib.loadDocument(new Uint8Array(b), o.pdf.password);

    if (doc.getPageCount() > o.maxPages)
    {
      fail("LIMIT_EXCEEDED", "PDF page limit exceeded");
    }

    return await action(doc);
  }

  catch (e)
  {
    if (e.name === "MorphByteError")
    {
      throw e;
    }

    fail(
      /password|encrypted|error.*4/i.test(e.message)
        ? "PASSWORD_REQUIRED"
        : "CORRUPT_FILE",
      `PDFium: ${e.message}`,
    );
  }

  finally
  {
    doc?.destroy();
    lib.destroy();
  }

}


async function extract(b, o)
{
  return readPdf(b, o, async (doc) =>
  {
    const pages = selectPages(o.pdf.pages, doc.getPageCount(), o.maxPages).map(
      (number) =>
      {
        const p = doc.getPage(number - 1),
          s = p.getOriginalSize();

        return {
          number,
          width: s.originalWidth,
          height: s.originalHeight,
          ...(!o.pdf.extract || o.pdf.extract.includes("text")
            ? { text: p.getText() }

            : {}),

        };

      },

    );
    let metadata = {};

    try
    {
      const d = await PDFDocument.load(b, { updateMetadata: false });

      metadata = {
        title: d.getTitle(),
        author: d.getAuthor(),
        subject: d.getSubject(),
        creator: d.getCreator(),
        producer: d.getProducer(),
      };

    }

    catch
    {
    }

    return {
      schema: "morphbyte/structured-document",
      version: 1,
      pageCount: doc.getPageCount(),
      metadata: !o.pdf.extract || o.pdf.extract.includes("metadata") ? metadata : {},

      pages,
      provenance: {
        backend: "PDFium WASM",
        ocr: false,
        coordinates: false,
        annotations: false,
      },

    };

  });

}


async function rasterize(b, to, o, directory, warnings, progress)
{
  return readPdf(b, o, async (doc) =>
  {
    let pages = selectPages(o.pdf.pages, doc.getPageCount(), o.maxPages);

    if (!directory && pages.length > 1)
    {
      pages = pages.slice(0, 1);
      warnings.push({
        code: "MULTIPAGE_TRUNCATED",
        message: "Single-file output contains only the first selected PDF page",
      });

    }

    const outputs = [];
    let totalBytes = 0;

    for (const number of pages)
    {
      const p = doc.getPage(number - 1),
        s = p.getOriginalSize(),
        scale = o.pdf.dpi / 72;

      if (
        Math.ceil(s.originalWidth * scale) * Math.ceil(s.originalHeight * scale) >
        o.maxPixels
      )
      {
        fail("LIMIT_EXCEEDED", "PDF raster pixel limit exceeded");
      }

      const rendered = await p.render({
        scale,
        render: async ({ data, width, height }) =>
        {
          const rgba = Buffer.from(data);

          for (let i = 0; i < rgba.length; i += 4)
          {
            const blue = rgba[i];

            rgba[i] = rgba[i + 2];
            rgba[i + 2] = blue;
          }

          return sharp(rgba, {
            raw: { width, height, channels: 4 },

            limitInputPixels: o.maxPixels,
          })

            .png()
            .toBuffer();
        },

      });

      const bytes = await transform(Buffer.from(rendered.data), to, o, warnings);

      totalBytes += bytes.length;

      if (totalBytes > o.maxOutputBytes)
      {
        fail("LIMIT_EXCEEDED", "PDF aggregate output limit exceeded");
      }

      outputs.push({
        bytes,
        page: number,
        name: `page-${String(number).padStart(4, "0")}.${to === "jpeg" ? "jpg" : to}`,
      });

      progress?.({
        stage: "render",
        completed: outputs.length,
        total: pages.length,
        unit: "pages",
      });

    }

    return outputs;
  });

}


async function imagesPdf(images, o, warnings)
{
  if (images.length > o.maxPages)
  {
    fail("LIMIT_EXCEEDED", "PDF page limit exceeded");
  }

  const doc = await PDFDocument.create();

  doc.setProducer("MorphByte / pdf-lib");
  for (const b of images)
  {
    const normalized = await transform(
      b,
      "png",
      { ...o, compression: { algorithm: "deflate", level: 6 } },

      warnings,
    );
    const embedded = await doc.embedPng(normalized);
    const page = doc.addPage([embedded.width, embedded.height]);

    page.drawImage(embedded, {
      x: 0,
      y: 0,
      width: embedded.width,
      height: embedded.height,
    });

  }

  return Buffer.from(await doc.save({ useObjectStreams: true }));

}


async function reportPdf(value, o)
{
  const doc = await PDFDocument.create();

  doc.registerFontkit(fontkit);
  doc.setTitle("MorphByte report");
  doc.setProducer("MorphByte / pdf-lib");
  const files = ["latin", "latin-ext", "cyrillic", "cyrillic-ext", "greek"];
  const fonts = [];

  for (const part of files)
  {
    const bytes = await fs.readFile(
      require.resolve(`@fontsource/noto-sans/files/noto-sans-${part}-400-normal.woff`),
    );
    const font = await doc.embedFont(bytes, { subset: true });

    fonts.push({ font, chars: new Set(font.getCharacterSet()) });

  }

  const pick = (c) =>
  {
    const f = fonts.find((f) => f.chars.has(c.codePointAt(0)));

    if (!f)
    {
      fail(
        "MISSING_BACKEND",
        `Bundled report fonts have no glyph for U+${c.codePointAt(0).toString(16).toUpperCase()}; Latin, Cyrillic and Greek are supported`,
      );
    }

    return f.font;
  };

  let page, y;
  const next = () =>
  {
    if (doc.getPageCount() >= o.maxPages)
    {
      fail("LIMIT_EXCEEDED", "Report page limit exceeded");
    }

    page = doc.addPage([595.28, 841.89]);
    y = 791;
  };

  next();
  const source = JSON.stringify(value, null, 2).replace(/\t/g, "  ");

  for (const line of source.split("\n"))
  {
    let x = 48;

    for (const c of line)
    {
      if (c < " " && c !== "\t")
      {
        continue;
      }

      const font = pick(c),
        width = font.widthOfTextAtSize(c, 10);

      if (x + width > 547)
      {
        x = 48;
        y -= 15;
      }

      if (y < 48)
      {
        next();
        x = 48;
      }

      page.drawText(c, { x, y, size: 10, font });

      x += width;
    }

    y -= 15;
  }

  return Buffer.from(await doc.save({ useObjectStreams: true }));

}


async function rewritePdf(inputs, o, directory)
{
  const output = await PDFDocument.create();
  const outputs = [];
  let number = 0;

  for (const bytes of inputs)
  {
    let source;

    try
    {
      source = await PDFDocument.load(bytes, { updateMetadata: false });

    }

    catch (e)
    {
      fail(
        /encrypted|password/i.test(e.message) ? "PASSWORD_REQUIRED" : "CORRUPT_FILE",
        e.message,
      );
    }

    const pages = selectPages(o.pdf.pages, source.getPageCount(), o.maxPages);

    for (const pageNumber of pages)
    {
      if (++number > o.maxPages)
      {
        fail("LIMIT_EXCEEDED", "Aggregate PDF page limit exceeded");
      }

      const dest = directory ? await PDFDocument.create() : output;
      const [page] = await dest.copyPages(source, [pageNumber - 1]);

      dest.addPage(page);

      if (directory)
      {
        outputs.push({
          bytes: Buffer.from(await dest.save()),
          page: pageNumber,
          name: `page-${String(number).padStart(4, "0")}.pdf`,
        });

      }

    }

  }

  if (!directory)
  {
    outputs.push({ bytes: Buffer.from(await output.save()) });

  }

  return outputs;
}

module.exports = {
  extract,
  rasterize,
  imagesPdf,
  reportPdf,
  readPdf,
  selectPages,
  rewritePdf,
};
