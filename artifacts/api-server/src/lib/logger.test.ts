import { Writable } from "node:stream";
import express from "express";
import pino from "pino";
import pinoHttp from "pino-http";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { SAFE_ERROR_LOG_SERIALIZERS } from "./logger.js";

describe("safe error log serializers", () => {
  it("omits provider messages, headers, and response bodies while retaining HTTP status", () => {
    const marker = "SYNTHETIC_PROVIDER_SECRET_418";
    const chunks: string[] = [];
    const destination = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(chunk.toString());
        callback();
      },
    });
    const testLogger = pino({ level: "trace", serializers: SAFE_ERROR_LOG_SERIALIZERS }, destination);
    const providerError = Object.assign(new Error(`Request failed: Bearer ${marker}`), {
      statusCode: 503,
      response: {
        status: 503,
        data: { access_token: marker },
        config: { headers: { Authorization: `Bearer ${marker}` } },
      },
    });

    testLogger.error(
      { err: providerError, clerkErr: providerError, error: `Provider response contained ${marker}` },
      "External provider request failed",
    );

    const line = JSON.parse(chunks.join("").trim()) as {
      err: { kind: string; status?: number };
      clerkErr: { kind: string; status?: number };
      error: { kind: string };
    };
    expect(chunks.join("")).not.toContain(marker);
    expect(line.err).toEqual({ kind: "Error", status: 503 });
    expect(line.clerkErr).toEqual({ kind: "Error", status: 503 });
    expect(line.error).toEqual({ kind: "ErrorMessage" });
  });

  it("does not expose arbitrary values from provider error objects", () => {
    const marker = "SYNTHETIC_RESPONSE_BODY_418";
    expect(SAFE_ERROR_LOG_SERIALIZERS.err({
      message: marker,
      response: { data: marker, config: { headers: { Authorization: marker } } },
    })).toEqual({ kind: "ErrorObject" });
  });

  it("keeps provider errors sanitized in pino-http request loggers", async () => {
    const marker = "SYNTHETIC_REQUEST_LOG_SECRET_418";
    const chunks: string[] = [];
    const destination = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(chunk.toString());
        callback();
      },
    });
    const testLogger = pino({ level: "trace", serializers: SAFE_ERROR_LOG_SERIALIZERS }, destination);
    const app = express();
    app.use(pinoHttp({
      logger: testLogger,
      autoLogging: false,
      serializers: SAFE_ERROR_LOG_SERIALIZERS,
    }));
    app.get("/", (req, res) => {
      const providerError = Object.assign(new Error(`Provider returned ${marker}`), {
        statusCode: 502,
        response: { data: marker, config: { headers: { Authorization: `Bearer ${marker}` } } },
      });
      req.log.error({ err: providerError, clerkErr: providerError }, "Provider failure");
      res.sendStatus(204);
    });

    await request(app).get("/").expect(204);

    const output = chunks.join("");
    expect(output).not.toContain(marker);
    const line = JSON.parse(output.trim()) as {
      err: { kind: string; status?: number };
      clerkErr: { kind: string; status?: number };
    };
    // pino-http first normalizes `err` into a plain object, then our serializer
    // strips its message, stack, response body, and headers.
    expect(line.err).toEqual({ kind: "ErrorObject", status: 502 });
    expect(line.clerkErr).toEqual({ kind: "Error", status: 502 });
  });
});