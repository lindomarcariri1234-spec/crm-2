import assert from "node:assert/strict";
import test from "node:test";

import {
  promoteVerifiedMain,
  RELEASE_MARKER_PATH,
} from "./promote-verified-main.mjs";

const SOURCE_SHA = "a".repeat(40);
const PROMOTION_SHA = "b".repeat(40);
const NEWER_SHA = "c".repeat(40);
const TOKEN = "test-token-never-logged";
const REPOSITORY = "lindomarcariri1234-spec/crm-2";

function apiResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

function commit({ sha, verified, reason, message = "commit", parents = [] }) {
  return {
    sha,
    commit: {
      message,
      verification: { verified, reason },
    },
    parents: parents.map((parentSha) => ({ sha: parentSha })),
  };
}

function mockFetch(responses) {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    const next = responses.shift();
    assert.notEqual(next, undefined, `Unexpected GitHub API call to ${url}`);
    if (next instanceof Error) throw next;
    return apiResponse(next.body, next.status ?? 200);
  };
  return { fetchImpl, calls, responses };
}

const baseInput = {
  token: TOKEN,
  repository: REPOSITORY,
  sourceSha: SOURCE_SHA,
  runId: "123456789",
  runAttempt: "2",
};

test("uses an already verified main commit without creating another commit", async () => {
  const mock = mockFetch([
    {
      body: commit({
        sha: SOURCE_SHA,
        verified: true,
        reason: "valid",
      }),
    },
    { body: { object: { sha: SOURCE_SHA } } },
  ]);

  const result = await promoteVerifiedMain({
    ...baseInput,
    fetchImpl: mock.fetchImpl,
  });

  assert.deepEqual(result, {
    publicationSha: SOURCE_SHA,
    sourceSha: SOURCE_SHA,
    promotionCreated: false,
    reusedExistingPromotion: false,
  });
  assert.equal(mock.calls.length, 2);
  assert.equal(
    mock.calls.some((call) => call.url.endsWith("/graphql")),
    false,
  );
});

test("creates and verifies a GitHub-signed promotion after unsigned source passes CI", async () => {
  const mock = mockFetch([
    {
      body: commit({
        sha: SOURCE_SHA,
        verified: false,
        reason: "unsigned",
      }),
    },
    { body: { object: { sha: SOURCE_SHA } } },
    {
      body: {
        data: {
          createCommitOnBranch: { commit: { oid: PROMOTION_SHA } },
        },
      },
    },
    {
      body: commit({
        sha: PROMOTION_SHA,
        verified: true,
        reason: "valid",
        message: `chore(release): promote verified main build\n\nSource-Commit: ${SOURCE_SHA}`,
        parents: [SOURCE_SHA],
      }),
    },
    { body: { object: { sha: PROMOTION_SHA } } },
  ]);

  const result = await promoteVerifiedMain({
    ...baseInput,
    fetchImpl: mock.fetchImpl,
  });

  assert.deepEqual(result, {
    publicationSha: PROMOTION_SHA,
    sourceSha: SOURCE_SHA,
    promotionCreated: true,
    reusedExistingPromotion: false,
  });
  const mutation = JSON.parse(mock.calls[2].options.body);
  const input = mutation.variables.input;
  assert.equal(input.expectedHeadOid, SOURCE_SHA);
  assert.equal(input.branch.branchName, "main");
  assert.equal(input.fileChanges.additions[0].path, RELEASE_MARKER_PATH);
  assert.equal(
    Buffer.from(input.fileChanges.additions[0].contents, "base64")
      .toString("utf8")
      .includes(`sourceCommit=${SOURCE_SHA}`),
    true,
  );
  assert.equal(
    input.message.body.includes(`Source-Commit: ${SOURCE_SHA}`),
    true,
  );
  assert.equal(
    mock.calls.every(
      ({ options }) => options.headers.Authorization === `Bearer ${TOKEN}`,
    ),
    true,
  );
});

