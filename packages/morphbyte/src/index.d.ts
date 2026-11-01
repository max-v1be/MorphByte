/// <reference types="node" />
export type OutputFormat =
  | "jpeg"
  | "png"
  | "webp"
  | "avif"
  | "heic"
  | "gif"
  | "tiff"
  | "svg"
  | "pdf"
  | "json"
  | "txt"
  | "yaml"
  | "xml"
  | "toml"
  | "csv"
  | "tsv"
  | (string & {});

export type SingleInputSource = string | Buffer | Uint8Array;
export type InputSource = SingleInputSource | readonly SingleInputSource[];
export interface BufferOutputTarget
{
  format: OutputFormat;
}

export type OutputTarget =
  | string
  | BufferOutputTarget
  | { directory: string; format?: OutputFormat };

export type Fidelity = "lossless" | "lossy" | "structured" | "extraction";
export type ErrorCode =
  | "INVALID_INPUT"
  | "UNKNOWN_FORMAT"
  | "UNSUPPORTED_CONVERSION"
  | "UNSUPPORTED_OPTION"
  | "MISSING_BACKEND"
  | "INVALID_BASE64"
  | "INVALID_ENVELOPE"
  | "HASH_MISMATCH"
  | "CORRUPT_FILE"
  | "LIMIT_EXCEEDED"
  | "TIMEOUT"
  | "ABORTED"
  | "PASSWORD_REQUIRED"
  | "ENCODER_ERROR"
  | "IO_ERROR";
export class MorphByteError extends Error
{
  code: ErrorCode;
  details?: unknown;
  constructor(code: ErrorCode, message: string, details?: unknown);
}

export interface ProgressEvent
{
  jobId: string;
  stage: string;
  completed: number;
  total: number;
  unit: string;
  percent?: number;
}

export type Mode =
  | "fastest"
  | "balanced"
  | "smallest"
  | "highest-quality"
  | "lossless"
  | "custom";
export interface CompressionOptions
{
  mode?: Mode;
  algorithm?: string;
  encoder?: string;
  quality?: number;
  effort?: number;
  level?: number;
  lossless?: boolean | "auto";
  fallback?: "error" | "auto" | "compatible";
  container?: {
    algorithm?: "none" | "gzip" | "brotli" | "zstd" | "lz4";
    level?: number;
  };

}

export type Gravity =
  | "center"
  | "centre"
  | "north"
  | "south"
  | "east"
  | "west"
  | "northeast"
  | "northwest"
  | "southeast"
  | "southwest";
export type ImageOperation =
  | {
      type: "resize";
      width?: number;
      height?: number;
      fit?: "cover" | "contain" | "fill" | "inside" | "outside";
      background?: string;
      withoutEnlargement?: boolean;
      withoutReduction?: boolean;
      kernel?: "nearest" | "linear" | "cubic" | "mitchell" | "lanczos2" | "lanczos3";
      position?: Gravity;
    }

  | { type: "crop"; x: number; y: number; width: number; height: number }

  | {
      type: "overlay";
      source: SingleInputSource;
      x?: number;
      y?: number;
      gravity?: Gravity;
      opacity?: number;
      blend?: "over" | "multiply" | "screen" | "overlay" | "darken" | "lighten";
    }

  | {
      type: "extend";
      top?: number;
      right?: number;
      bottom?: number;
      left?: number;
      background?: string;
    }

  | { type: "rotate"; angle: number; background?: string }

  | { type: "flip"; axis: "horizontal" | "vertical" }

  | { type: "flatten"; background?: string }

  | { type: "grayscale" | "normalize" }

  | { type: "blur" | "sharpen"; sigma?: number }

  | { type: "modulate"; brightness?: number; saturation?: number; hue?: number }

  | { type: "gamma"; value?: number }

  | { type: "threshold"; value?: number }

  | { type: "trim"; threshold?: number };

export interface ConversionOptions
{
  from?: OutputFormat;
  to?: OutputFormat;
  mode?: Mode;
  compression?: CompressionOptions;
  representation?: "auto" | "structured" | "binary-envelope" | "base64";
  operations?: readonly ImageOperation[];
  metadata?: "safe" | "strip";
  overwrite?: boolean;
  atomic?: boolean;
  network?: boolean;
  optimize?: boolean;
  timeoutMs?: number;
  maxInputBytes?: number;
  maxOutputBytes?: number;
  maxPixels?: number;
  maxPages?: number;
  maxFrames?: number;
  maxExpansionRatio?: number;
  pdf?: {
    dpi?: number;
    pages?: "all" | string | readonly number[];
    pageSize?: "A4";
    template?: "key-value";
    extract?: readonly ("text" | "metadata")[];
    password?: string;
  };

  base64Variant?: "standard" | "url";
  dataUri?: boolean;
  lineWidth?: number;
  signal?: AbortSignal;
  onProgress?: (event: ProgressEvent) => void;
}

