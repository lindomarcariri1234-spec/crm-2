import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { createConnection, createServer as createTcpServer, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Response } from "express";
import Redis from "ioredis";
import { afterEach, describe, expect, it, vi } from "vitest";

const { mockGetRedisConnection, mockEmitSeatRefresh, mockEmitSeatUpdate } = vi.hoisted(() => ({
  mockGetRedisConnection: vi.fn(),
  mockEmitSeatRefresh: vi.fn(),
  mockEmitSeatUpdate: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  db: { select: vi.fn() },
  reservationsTable: {},
  tripsTable: {},
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(),
  and: vi.fn(),
  inArray: vi.fn(),
}));

vi.mock("../lib/redis.js", () => ({
  getRedisConnection: mockGetRedisConnection,
}));

vi.mock("../lib/seat-sse.js", () => ({
  emitSeatRefresh: mockEmitSeatRefresh,
  emitSeatUpdate: mockEmitSeatUpdate,
}));

vi.mock("../lib/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { closeSeatUpdateSubscriber, initSeatUpdateSubscriber } from "../lib/realtime.js";
import {
  addSupportTicketClient,
  removeSupportTicketClient,
} from "../lib/support-ticket-sse.js";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitUntil(
  predicate: () => boolean,
  description: string,
  timeoutMs = 8_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await sleep(20);
  }
  throw new Error(`Timed out waiting for ${description}`);
}

async function isTcpPortOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    const finish = (open: boolean) => {
      socket.destroy();
      resolve(open);
    };
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

async function reservePort(): Promise<number> {
  const server = createTcpServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
  return address.port;
}

async function startDisposableRedis(port: number, dataDirectory: string): Promise<ChildProcess> {
  const child = spawn("redis-server", [
    "--bind", "127.0.0.1",
    "--protected-mode", "yes",
    "--port", String(port),
    "--dir", dataDirectory,
    "--save", "",
    "--appendonly", "no",
    "--loglevel", "warning",
  ], { stdio: "ignore" });
  let spawnError: Error | undefined;
  child.once("error", (error) => {
    spawnError = error;
  });

  try {
    const deadline = Date.now() + 8_000;
    while (Date.now() < deadline) {
      if (spawnError) throw spawnError;
      if (child.exitCode !== null || child.signalCode !== null) {
        throw new Error(`Disposable Redis exited during startup (${child.exitCode ?? child.signalCode})`);
      }
      if (await isTcpPortOpen(port)) return child;
      await sleep(20);
    }
    throw new Error("Timed out starting disposable Redis on loopback");
  } catch (error) {
    if (!spawnError) await stopRedis(child);
    throw error;
  }
}

async function stopRedis(child: ChildProcess | undefined): Promise<void> {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  if (!child.kill("SIGTERM")) return;
  await new Promise<void>((resolve) => {
    const finish = () => {
      clearTimeout(forceKillTimer);
      resolve();
    };
    child.once("exit", finish);
    child.once("close", finish);
    const forceKillTimer = setTimeout(() => child.kill("SIGKILL"), 2_000);
  });
}

async function closeHttpServer(server: ReturnType<typeof createHttpServer>): Promise<void> {
  if (!server.listening) return;
  const closed = new Promise<void>((resolve) => server.close(() => resolve()));
  server.closeAllConnections();
  await closed;
}

interface TicketSnapshot {
  revision: string;
}

interface RefreshEnvelope {
  eventId: string;
  type: "refresh";
  ticketId: null;
}

