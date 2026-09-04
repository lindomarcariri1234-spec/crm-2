export interface DatabaseConnectionConfig {
  connectionString: string;
  ssl?: { rejectUnauthorized: boolean };
}

function isSupabasePoolerHost(hostname: string): boolean {
  return hostname === "pooler.supabase.com" || hostname.endsWith(".pooler.supabase.com");
}

/**
 * Build the pg connection options used by production database clients.
 *
 * Supabase's managed pooler can present a certificate chain that Node does not
 * recognize as publicly trusted. Keep TLS enabled for that official hostname,
 * but allow its managed chain. For other hosts, respect the connection URL's
 * explicit sslmode; when it is absent, let node-postgres use its default so
 * internal PostgreSQL services that do not expose TLS can still boot.
 */
export function buildDatabaseConnectionConfig(
  rawUrl: string,
  isProduction: boolean,
): DatabaseConnectionConfig {
  if (!isProduction) {
    return { connectionString: rawUrl };
  }

  try {
    const url = new URL(rawUrl);
    const sslMode = url.searchParams.get("sslmode")?.toLowerCase();
    url.searchParams.delete("sslmode");

    if (sslMode === "disable" || (!sslMode && !isSupabasePoolerHost(url.hostname))) {
      return { connectionString: url.toString() };
    }

    return {
      connectionString: url.toString(),
      ssl: {
        rejectUnauthorized: !isSupabasePoolerHost(url.hostname),
      },
    };
  } catch {
    return {
      connectionString: rawUrl,
      ssl: { rejectUnauthorized: true },
    };
  }
}