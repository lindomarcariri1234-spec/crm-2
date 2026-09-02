import { clientsTable } from "@workspace/db";
import { sql } from "drizzle-orm";

/**
 * Builds the database expression that mirrors normalizeBrazilPhone().
 *
 * Valid Brazilian numbers are compared as 55 + DDD + subscriber, regardless
 * of punctuation or whether the country code was entered. Invalid legacy
 * values fall back to the stored value so exact duplicate detection keeps
 * working for data that predates phone validation.
 */
export function normalizedClientWhatsappSql() {
  const digits = sql`regexp_replace(${clientsTable.whatsapp}, '[^0-9]', '', 'g')`;
  const normalized = sql`
    CASE
      WHEN ${digits} LIKE '55%' AND length(${digits}) >= 12 THEN ${digits}
      ELSE '55' || ${digits}
    END
  `;

  return sql`
    CASE
      WHEN length(${normalized}) BETWEEN 12 AND 13 THEN ${normalized}
      ELSE ${clientsTable.whatsapp}
    END
  `;
}