export interface ConversionResult
{
  outputs: {
    path?: string;
    bytes?: Uint8Array;
    name?: string;
    page?: number;
    size: number;
  }[];
  sourceFormat: OutputFormat;
  targetFormat: OutputFormat;
  conversionPath: string[];
  fidelity: Fidelity;
  durationMs: number;
  inputBytes: number;
  outputBytes: number;
  warnings: { code: string; message: string }[];
  effectiveOptions: ConversionOptions;
  backend: string;
  selectedAlgorithm?: string;
  selectedEncoder?: string;
  selectedEncoderVersion?: string;
}

export interface BatchOptions
{
  concurrency?: number;
  continueOnError?: boolean;
  signal?: AbortSignal;
  onProgress?: (event: ProgressEvent) => void;
}

export interface BatchResult
{
  results: (
    | { status: "fulfilled"; value: ConversionResult }

    | { status: "rejected"; error: MorphByteError }

  )[];
  succeeded: number;
  failed: number;
}

export interface DetectionResult
{
  format: OutputFormat;
  confidence: number;
  method: string;
  inputBytes: number;
  wrapper: string;
}

export interface FileInfo
{
  format: OutputFormat;
  mimeType?: string;
  size: number;
  confidence: number;
  width?: number;
  height?: number;
  pages?: number;
  hasAlpha?: boolean;
  orientation?: number;
  [key: string]: unknown;
}

export interface FormatDefinition
{
  id: string;
  extensions: string[];
  mimeTypes: string[];
  category?: string;
  capabilities?: Record<string, unknown>;
}

export interface EncoderInfo
{
  id: string;
  encoder: string;
  algorithm: string;
  installed: boolean;
  version?: string;
  lossless: boolean;
  quality?: number;
  effort?: number;
  level?: number;
  qualityRange?: number[];
}

export interface CustomConverter
{
  id?: string;
  from: string;
  to: string;
  cost?: number;
  fidelity?: Fidelity;
  canConvert?: (ctx: {
    from: string;
    to: string;
    options: ConversionOptions;
  }) => boolean | Promise<boolean>;
  convert: (ctx: {
    input: Uint8Array;
    from: string;
    to: string;
    options: ConversionOptions;
    signal: AbortSignal;
  }) => Promise<Uint8Array>;
}


export function convert(
  input: InputSource,
  output: OutputTarget,
  options?: ConversionOptions,
): Promise<ConversionResult>;


export function convertBuffer(
  input: Buffer | Uint8Array,
  output: OutputFormat | BufferOutputTarget,
  options?: ConversionOptions,
): Promise<Uint8Array>;


export function convertBatch(
  items: ReadonlyArray<{
    input: InputSource;
    output: OutputTarget;
    options?: ConversionOptions;
  }>,
  options?: BatchOptions,
): Promise<BatchResult>;


export function detect(input: SingleInputSource): Promise<DetectionResult>;


export function probe(input: SingleInputSource): Promise<FileInfo>;


export function getFormats(): FormatDefinition[];


export function getConversions(from: string): string[];


export function canConvert(
  from: string,
  to: string,
  options?: ConversionOptions,
): boolean;


export function getCapabilities(format: string):
  | (FormatDefinition & {
      decode: boolean;
      encode: boolean;
      backend: string;
      streaming: boolean;
      animation: boolean;
      metadata: string;
    })

  | undefined;


export function getEncoders(filter: {
  format: string;
  algorithm?: string;
}): EncoderInfo[];


export function getEncoderOptions(format: string): EncoderInfo[];


export function getCompressionOptions(format: string): {
  format: string;
  encoders: EncoderInfo[];
  defaults: CompressionOptions;
  wrappers: string[];
};


export function getCompressionAlgorithms(format: string): string[];


export function getDefaultOptions(args?: {
  from?: string;
  to?: string;
}): ConversionOptions;


export function resolveOptions(
  input: InputSource,
  output: OutputTarget,
  options?: ConversionOptions,
): Promise<
  ConversionOptions & { from: OutputFormat; to: OutputFormat; backend?: string }

>;


export function getBuildInfo(): {
  name: string;
  version: string;
  platform: string;
  arch: string;
  runtime: string;
  nativeAddon: boolean;
  pdfBackend: string;
  workerConcurrency: number;
  queueCapacity: number;
  codecs: Record<string, string>;
  versions: Record<string, string | undefined>;
};


export function registerFormat(format: FormatDefinition): void;


export function registerConverter(converter: CustomConverter): string;


export function unregisterFormat(id: string): boolean;


export function unregisterConverter(id: string): boolean;


export function createConverter(options?: {
  defaults?: ConversionOptions;
  formatDefaults?: Record<string, ConversionOptions>;
  routeDefaults?: Record<string, ConversionOptions>;
}): {
  convert: typeof convert;
  convertBuffer: typeof convertBuffer;
  getDefaultOptions: typeof getDefaultOptions;
};