describe("ticket SSE recovery with a disposable Redis server", () => {
  afterEach(async () => {
    await closeSeatUpdateSubscriber();
    mockGetRedisConnection.mockReset();
    mockEmitSeatRefresh.mockClear();
    mockEmitSeatUpdate.mockClear();
  });

  it("keeps an open inbox current through two Redis restarts and refreshes only after acknowledgements", async () => {
    const port = await reservePort();
    const dataDirectory = await mkdtemp(join(tmpdir(), "visitecrm-ticket-redis-"));
    const redisUrl = `redis://127.0.0.1:${port}`;
    let redisProcess: ChildProcess | undefined;
    let publisher: Redis | undefined;
    let subscriber: Redis | undefined;
    let httpServer: ReturnType<typeof createHttpServer> | undefined;
    let streamReader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let streamTask: Promise<void> | undefined;
    const streamAbort = new AbortController();
    let currentRecoveryAcknowledged = false;
    let reconnectCount = 0;
    const subscriptionAcks: Array<{ acknowledged: boolean }> = [];
    const refreshes: Array<{ payload: RefreshEnvelope; acknowledgedAtDelivery: boolean }> = [];
    let ticketRevision = "initial";
    let inboxRevision: string | null = null;
    let streamClosed = false;
    let streamError: unknown;

    try {
      redisProcess = await startDisposableRedis(port, dataDirectory);
      publisher = new Redis(redisUrl, {
        connectTimeout: 1_000,
        retryStrategy: (attempt) => Math.min(attempt * 50, 250),
      });
      publisher.on("error", () => {});
      await waitUntil(() => publisher?.status === "ready", "the test publisher to connect");

      mockGetRedisConnection.mockReturnValue({
        duplicate: () => {
          subscriber = publisher!.duplicate();
          const rawSubscribe = subscriber.subscribe.bind(subscriber);
          Object.defineProperty(subscriber, "subscribe", {
            configurable: true,
            writable: true,
            value: (channel: string, ...channels: string[]) => {
              const acknowledgement = { acknowledged: false };
              subscriptionAcks.push(acknowledgement);
              return rawSubscribe(channel, ...channels).then((result) => {
                acknowledgement.acknowledged = true;
                currentRecoveryAcknowledged = true;
                return result;
              });
            },
          });
          subscriber.on("reconnecting", () => {
            reconnectCount += 1;
            currentRecoveryAcknowledged = false;
          });
          return subscriber;
        },
      });
      initSeatUpdateSubscriber();
      await waitUntil(() => subscriptionAcks[0]?.acknowledged === true, "the initial Redis subscribe acknowledgement");
      expect(subscriptionAcks).toHaveLength(1);

      httpServer = createHttpServer((request, response) => {
        if (request.url === "/api/tickets") {
          response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
          response.end(JSON.stringify({ revision: ticketRevision }));
          return;
        }

        if (request.url === "/api/tickets/stream") {
          response.writeHead(200, {
            "content-type": "text/event-stream",
            "cache-control": "no-cache, no-transform",
            connection: "keep-alive",
          });
          response.write(": stream-open\n\n");
          addSupportTicketClient("tenant-redis-test", response as unknown as Response);
          response.once("close", () => {
            streamClosed = true;
            removeSupportTicketClient("tenant-redis-test", response as unknown as Response);
          });
          return;
        }

        response.writeHead(404).end();
      });
      await new Promise<void>((resolve, reject) => {
        httpServer!.once("error", reject);
        httpServer!.listen(0, "127.0.0.1", resolve);
      });
      const httpAddress = httpServer.address() as AddressInfo;
      const baseUrl = `http://127.0.0.1:${httpAddress.port}`;
      const streamResponse = await fetch(`${baseUrl}/api/tickets/stream`, {
        signal: streamAbort.signal,
      });
      expect(streamResponse.status).toBe(200);
      if (!streamResponse.body) throw new Error("Expected an open ticket SSE response body");
      streamReader = streamResponse.body.getReader();

      streamTask = (async () => {
        const decoder = new TextDecoder();
        let buffer = "";
        while (true) {
          const { done, value } = await streamReader!.read();
          if (done) return;
          buffer += decoder.decode(value, { stream: true });

          let separator = buffer.indexOf("\n\n");
          while (separator >= 0) {
            const frame = buffer.slice(0, separator).replaceAll("\r", "");
            buffer = buffer.slice(separator + 2);
            const dataLine = frame.split("\n").find((line) => line.startsWith("data:"));
            if (dataLine) {
              const payload = JSON.parse(dataLine.slice(5).trim()) as RefreshEnvelope;
              if (payload.type === "refresh") {
                refreshes.push({
                  payload,
                  acknowledgedAtDelivery: currentRecoveryAcknowledged,
                });
                const snapshotResponse = await fetch(`${baseUrl}/api/tickets`);
                if (!snapshotResponse.ok) {
                  throw new Error(`Ticket refresh returned HTTP ${snapshotResponse.status}`);
                }
                inboxRevision = (await snapshotResponse.json() as TicketSnapshot).revision;
              }
            }
            separator = buffer.indexOf("\n\n");
          }
        }
      })().catch((error: unknown) => {
        if (!streamAbort.signal.aborted) streamError = error;
      });

      await waitUntil(() => !streamClosed, "the browser ticket stream to stay open");

      const recoverOnce = async (revision: string, refreshCount: number) => {
        ticketRevision = revision;
        const ackCountBeforeRecovery = subscriptionAcks.length;
        const reconnectCountBeforeRecovery = reconnectCount;

        await stopRedis(redisProcess);
        redisProcess = undefined;
        await waitUntil(
          () => reconnectCount > reconnectCountBeforeRecovery,
          "ioredis to report the Redis interruption",
        );
        await sleep(75);
        expect(refreshes).toHaveLength(refreshCount);
        expect(streamClosed).toBe(false);

        redisProcess = await startDisposableRedis(port, dataDirectory);
        await waitUntil(() => publisher?.status === "ready", "the Redis publisher to reconnect");
        await waitUntil(() => subscriber?.status === "ready", "the real ioredis subscriber to reconnect");
        await waitUntil(
          () => subscriptionAcks.length > ackCountBeforeRecovery,
          "the recovery subscribe command",
        );
        const recoveryAcknowledgement = subscriptionAcks[ackCountBeforeRecovery];
        await waitUntil(
          () => recoveryAcknowledgement.acknowledged,
          "the recovery subscribe acknowledgement",
        );
        await waitUntil(
          () => refreshes.length === refreshCount + 1 && inboxRevision === revision,
          "the connected inbox to re-fetch the latest ticket data",
        );

        expect(refreshes[refreshCount]?.acknowledgedAtDelivery).toBe(true);
        expect(refreshes[refreshCount]?.payload).toMatchObject({
          type: "refresh",
          ticketId: null,
          eventId: expect.any(String),
        });
        expect(streamClosed).toBe(false);
        expect(streamError).toBeUndefined();
        await sleep(100);
        expect(refreshes).toHaveLength(refreshCount + 1);
      };

      await recoverOnce("after-first-interruption", 0);
      await recoverOnce("after-second-interruption", 1);

      expect(inboxRevision).toBe("after-second-interruption");
      expect(refreshes).toHaveLength(2);
      expect(refreshes.every((refresh) => refresh.acknowledgedAtDelivery)).toBe(true);
      expect(streamClosed).toBe(false);
    } finally {
      streamAbort.abort();
      await streamReader?.cancel().catch(() => {});
      await streamTask;
      if (subscriber && subscriber.status !== "ready") subscriber.disconnect();
      await closeSeatUpdateSubscriber();
      if (publisher) {
        if (publisher.status === "ready") await publisher.quit().catch(() => {});
        else publisher.disconnect();
      }
      await stopRedis(redisProcess);
      if (httpServer) await closeHttpServer(httpServer);
      await rm(dataDirectory, { recursive: true, force: true });
    }
  }, 30_000);
});
