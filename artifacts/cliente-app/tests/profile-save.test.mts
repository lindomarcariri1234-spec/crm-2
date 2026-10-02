import assert from "node:assert/strict";
import { test } from "node:test";

import { saveClientProfile } from "../lib/profile-save.ts";

test("profile save sends a normalized PATCH before invalidating the cached profile", async () => {
  const events: unknown[] = [];

  await saveClientProfile({
    name: "  Ana Silva  ",
    phone: "  +55 11 99999-1234 ",
    cpf: "  123.456.789-00 ",
    birthDate: "05/09/1990",
  }, {
    getToken: async () => {
      events.push("token");
      return "client-token";
    },
    apiFetch: async (token, method, path, payload) => {
      events.push({ method, path, token, payload });
    },
    invalidateProfile: async () => {
      events.push("invalidate");
    },
  });

  assert.deepEqual(events, [
    "token",
    {
      method: "PATCH",
      path: "/client/me",
      token: "client-token",
      payload: {
        name: "Ana Silva",
        phone: "+55 11 99999-1234",
        cpf: "123.456.789-00",
        birthDate: "1990-09-05",
      },
    },
    "invalidate",
  ]);
});

test("profile save propagates a failed PATCH and does not invalidate cached data", async () => {
  const events: string[] = [];
  const failure = new Error("profile update failed");

  await assert.rejects(
    saveClientProfile({
      name: "Ana",
      phone: "",
      cpf: "",
      birthDate: "",
    }, {
      getToken: async () => {
        events.push("token");
        return "client-token";
      },
      apiFetch: async (_token, method, path) => {
        events.push(`${method} ${path}`);
        throw failure;
      },
      invalidateProfile: async () => {
        events.push("invalidate");
      },
    }),
    failure,
  );

  assert.deepEqual(events, ["token", "PATCH /client/me"]);
});

test("blank fields are cleared and malformed birth dates remain null", async () => {
  let savedPayload: unknown;

  await saveClientProfile({
    name: " ",
    phone: " ",
    cpf: "",
    birthDate: "not a date",
  }, {
    getToken: async () => null,
    apiFetch: async (_token, _method, _path, payload) => {
      savedPayload = payload;
    },
    invalidateProfile: async () => {},
  });

  assert.deepEqual(savedPayload, {
    name: undefined,
    phone: null,
    cpf: null,
    birthDate: null,
  });
});