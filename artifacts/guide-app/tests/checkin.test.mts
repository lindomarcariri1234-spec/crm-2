import assert from "node:assert/strict";
import { test } from "node:test";

import {
  coalescePendingCheckin,
  submitCheckinStatus,
  type PendingCheckin,
} from "../lib/checkin.ts";

test("new check-in sends the passenger payload without a delete", async () => {
  const calls: Array<{ path: string; token: string; options: RequestInit }> = [];

  await submitCheckinStatus({
    tripId: "trip-17",
    token: "guide-token",
    passengerId: "passenger-8",
    reservationId: "reservation-21",
    currentStatus: "pendente",
    newStatus: "present",
  }, async (path, token, options) => {
    calls.push({ path, token, options });
  });

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], {
    path: "/api/guide/trip/trip-17/checkins",
    token: "guide-token",
    options: {
      method: "POST",
      body: JSON.stringify({
        passengerId: "passenger-8",
        reservationId: "reservation-21",
        status: "present",
      }),
    },
  });
});

test("changing an existing check-in awaits DELETE before POST", async () => {
  const events: string[] = [];
  const calls: Array<{ path: string; options: RequestInit }> = [];

  await submitCheckinStatus({
    tripId: "trip-17",
    token: "guide-token",
    passengerId: "passenger-8",
    reservationId: "reservation-21",
    currentStatus: "ausente",
    newStatus: "present",
  }, async (path, _token, options) => {
    calls.push({ path, options });
    events.push(`${options.method}:start`);
    await Promise.resolve();
    events.push(`${options.method}:finish`);
  });

  assert.deepEqual(events, ["DELETE:start", "DELETE:finish", "POST:start", "POST:finish"]);
  assert.deepEqual(calls.map(({ path, options }) => [path, options.method]), [
    ["/api/guide/trip/trip-17/checkins/passenger-8", "DELETE"],
    ["/api/guide/trip/trip-17/checkins", "POST"],
  ]);
});

test("a failed replacement DELETE propagates and prevents the POST", async () => {
  const calls: string[] = [];
  const failure = new Error("delete failed");

  await assert.rejects(
    submitCheckinStatus({
      tripId: "trip-17",
      token: "guide-token",
      passengerId: "passenger-8",
      reservationId: "reservation-21",
      currentStatus: "checado",
      newStatus: "absent",
    }, async (_path, _token, options) => {
      calls.push(String(options.method));
      throw failure;
    }),
    failure,
  );

  assert.deepEqual(calls, ["DELETE"]);
});

test("offline mutations replace the same passenger entry and preserve others", () => {
  const pending: PendingCheckin[] = [
    {
      operation: "upsert",
      passengerId: "passenger-8",
      reservationId: "reservation-21",
      status: "present",
      queuedAt: "2026-10-01T10:00:00.000Z",
    },
    {
      operation: "delete",
      passengerId: "passenger-9",
      reservationId: "reservation-22",
      status: "present",
      queuedAt: "2026-10-01T10:01:00.000Z",
    },
  ];

  assert.deepEqual(
    coalescePendingCheckin(pending, {
      operation: "upsert",
      passengerId: "passenger-8",
      reservationId: "reservation-21",
      status: "absent",
    }, "2026-10-01T10:02:00.000Z"),
    [
      pending[1],
      {
        operation: "upsert",
        passengerId: "passenger-8",
        reservationId: "reservation-21",
        status: "absent",
        queuedAt: "2026-10-01T10:02:00.000Z",
      },
    ],
  );
});