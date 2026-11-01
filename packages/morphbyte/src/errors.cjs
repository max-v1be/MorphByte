"use strict";
class MorphByteError extends Error
{
  constructor(code, message, details, options)
  {
    super(message.startsWith("MorphByte: ") ? message : `MorphByte: ${message}`, options);
    this.name = "MorphByteError";
    this.code = code;
    this.details = details;
  }

}

const fail = (code, message, details) =>
{
  throw new MorphByteError(code, message, details);
};


function checkSignal(signal)
{
  if (signal?.aborted)
  {
    fail("ABORTED", "Conversion aborted");
  }

}


function normalizedError(e)
{
  if (e instanceof MorphByteError)
  {
    return e;
  }

  return new MorphByteError("IO_ERROR", e.message, undefined, { cause: e });

}

module.exports = { MorphByteError, fail, checkSignal, normalizedError };
