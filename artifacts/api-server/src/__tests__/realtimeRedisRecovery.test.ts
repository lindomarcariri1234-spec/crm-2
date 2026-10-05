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

import {
  broadcastSupportTicketUpdate,
  closeSeatUpdateSubscriber,
  initSeatUpdateSubscriber,
} from "../lib/realtime.js";
import {
  addSupportTicketClient,
  removeSupportTicketClient,
} from "../lib/support-ticket-sse.js";
import { malformedSupportTicketSsePayloads } from "./support-ticket-sse-fixtures.js";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("ticket SSE local fallback", () => {
  afterEach(async () => {
    await closeSeatUpdateSubscriber();
    mockGetRedisConnection.mockReset();
  });

  it("sends only the public ticket fields in the local SSE frame", async () => {
    const tenantId = "tenant-local-fallback";
    const write = vi.fn();
    const response = { write } as unknown as Response;
    mockGetRedisConnection.mockReturnValue(null);
    addSupportTicketClient(tenantId, response);

    try {
      const updateWithSensitiveExtra = {
        type: "ticket" as const,
        ticketId: "ticket-local-fallback",
        customerEmail: "must-not-be-forwarded@example.test",
      };
      await broadcastSupportTicketUpdate(tenantId, updateWithSensitiveExtra);

      expect(write).toHaveBeenCalledOnce();
      const frame = write.mock.calls[0][0] as string;
      const dataLine = frame.split("\n").find((line) => line.startsWith("data:"));
      if (!dataLine) throw new Error("Expected a ticket SSE data frame");
      const payload = JSON.parse(dataLine.slice("data:".length).trim()) as Record<string, unknown>;

      expect(payload).toMatchObject({
        eventId: expect.any(String),
        type: "ticket",
        ticketId: "ticket-local-fallback",
      });
      expect(Object.keys(payload).sort()).toEqual(["eventId", "ticketId", "type"]);
      expect(payload).not.toHaveProperty("customerEmail");
    } finally {
      removeSupportTicketClient(tenantId, response);
    }
  });
});

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

type TicketUpdatePayload =
  | { eventId: string; type: "ticket"; ticketId: string }
  | { eventId: string; type: "queues"; ticketId: null };

type TicketStreamEnvelope = RefreshEnvelope | TicketUpdatePayload;