test("reuses an existing verified promotion when the source workflow is retried", async () => {
  const mock = mockFetch([
    {
      body: commit({
        sha: SOURCE_SHA,
        verified: false,
        reason: "unsigned",
      }),
    },
    { body: { object: { sha: PROMOTION_SHA } } },
    {
      body: commit({
        sha: PROMOTION_SHA,
        verified: true,
        reason: "valid",
        message: `chore(release): promote verified main build\n\nSource-Commit: ${SOURCE_SHA}`,
        parents: [SOURCE_SHA],
      }),
    },
  ]);

  const result = await promoteVerifiedMain({
    ...baseInput,
    fetchImpl: mock.fetchImpl,
  });

  assert.equal(result.publicationSha, PROMOTION_SHA);
  assert.equal(result.reusedExistingPromotion, true);
  assert.equal(
    mock.calls.some((call) => call.url.endsWith("/graphql")),
    false,
  );
});

test("recovers an existing promotion if GitHub advances main but the API response is lost", async () => {
  const mock = mockFetch([
    {
      body: commit({
        sha: SOURCE_SHA,
        verified: false,
        reason: "unsigned",
      }),
    },
    { body: { object: { sha: SOURCE_SHA } } },
    new Error("connection closed after request"),
    { body: { object: { sha: PROMOTION_SHA } } },
    {
      body: commit({
        sha: PROMOTION_SHA,
        verified: true,
        reason: "valid",
        message: `chore(release): promote verified main build\n\nSource-Commit: ${SOURCE_SHA}`,
        parents: [SOURCE_SHA],
      }),
    },
    { body: { object: { sha: PROMOTION_SHA } } },
  ]);

  const result = await promoteVerifiedMain({
    ...baseInput,
    fetchImpl: mock.fetchImpl,
  });

  assert.equal(result.publicationSha, PROMOTION_SHA);
  assert.equal(result.promotionCreated, false);
  assert.equal(result.reusedExistingPromotion, true);
});

test("does not re-sign commits with invalid, unknown, or expired signatures", async () => {
  const mock = mockFetch([
    {
      body: commit({
        sha: SOURCE_SHA,
        verified: false,
        reason: "unknown_key",
      }),
    },
  ]);

  await assert.rejects(
    promoteVerifiedMain({ ...baseInput, fetchImpl: mock.fetchImpl }),
    /reason "unknown_key".*not "unsigned".*blocked/,
  );
  assert.equal(mock.calls.length, 1);
});

test("refuses to promote a source commit that is no longer main's head", async () => {
  const mock = mockFetch([
    {
      body: commit({
        sha: SOURCE_SHA,
        verified: false,
        reason: "unsigned",
      }),
    },
    { body: { object: { sha: NEWER_SHA } } },
    {
      body: commit({
        sha: NEWER_SHA,
        verified: true,
        reason: "valid",
        message: "newer main commit",
        parents: [SOURCE_SHA],
      }),
    },
  ]);

  await assert.rejects(
    promoteVerifiedMain({ ...baseInput, fetchImpl: mock.fetchImpl }),
    /main moved.*No promotion commit was created/,
  );
  assert.equal(
    mock.calls.some((call) => call.url.endsWith("/graphql")),
    false,
  );
});

test("fails with actionable guidance when GitHub cannot create the promotion", async () => {
  const mock = mockFetch([
    {
      body: commit({
        sha: SOURCE_SHA,
        verified: false,
        reason: "unsigned",
      }),
    },
    { body: { object: { sha: SOURCE_SHA } } },
    {
      status: 403,
      body: { message: "Resource not accessible by integration" },
    },
    { body: { object: { sha: SOURCE_SHA } } },
  ]);

  await assert.rejects(
    promoteVerifiedMain({ ...baseInput, fetchImpl: mock.fetchImpl }),
    /could not create the server-signed promotion.*contents to main/,
  );
});

test("stops if GitHub does not verify the generated promotion commit", async () => {
  const mock = mockFetch([
    {
      body: commit({
        sha: SOURCE_SHA,
        verified: false,
        reason: "unsigned",
      }),
    },
    { body: { object: { sha: SOURCE_SHA } } },
    {
      body: {
        data: {
          createCommitOnBranch: { commit: { oid: PROMOTION_SHA } },
        },
      },
    },
    {
      body: commit({
        sha: PROMOTION_SHA,
        verified: false,
        reason: "unsigned",
        message: `chore(release): promote verified main build\n\nSource-Commit: ${SOURCE_SHA}`,
        parents: [SOURCE_SHA],
      }),
    },
  ]);

  await assert.rejects(
    promoteVerifiedMain({ ...baseInput, fetchImpl: mock.fetchImpl }),
    /did not verify the generated promotion commit.*Vercel's verified-commit gate enabled/,
  );
  assert.equal(mock.calls.length, 4);
});
