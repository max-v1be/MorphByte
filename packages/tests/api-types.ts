import {
  convert,
  convertBuffer,
  convertBatch,
  createConverter,
  getDefaultOptions,
  type ConversionOptions,
  type BatchOptions,
} from "morphbyte";
const a: ConversionOptions = {};

const b: BatchOptions = {};

void convert("input.png", "output.webp");
void convert("input.pdf", "output.json", a);
void convertBuffer(new Uint8Array(), "png");
void convertBatch([{ input: "a.png", output: "b.webp" }], b);
void createConverter({ defaults: { compression: {} } });

void getDefaultOptions();
// @ts-expect-error output is required
void convert("input.png");
void convert("a.png", "b.webp", {
  // @ts-expect-error invalid fit
  operations: [{ type: "resize", width: 2, fit: "unknown" }],

});