describe("ticket SSE recovery with a disposable Redis server", () => {
  afterEach(async () => {
    await closeSeatUpdateSubscriber();
    mockGetRedisConnection.mockReset();
    mockEmitSeatRefresh.mockClear();
    mockEmitSeatUpdate.mockClear();
  });

  it("keeps an open inbox current when Redis drops again before its recovery acknowledgement completes", async () => {
    const port = await reservePort();
    const dataDirectory = await mkdtemp(join(tmpdir(), "visitecrm-ticket-redis-"));
    const redisUrl = `redis://127.0.0.1:${port}`;
    let redisProcess: ChildProcess | undefined;
    let publisher: Redis | undefined;
    let subscriber: Redis | undefined;
    let httpServer: ReturnType<typeof createHttpServer> | undefined;
    let streamReader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let otherStreamReader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let streamTask: Promise<void> | undefined;
    let otherStreamTask: Promise<void> | undefined;
    const streamAbort = new AbortController();
    const otherStreamAbort = new AbortController();
    let currentRecoveryAcknowledged = false;
    let reconnectCount = 0;
    let holdRecoverySubscribeCompletions = false;
    const subscriptionAcks: Array<{
      generation: number;
      acknowledged: boolean;
      completed: boolean;
      release?: () => void;
    }> = [];
    const refreshes: Array<{ payload: RefreshEnvelope; acknowledgedAtDelivery: boolean }> = [];
    const otherTenantRefreshes: Array<{ payload: RefreshEnvelope; acknowledgedAtDelivery: boolean }> = [];
    const ticketUpdates: TicketUpdatePayload[] = [];
    const queueUpdates: TicketUpdatePayload[] = [];
    const otherTenantUpdates: TicketUpdatePayload[] = [];
    let ticketRevision = "initial";
    let inboxRevision: string | null = null;
    let streamClosed = false;
    let otherStreamClosed = false;
    let streamError: unknown;
    let otherStreamError: unknown;

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
              const acknowledgement: (typeof subscriptionAcks)[number] = {
                generation: reconnectCount,
                acknowledged: false,
                completed: false,
              };
              subscriptionAcks.push(acknowledgement);
              return rawSubscribe(channel, ...channels).then(async (result) => {
                acknowledgement.acknowledged = true;
                if (holdRecoverySubscribeCompletions) {
                  await new Promise<void>((resolve) => {
                    acknowledgement.release = resolve;
                  });
                }
                acknowledgement.completed = true;
                currentRecoveryAcknowledged = acknowledgement.generation === reconnectCount;
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
      await waitUntil(
        () => subscriptionAcks[0]?.acknowledged === true && subscriptionAcks[0]?.completed === true,
        "the initial Redis subscribe acknowledgement",
      );
      expect(subscriptionAcks).toHaveLength(1);

      const tenantByStreamPath = new Map([
        ["/api/tickets/stream", "tenant-redis-test"],
        ["/api/tickets/other-stream", "tenant-redis-other"],
      ]);
      httpServer = createHttpServer((request, response) => {
        if (request.url === "/api/tickets") {
          response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
          response.end(JSON.stringify({ revision: ticketRevision }));
          return;
        }

        const streamTenantId = tenantByStreamPath.get(request.url ?? "");
        if (streamTenantId) {
          response.writeHead(200, {
            "content-type": "text/event-stream",
            "cache-control": "no-cache, no-transform",
            connection: "keep-alive",
          });
          response.write(": stream-open\n\n");
          addSupportTicketClient(streamTenantId, response as unknown as Response);
          response.once("close", () => {
            if (streamTenantId === "tenant-redis-test") streamClosed = true;
            else otherStreamClosed = true;
            removeSupportTicketClient(streamTenantId, response as unknown as Response);
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
      const otherStreamResponse = await fetch(`${baseUrl}/api/tickets/other-stream`, {
        signal: otherStreamAbort.signal,
      });
      expect(otherStreamResponse.status).toBe(200);
      if (!otherStreamResponse.body) throw new Error("Expected the other tenant ticket SSE response body");
      otherStreamReader = otherStreamResponse.body.getReader();

      const consumeStream = (
        reader: ReadableStreamDefaultReader<Uint8Array>,
        tenantId: string,
      ) => (async () => {
        const decoder = new TextDecoder();
        let buffer = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) return;
          buffer += decoder.decode(value, { stream: true });

          let separator = buffer.indexOf("\n\n");
          while (separator >= 0) {
            const frame = buffer.slice(0, separator).replaceAll("\r", "");
            buffer = buffer.slice(separator + 2);
            const dataLine = frame.split("\n").find((line) => line.startsWith("data:"));
            if (dataLine) {
              const payload = JSON.parse(dataLine.slice(5).trim()) as TicketStreamEnvelope;
              if (payload.type === "refresh") {
                const refresh = {
                  payload,
                  acknowledgedAtDelivery: currentRecoveryAcknowledged,
                };
                if (tenantId === "tenant-redis-test") {
                  refreshes.push(refresh);
                  const snapshotResponse = await fetch(`${baseUrl}/api/tickets`);
                  if (!snapshotResponse.ok) {
                    throw new Error(`Ticket refresh returned HTTP ${snapshotResponse.status}`);
                  }
                  inboxRevision = (await snapshotResponse.json() as TicketSnapshot).revision;
                } else {
                  otherTenantRefreshes.push(refresh);
                }
              } else if (tenantId === "tenant-redis-test") {
                if (payload.type === "ticket") ticketUpdates.push(payload);
                else queueUpdates.push(payload);
              } else {
                otherTenantUpdates.push(payload);
              }
            }
            separator = buffer.indexOf("\n\n");
          }
        }
      })();

      streamTask = consumeStream(streamReader, "tenant-redis-test").catch((error: unknown) => {
        if (!streamAbort.signal.aborted) streamError = error;
      });
      otherStreamTask = consumeStream(otherStreamReader, "tenant-redis-other").catch((error: unknown) => {
        if (!otherStreamAbort.signal.aborted) otherStreamError = error;
      });

      await waitUntil(
        () => !streamClosed && !otherStreamClosed,
        "both tenant ticket streams to stay open",
      );

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
          () => recoveryAcknowledgement.completed,
          "the recovery subscribe acknowledgement to complete",
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

      const recoverAcrossPendingAcknowledgement = async (
        staleRevision: string,
        latestRevision: string,
        refreshCount: number,
      ) => {
        ticketRevision = staleRevision;
        const staleAckIndex = subscriptionAcks.length;
        const firstReconnectCount = reconnectCount;
        holdRecoverySubscribeCompletions = true;

        await stopRedis(redisProcess);
        redisProcess = undefined;
        await waitUntil(
          () => reconnectCount > firstReconnectCount,
          "ioredis to report the interruption before the delayed acknowledgement",
        );
        await sleep(75);
        expect(refreshes).toHaveLength(refreshCount);
        expect(streamClosed).toBe(false);

        redisProcess = await startDisposableRedis(port, dataDirectory);
        await waitUntil(() => publisher?.status === "ready", "the Redis publisher to reconnect");
        await waitUntil(() => subscriber?.status === "ready", "the subscriber to recover");
        await waitUntil(
          () => subscriptionAcks.slice(staleAckIndex).some((ack) => (
            ack.acknowledged && ack.release !== undefined
          )),
          "the first recovery subscribe command",
        );
        const staleAcknowledgement = subscriptionAcks
          .slice(staleAckIndex)
          .find((ack) => ack.acknowledged && ack.release !== undefined);
        if (!staleAcknowledgement) {
          throw new Error("Expected a real Redis recovery acknowledgement to be held");
        }
        await waitUntil(
          () => staleAcknowledgement.release !== undefined,
          "the recovery acknowledgement to remain pending at the application boundary",
        );
        expect(staleAcknowledgement.completed).toBe(false);
        expect(refreshes).toHaveLength(refreshCount);

        // Redis drops again after its real ACK arrives but before realtime.ts
        // observes the pending subscribe promise as complete.
        ticketRevision = latestRevision;
        const secondReconnectCount = reconnectCount;
        await stopRedis(redisProcess);
        redisProcess = undefined;
        await waitUntil(
          () => reconnectCount > secondReconnectCount,
          "ioredis to report a second interruption while acknowledgement is pending",
        );
        await sleep(75);
        expect(refreshes).toHaveLength(refreshCount);
        expect(streamClosed).toBe(false);

        redisProcess = await startDisposableRedis(port, dataDirectory);
        await waitUntil(() => publisher?.status === "ready", "the Redis publisher to reconnect after the second interruption");
        await waitUntil(() => subscriber?.status === "ready", "the subscriber to recover after the second interruption");
        await sleep(100);
        const latestGeneration = reconnectCount;
        expect(staleAcknowledgement.completed).toBe(false);
        expect(refreshes).toHaveLength(refreshCount);
        expect(streamClosed).toBe(false);

        let staleAcknowledgements = subscriptionAcks.filter((ack) => (
          ack.generation < latestGeneration && ack.acknowledged && ack.release !== undefined
        ));
        let staleReleaseCount = 0;
        while (staleAcknowledgements.length > 0) {
          if (++staleReleaseCount > 20) {
            throw new Error("Too many stale Redis acknowledgements while recovering");
          }
          const acknowledgement = staleAcknowledgements[0];
          const releaseStaleAcknowledgement = acknowledgement.release;
          if (!releaseStaleAcknowledgement) {
            throw new Error("Expected the stale Redis acknowledgement to be held");
          }
          acknowledgement.release = undefined;
          releaseStaleAcknowledgement();
          await waitUntil(
            () => acknowledgement.completed,
            "a stale acknowledgement completion to be observed",
          );
          await sleep(20);
          staleAcknowledgements = subscriptionAcks.filter((ack) => (
            ack.generation < latestGeneration && ack.acknowledged && ack.release !== undefined
          ));
        }

        await waitUntil(
          () => subscriptionAcks.some((ack) => (
            ack.acknowledged && ack.generation === latestGeneration && ack.release !== undefined
          )),
          "a new subscribe command for the latest recovery generation",
        );
        const latestAcknowledgements = subscriptionAcks.filter((ack) => (
          ack.acknowledged && ack.generation === latestGeneration && ack.release !== undefined
        ));
        const latestAcknowledgement = latestAcknowledgements[0];
        if (!latestAcknowledgement) {
          throw new Error("Expected an acknowledgement for the latest recovery generation");
        }
        expect(latestAcknowledgement.generation).toBeGreaterThan(staleAcknowledgement.generation);
        expect(latestAcknowledgements.every((ack) => !ack.completed)).toBe(true);
        expect(refreshes).toHaveLength(refreshCount);
        expect(inboxRevision).not.toBe(latestRevision);
        expect(streamClosed).toBe(false);

        for (const acknowledgement of latestAcknowledgements) {
          const release = acknowledgement.release;
          if (!release) {
            throw new Error("Expected the latest Redis acknowledgement to be held");
          }
          acknowledgement.release = undefined;
          release();
        }
        await waitUntil(
          () => latestAcknowledgements.every((ack) => ack.completed),
          "the latest subscription acknowledgement to complete",
        );
        await waitUntil(
          () => refreshes.length === refreshCount + 1 && inboxRevision === latestRevision,
          "the inbox to refresh from the latest Redis recovery",
        );

        expect(refreshes[refreshCount]?.acknowledgedAtDelivery).toBe(true);
        expect(refreshes[refreshCount]?.payload).toMatchObject({
          type: "refresh",
          ticketId: null,
          eventId: expect.any(String),
        });
        expect(streamError).toBeUndefined();
        expect(streamClosed).toBe(false);
        await sleep(100);
        expect(refreshes).toHaveLength(refreshCount + 1);
        holdRecoverySubscribeCompletions = false;
      };

      await recoverOnce("after-first-interruption", 0);
      await recoverAcrossPendingAcknowledgement(
        "during-stale-recovery",
        "after-final-recovery",
        1,
      );

      expect(inboxRevision).toBe("after-final-recovery");
      expect(refreshes).toHaveLength(2);
      expect(refreshes.every((refresh) => refresh.acknowledgedAtDelivery)).toBe(true);
      expect(streamClosed).toBe(false);
      expect(otherStreamClosed).toBe(false);

      if (!publisher) throw new Error("Expected the real Redis publisher to remain connected");
      const ticketEvent: TicketUpdatePayload = {
        eventId: "ticket-event-after-recovery",
        type: "ticket",
        ticketId: "ticket-redis-123",
      };
      const queuesEvent: TicketUpdatePayload = {
        eventId: "queues-event-after-recovery",
        type: "queues",
        ticketId: null,
      };
      expect(await publisher.publish("support-ticket-updates", JSON.stringify({
        tenantId: "tenant-redis-test",
        payload: ticketEvent,
      }))).toBe(1);
      expect(await publisher.publish("support-ticket-updates", JSON.stringify({
        tenantId: "tenant-redis-test",
        payload: queuesEvent,
      }))).toBe(1);

      await waitUntil(
        () => ticketUpdates.length === 1 && queueUpdates.length === 1,
        "ticket and queue events to reach the matching tenant inbox",
      );
      await sleep(100);
      expect(ticketUpdates).toEqual([ticketEvent]);
      expect(queueUpdates).toEqual([queuesEvent]);
      expect(otherTenantUpdates).toHaveLength(0);
      expect(refreshes).toHaveLength(2);
      expect(otherTenantRefreshes).toHaveLength(2);
      expect(otherTenantRefreshes.every((refresh) => refresh.acknowledgedAtDelivery)).toBe(true);
      expect(streamError).toBeUndefined();
      expect(otherStreamError).toBeUndefined();
    } finally {
      streamAbort.abort();
      otherStreamAbort.abort();
      await streamReader?.cancel().catch(() => {});
      await otherStreamReader?.cancel().catch(() => {});
      await streamTask;
      await otherStreamTask;
      if (subscriber && subscriber.status !== "ready") subscriber.disconnect();
      await closeSeatUpdateSubscriber();
      holdRecoverySubscribeCompletions = false;
      for (const acknowledgement of subscriptionAcks) {
        acknowledgement.release?.();
        acknowledgement.release = undefined;
      }
      if (publisher) {
        if (publisher.status === "ready") await publisher.quit().catch(() => {});
        else publisher.disconnect();
      }
      await stopRedis(redisProcess);
      if (httpServer) await closeHttpServer(httpServer);
      await rm(dataDirectory, { recursive: true, force: true });
    }
  }, 30_000);

  it("fans ticket and queue events across isolated realtime instances after Redis recovery", async () => {
    type SubscriptionTracker = {
      id: string;
      subscriber?: Redis;
      reconnectCount: number;
      currentRecoveryAcknowledged: boolean;
      acknowledgements: Array<{
        generation: number;
        acknowledged: boolean;
        completed: boolean;
      }>;
    };
    type RealtimeInstance = {
      id: string;
      realtime: typeof import("../lib/realtime.js");
      ticketSse: typeof import("../lib/support-ticket-sse.js");
      tracker: SubscriptionTracker;
    };
    type TestStream = {
      id: string;
      path: string;
      tenantId: string;
      instance: RealtimeInstance;
      refreshes: Array<{
        payload: RefreshEnvelope;
        acknowledgedAtDelivery: boolean;
      }>;
      updates: TicketUpdatePayload[];
      abort: AbortController;
      reader?: ReadableStreamDefaultReader<Uint8Array>;
      task?: Promise<void>;
      closed: boolean;
      error?: unknown;
    };

    const port = await reservePort();
    const dataDirectory = await mkdtemp(join(tmpdir(), "visitecrm-ticket-redis-instances-"));
    const redisUrl = `redis://127.0.0.1:${port}`;
    let redisProcess: ChildProcess | undefined;
    let publisher: Redis | undefined;
    let httpServer: ReturnType<typeof createHttpServer> | undefined;
    const trackers: SubscriptionTracker[] = [
      {
        id: "instance-one",
        reconnectCount: 0,
        currentRecoveryAcknowledged: false,
        acknowledgements: [],
      },
      {
        id: "instance-two",
        reconnectCount: 0,
        currentRecoveryAcknowledged: false,
        acknowledgements: [],
      },
    ];
    const instances: RealtimeInstance[] = [];
    const streams: TestStream[] = [];
    let activeTracker: SubscriptionTracker | undefined;

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
          if (!activeTracker) {
            throw new Error("Expected a tracker for each isolated Redis subscriber");
          }
          const tracker = activeTracker;
          const subscriber = publisher!.duplicate();
          tracker.subscriber = subscriber;
          const rawSubscribe = subscriber.subscribe.bind(subscriber);
          Object.defineProperty(subscriber, "subscribe", {
            configurable: true,
            writable: true,
            value: (channel: string, ...channels: string[]) => {
              const acknowledgement = {
                generation: tracker.reconnectCount,
                acknowledged: false,
                completed: false,
              };
              tracker.acknowledgements.push(acknowledgement);
              return rawSubscribe(channel, ...channels).then((result) => {
                acknowledgement.acknowledged = true;
                acknowledgement.completed = true;
                tracker.currentRecoveryAcknowledged =
                  acknowledgement.generation === tracker.reconnectCount;
                return result;
              });
            },
          });
          subscriber.on("reconnecting", () => {
            tracker.reconnectCount += 1;
            tracker.currentRecoveryAcknowledged = false;
          });
          return subscriber;
        },
      });

      const loadIsolatedInstance = async (
        id: string,
        tracker: SubscriptionTracker,
      ): Promise<RealtimeInstance> => {
        vi.resetModules();
        const [realtime, ticketSse] = await Promise.all([
          import("../lib/realtime.js"),
          import("../lib/support-ticket-sse.js"),
        ]);
        return { id, realtime, ticketSse, tracker };
      };
      instances.push(await loadIsolatedInstance("instance-one", trackers[0]));
      instances.push(await loadIsolatedInstance("instance-two", trackers[1]));

      for (const instance of instances) {
        activeTracker = instance.tracker;
        instance.realtime.initSeatUpdateSubscriber();
      }
      activeTracker = undefined;
      await waitUntil(
        () => trackers.every((tracker) => (
          tracker.subscriber?.status === "ready"
          && tracker.acknowledgements.some((acknowledgement) => acknowledgement.completed)
        )),
        "both isolated realtime instances to acknowledge their initial subscriptions",
      );

      const matchingTenantId = "tenant-redis-target";
      const otherTenantId = "tenant-redis-other";
      for (const instance of instances) {
        for (const [tenantId, tenantLabel] of [
          [matchingTenantId, "matching"],
          [otherTenantId, "other"],
        ]) {
          streams.push({
            id: `${instance.id}-${tenantLabel}`,
            path: `/${instance.id}/${tenantLabel}`,
            tenantId,
            instance,
            refreshes: [],
            updates: [],
            abort: new AbortController(),
            closed: false,
          });
        }
      }
      const streamByPath = new Map<string, TestStream>(
        streams.map((stream) => [stream.path, stream] as const),
      );
      httpServer = createHttpServer((request, response) => {
        const stream = streamByPath.get(request.url ?? "");
        if (!stream) {
          response.writeHead(404).end();
          return;
        }

        response.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache, no-transform",
          connection: "keep-alive",
        });
        response.write(": stream-open\n\n");
        stream.instance.ticketSse.addSupportTicketClient(
          stream.tenantId,
          response as unknown as Response,
        );
        response.once("close", () => {
          stream.closed = true;
          stream.instance.ticketSse.removeSupportTicketClient(
            stream.tenantId,
            response as unknown as Response,
          );
        });
      });
      await new Promise<void>((resolve, reject) => {
        httpServer!.once("error", reject);
        httpServer!.listen(0, "127.0.0.1", resolve);
      });
      const httpAddress = httpServer.address() as AddressInfo;
      const baseUrl = `http://127.0.0.1:${httpAddress.port}`;
      const consumeStream = async (
        stream: TestStream,
        reader: ReadableStreamDefaultReader<Uint8Array>,
      ) => {
        const decoder = new TextDecoder();
        let buffer = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) return;
          buffer += decoder.decode(value, { stream: true });
          let separator = buffer.indexOf("\n\n");
          while (separator >= 0) {
            const frame = buffer.slice(0, separator).replaceAll("\r", "");
            buffer = buffer.slice(separator + 2);
            const dataLine = frame.split("\n").find((line) => line.startsWith("data:"));
            if (dataLine) {
              const payload = JSON.parse(dataLine.slice(5).trim()) as TicketStreamEnvelope;
              if (payload.type === "refresh") {
                stream.refreshes.push({
                  payload,
                  acknowledgedAtDelivery: stream.instance.tracker.currentRecoveryAcknowledged,
                });
              } else {
                stream.updates.push(payload);
              }
            }
            separator = buffer.indexOf("\n\n");
          }
        }
      };

      for (const stream of streams) {
        const response = await fetch(`${baseUrl}${stream.path}`, {
          signal: stream.abort.signal,
        });
        expect(response.status).toBe(200);
        if (!response.body) throw new Error(`Expected an open SSE response for ${stream.id}`);
        stream.reader = response.body.getReader();
        stream.task = consumeStream(stream, stream.reader).catch((error: unknown) => {
          if (!stream.abort.signal.aborted) stream.error = error;
        });
      }
      await waitUntil(
        () => streams.every((stream) => !stream.closed),
        "the four tenant streams across both instances to stay open",
      );
      expect(streams.every((stream) => stream.refreshes.length === 0)).toBe(true);

      const reconnectCountsBefore = trackers.map((tracker) => tracker.reconnectCount);
      await stopRedis(redisProcess);
      redisProcess = undefined;
      await waitUntil(
        () => trackers.every((tracker, index) => (
          tracker.reconnectCount > reconnectCountsBefore[index]
        )),
        "both realtime subscribers to detect the Redis interruption",
      );
      await sleep(75);
      expect(streams.every((stream) => !stream.closed)).toBe(true);
      expect(streams.every((stream) => stream.refreshes.length === 0)).toBe(true);

      redisProcess = await startDisposableRedis(port, dataDirectory);
      await waitUntil(() => publisher?.status === "ready", "the Redis publisher to reconnect");
      await waitUntil(
        () => trackers.every((tracker) => tracker.subscriber?.status === "ready"),
        "both real ioredis subscribers to reconnect",
      );
      await waitUntil(
        () => trackers.every((tracker) => tracker.acknowledgements.some((acknowledgement) => (
          acknowledgement.generation === tracker.reconnectCount
          && acknowledgement.acknowledged
          && acknowledgement.completed
        ))),
        "both instances to complete their latest channel subscription acknowledgements",
      );
      await waitUntil(
        () => streams.every((stream) => stream.refreshes.length === 1),
        "each local tenant stream to receive its recovery refresh",
      );
      for (const stream of streams) {
        expect(stream.refreshes[0]?.payload).toMatchObject({
          type: "refresh",
          ticketId: null,
          eventId: expect.any(String),
        });
        expect(stream.refreshes[0]?.acknowledgedAtDelivery).toBe(true);
      }
      await sleep(100);
      expect(streams.every((stream) => stream.refreshes.length === 1)).toBe(true);

      if (!publisher) throw new Error("Expected the real Redis publisher to remain connected");
      const ticketEvent: TicketUpdatePayload = {
        eventId: "ticket-event-after-multi-instance-recovery",
        type: "ticket",
        ticketId: "ticket-redis-multi-instance",
      };
      const queuesEvent: TicketUpdatePayload = {
        eventId: "queues-event-after-multi-instance-recovery",
        type: "queues",
        ticketId: null,
      };
      const sanitizedTicketEvent: TicketUpdatePayload = {
        eventId: "ticket-event-extra-data-redacted",
        type: "ticket",
        ticketId: "ticket-redis-sensitive-extra",
      };
      const ticketEventWithSensitiveExtra = {
        ...sanitizedTicketEvent,
        customerEmail: "must-not-be-forwarded@example.test",
      };
      const queuesEventWithUnexpectedExtra = {
        ...queuesEvent,
        internalQueueMetadata: "must-not-be-forwarded",
      };
      const seatEvent = {
        tripId: "trip-after-malformed-ticket-events",
        seats: [{ number: "A1", status: "reserved" }],
      };
      const invalidMessages = [
        "{invalid-json",
        JSON.stringify({ payload: ticketEvent }),
        JSON.stringify({ tenantId: "", payload: ticketEvent }),
        JSON.stringify({ tenantId: "   ", payload: ticketEvent }),
        JSON.stringify({ tenantId: 42, payload: ticketEvent }),
        JSON.stringify({ tenantId: matchingTenantId }),
        JSON.stringify({ tenantId: matchingTenantId, payload: null }),
        ...malformedSupportTicketSsePayloads.map((payload) =>
          JSON.stringify({ tenantId: matchingTenantId, payload }),
        ),
        // Refresh is valid for local recovery but must never fan out through Redis.
        JSON.stringify({
          tenantId: matchingTenantId,
          payload: { eventId: "redis-refresh-is-local-only", type: "refresh", ticketId: null },
        }),
      ];
      mockEmitSeatUpdate.mockClear();
      for (const message of invalidMessages) {
        expect(await publisher.publish("support-ticket-updates", message)).toBe(2);
      }
      await sleep(100);
      expect(streams.every((stream) => stream.updates.length === 0)).toBe(true);
      expect(streams.every((stream) => stream.refreshes.length === 1)).toBe(true);
      expect(mockEmitSeatUpdate).not.toHaveBeenCalled();

      expect(await publisher.publish("seat-updates", JSON.stringify(seatEvent))).toBe(2);
      await waitUntil(
        () => mockEmitSeatUpdate.mock.calls.length === 2,
        "one seat update to reach the seat SSE emitter in both realtime instances",
      );
      await sleep(100);
      expect(mockEmitSeatUpdate.mock.calls).toEqual([[seatEvent], [seatEvent]]);
      expect(streams.every((stream) => stream.updates.length === 0)).toBe(true);

      expect(await publisher.publish("support-ticket-updates", JSON.stringify({
        tenantId: matchingTenantId,
        payload: ticketEventWithSensitiveExtra,
      }))).toBe(2);
      expect(await publisher.publish("support-ticket-updates", JSON.stringify({
        tenantId: matchingTenantId,
        payload: ticketEvent,
      }))).toBe(2);
      expect(await publisher.publish("support-ticket-updates", JSON.stringify({
        tenantId: matchingTenantId,
        payload: queuesEventWithUnexpectedExtra,
      }))).toBe(2);

      const matchingStreams = streams.filter((stream) => stream.tenantId === matchingTenantId);
      const otherTenantStreams = streams.filter((stream) => stream.tenantId === otherTenantId);
      await waitUntil(
        () => matchingStreams.every((stream) => stream.updates.length === 3),
        "sanitized ticket, ticket, and queue events to reach both matching tenant streams",
      );
      await sleep(100);
      for (const stream of matchingStreams) {
        expect(stream.updates).toEqual([sanitizedTicketEvent, ticketEvent, queuesEvent]);
      }
      for (const stream of otherTenantStreams) {
        expect(stream.updates).toHaveLength(0);
      }
      expect(streams.every((stream) => stream.refreshes.length === 1)).toBe(true);
      expect(streams.every((stream) => !stream.closed && stream.error === undefined)).toBe(true);
      expect(trackers.every((tracker) => tracker.currentRecoveryAcknowledged)).toBe(true);
    } finally {
      for (const stream of streams) stream.abort.abort();
      for (const stream of streams) {
        await stream.reader?.cancel().catch(() => {});
      }
      await Promise.all(streams.map((stream) => stream.task));
      for (const tracker of trackers) {
        if (tracker.subscriber && tracker.subscriber.status !== "ready") {
          tracker.subscriber.disconnect();
        }
      }
      await Promise.all(
        instances.map((instance) => instance.realtime.closeSeatUpdateSubscriber()),
      );
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
