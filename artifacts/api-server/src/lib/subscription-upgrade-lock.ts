import { pool } from "@workspace/db";

const LOCK_SQL = "SELECT pg_advisory_lock(hashtextextended($1, 0))";
const UNLOCK_SQL = "SELECT pg_advisory_unlock(hashtextextended($1, 0))";

/**
 * Holds a PostgreSQL session lock for one tenant's subscription-upgrade flow.
 * Session locks serialize requests across API instances, unlike in-memory locks.
 */
export async function acquireSubscriptionUpgradeLock(
  tenantId: string,
): Promise<() => Promise<void>> {
  const client = await pool.connect();
  const lockKey = `visitecrm:subscription-upgrade:${tenantId}`;

  try {
    await client.query(LOCK_SQL, [lockKey]);
  } catch (error) {
    client.release(
      error instanceof Error ? error : new Error("Could not acquire subscription upgrade lock"),
    );
    throw error;
  }

  let released = false;
  return async () => {
    if (released) return;
    released = true;

    try {
      await client.query(UNLOCK_SQL, [lockKey]);
    } catch (error) {
      client.release(
        error instanceof Error ? error : new Error("Could not release subscription upgrade lock"),
      );
      throw error;
    }

    client.release();
  };
}