"use strict";
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { Worker } = require("node:worker_threads");
const { MorphByteError, normalizedError } = require("./errors.cjs");
const { concurrency } = require("./options.cjs");
const queueLimit = 64;
let active = 0;
const waiting = [];
const idle = [];


function runWorker(job, signal, onProgress)
{
  if (waiting.length >= queueLimit)
  {
    return Promise.reject(
      new MorphByteError("LIMIT_EXCEEDED", "Conversion queue capacity exceeded (64)"),
    );
  }

  return new Promise((done, reject) =>
  {
    let worker,
      timer,
      started = false,
      settled = false;
    const jobId = randomUUID();
    const entry = { start };

    const finish = async (error, result) =>
    {
      if (settled)
      {
        return;
      }

      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);

      if (worker)
      {
        worker.removeAllListeners("message");
        worker.removeAllListeners("error");
        worker.removeAllListeners("exit");

        if (error)
        {
          await worker.terminate(); // Release the slot only after termination.
        }

        else
        {
          worker.unref(); // Idle workers must not keep the process alive.
          idle.push(worker);
        }

      }

      if (started)
      {
        active--;
      }

      else
      {
        const i = waiting.indexOf(entry);

        if (i >= 0)
        {
          waiting.splice(i, 1);
        }

      }

      while (active < concurrency && waiting.length)
      {
        waiting.shift().start();
      }

      if (error)
      {
        reject(error);
      }

      else
      {
        done(result);
      }

    };

    const abort = () =>
    {
      void finish(new MorphByteError("ABORTED", "Conversion aborted"));
    };

    function start()
    {
      if (settled)
      {
        return;
      }

      started = true;
      active++;

      try
      {
        worker =
          idle.pop() ||
          new Worker(path.join(__dirname, "worker.cjs"), {
            resourceLimits: { maxOldGenerationSizeMb: 256 },

          });

        worker.ref();
        worker.on("message", (m) =>
        {
          if (m.progress)
          {
            try
            {
              onProgress?.({ jobId, ...m.progress });

            }

            catch (e)
            {
              void finish(
                new MorphByteError("INVALID_INPUT", `onProgress failed: ${e.message}`),
              );
            }

          }

          else if (m.error)
          {
            void finish(
              new MorphByteError(m.error.code, m.error.message, m.error.details),
            );
          }

          else
          {
            void finish(null, m.result);
          }

        });

        worker.once(
          "error",
          (e) => void finish(new MorphByteError("ENCODER_ERROR", e.message)),
        );
        worker.once("exit", (code) =>
        {
          if (!settled)
          {
            void finish(new MorphByteError("ENCODER_ERROR", `Worker exited (${code})`));
          }

        });

        worker.postMessage(job);
      }

      catch (e)
      {
        void finish(normalizedError(e));
      }

    }

    signal?.addEventListener("abort", abort, { once: true });

    if (signal?.aborted)
    {
      abort();

      return;
    }

    timer = setTimeout(
      () => void finish(new MorphByteError("TIMEOUT", "Conversion deadline exceeded")),
      job.options.timeoutMs,
    );

    if (active < concurrency)
    {
      start();
    }

    else
    {
      waiting.push(entry);
    }

  });

}

module.exports = { runWorker, queueLimit };
