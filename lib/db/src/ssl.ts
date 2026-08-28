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
 * but allow its managed chain; all other production hosts retain strict
 * certificate verification.
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
    url.searchParams.delete("sslmode");

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