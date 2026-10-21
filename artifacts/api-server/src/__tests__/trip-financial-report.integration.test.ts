import { describe, expect, it, vi } from "vitest";

const LOCAL_TEST_DATABASE = "visitecrm_trip_financial_report_test";
const CI_TEST_DATABASE = "visitecrm_ci";
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

interface DatabaseTarget {
  databaseName: string;
  kind: "local" | "ci";
}

interface DatabaseIdentity {
  database_name: string;
  server_address: string | null;
}

function normalizeHost(host: string): string {
  return host.replace(/^\[|\]$/g, "").toLowerCase();
}

function isLoopback(host: string): boolean {
  return LOOPBACK_HOSTS.has(normalizeHost(host));
}

function resolveDatabaseTarget(
  databaseUrl: string | undefined,
  ci: string | undefined,
): DatabaseTarget {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL must point to an isolated trip financial report test database");
  }

  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error("Refusing to run trip financial report integration test with an invalid database URL");
  }

  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error("Refusing to run trip financial report integration test with an invalid database URL");
  }

  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));
  const configuredHost = normalizeHost(parsed.hostname);
  const connectionOverrides = [
    ...parsed.searchParams.getAll("host"),
    ...parsed.searchParams.getAll("hostaddr"),
  ].flatMap((host) => host.split(",").map(normalizeHost));
  const hasServiceOverride =
    parsed.searchParams.has("service") || parsed.searchParams.has("servicefile");
  const isLoopbackUrl =
    isLoopback(configuredHost) &&
    !hasServiceOverride &&
    connectionOverrides.every(isLoopback);

  if (databaseName === LOCAL_TEST_DATABASE && isLoopbackUrl) {
    return { databaseName, kind: "local" };
  }
  if (ci === "true" && databaseName === CI_TEST_DATABASE && isLoopbackUrl) {
    return { databaseName, kind: "ci" };
  }

  throw new Error("Refusing to run trip financial report integration test outside an isolated database");
}

function assertConnectedIdentity(
  target: DatabaseTarget,
  identity: DatabaseIdentity | undefined,
): void {
  const matchesDatabase = identity?.database_name === target.databaseName;
  const matchesLocalServer =
    target.kind === "ci" ||
    isLoopback(identity?.server_address ?? "");

  if (!matchesDatabase || !matchesLocalServer) {
    throw new Error("Refusing to run trip financial report integration test outside an isolated database");
  }
}

async function runBeforeFixtureInsert(options: {
  databaseUrl: string | undefined;
  ci: string | undefined;
  queryIdentity: () => Promise<DatabaseIdentity | undefined>;
  insertFixtures: () => Promise<void>;
}): Promise<void> {
  const target = resolveDatabaseTarget(options.databaseUrl, options.ci);
  const identity = await options.queryIdentity();
  assertConnectedIdentity(target, identity);
  await options.insertFixtures();
}

// These policy tests use injected callbacks only; they never import the database
// pool, open a connection, or insert into any database.
describe("trip financial report integration database guard", () => {
  it("rejects remote database URLs before identity queries or fixture inserts", async () => {
    const queryIdentity = vi.fn();
    const insertFixtures = vi.fn();

    await expect(runBeforeFixtureInsert({
      databaseUrl: "postgresql://db.example.com/visitecrm_trip_financial_report_test",
      ci: undefined,
      queryIdentity,
      insertFixtures,
    })).rejects.toThrow(/isolated database/);

    expect(queryIdentity).not.toHaveBeenCalled();
    expect(insertFixtures).not.toHaveBeenCalled();
  });

  it("rejects loopback URLs with remote PostgreSQL host overrides", async () => {
    const queryIdentity = vi.fn();
    const insertFixtures = vi.fn();

    await expect(runBeforeFixtureInsert({
      databaseUrl: `postgresql://tester@localhost/${LOCAL_TEST_DATABASE}?host=db.example.com`,
      ci: undefined,
      queryIdentity,
      insertFixtures,
    })).rejects.toThrow(/isolated database/);

    expect(queryIdentity).not.toHaveBeenCalled();
    expect(insertFixtures).not.toHaveBeenCalled();
  });

  it("rejects non-allowlisted database names before identity queries or fixture inserts", async () => {
    const queryIdentity = vi.fn();
    const insertFixtures = vi.fn();

    await expect(runBeforeFixtureInsert({
      databaseUrl: "postgresql://tester@127.0.0.1/visitecrm",
      ci: undefined,
      queryIdentity,
      insertFixtures,
    })).rejects.toThrow(/isolated database/);

    expect(queryIdentity).not.toHaveBeenCalled();
    expect(insertFixtures).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: "a different database",
      identity: { database_name: "visitecrm", server_address: "127.0.0.1" },
    },
    {
      name: "a non-loopback PostgreSQL server",
      identity: { database_name: LOCAL_TEST_DATABASE, server_address: "198.51.100.10" },
    },
    {
      name: "an unavailable PostgreSQL identity",
      identity: undefined,
    },
  ])("rejects an unexpected connected identity ($name) before fixture inserts", async ({ identity }) => {
    const queryIdentity = vi.fn().mockResolvedValue(identity);
    const insertFixtures = vi.fn();

    await expect(runBeforeFixtureInsert({
      databaseUrl: `postgresql://tester@localhost/${LOCAL_TEST_DATABASE}`,
      ci: undefined,
      queryIdentity,
      insertFixtures,
    })).rejects.toThrow(/isolated database/);

    expect(queryIdentity).toHaveBeenCalledTimes(1);
    expect(insertFixtures).not.toHaveBeenCalled();
  });

  it("accepts only the dedicated local database and loopback server", async () => {
    const insertFixtures = vi.fn().mockResolvedValue(undefined);

    await runBeforeFixtureInsert({
      databaseUrl: `postgresql://tester@127.0.0.1/${LOCAL_TEST_DATABASE}`,
      ci: undefined,
      queryIdentity: vi.fn().mockResolvedValue({
        database_name: LOCAL_TEST_DATABASE,
        server_address: "127.0.0.1",
      }),
      insertFixtures,
    });

    expect(insertFixtures).toHaveBeenCalledTimes(1);
  });

  it("accepts the CI database only when CI is true and both names match", async () => {
    const insertFixtures = vi.fn().mockResolvedValue(undefined);

    await runBeforeFixtureInsert({
      databaseUrl: `postgresql://tester@localhost/${CI_TEST_DATABASE}`,
      ci: "true",
      queryIdentity: vi.fn().mockResolvedValue({
        database_name: CI_TEST_DATABASE,
        // CI's PostgreSQL service may report its bridge-network address.
        server_address: "172.20.0.2",
      }),
      insertFixtures,
    });

    expect(insertFixtures).toHaveBeenCalledTimes(1);
  });

  it.each([
    { ci: "false", databaseName: CI_TEST_DATABASE },
    { ci: "true", databaseName: "visitecrm" },
  ])("rejects CI targets unless CI=true and the database is visitecrm_ci", async ({ ci, databaseName }) => {
    const queryIdentity = vi.fn();
    const insertFixtures = vi.fn();

    await expect(runBeforeFixtureInsert({
      databaseUrl: `postgresql://tester@localhost/${databaseName}`,
      ci,
      queryIdentity,
      insertFixtures,
    })).rejects.toThrow(/isolated database/);

    expect(queryIdentity).not.toHaveBeenCalled();
    expect(insertFixtures).not.toHaveBeenCalled();
  });
});
