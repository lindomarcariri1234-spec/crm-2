/**
 * Compare the schema expected by the latest Drizzle snapshot with rows returned
 * by information_schema.columns. Kept side-effect free so the drift rules can
 * be tested with fixtures without connecting to or mutating a database.
 */

/**
 * @param {Map<string, Set<string>>} expected
 * @param {Array<{table_name: string, column_name: string}>} rows
 * @returns {{missing: Array<{table: string, col: string, reason: string}>, unexpected: Array<{table: string, col: string, reason: string}>}}
 */
export function compareSchemaRows(expected, rows) {
  /** @type {Map<string, Set<string>>} */
  const actual = new Map();
  for (const row of rows) {
    const table = row.table_name.toLowerCase();
    if (!actual.has(table)) actual.set(table, new Set());
    actual.get(table).add(row.column_name.toLowerCase());
  }

  /** @type {Array<{table: string, col: string, reason: string}>} */
  const missing = [];
  /** @type {Array<{table: string, col: string, reason: string}>} */
  const unexpected = [];

  for (const [table, expectedColumns] of expected) {
    const actualColumns = actual.get(table);
    if (!actualColumns) {
      for (const col of expectedColumns) {
        missing.push({ table, col, reason: "table missing from DB" });
      }
      continue;
    }

    for (const col of expectedColumns) {
      if (!actualColumns.has(col)) {
        missing.push({ table, col, reason: "column missing from DB" });
      }
    }

    for (const col of actualColumns) {
      if (!expectedColumns.has(col)) {
        unexpected.push({
          table,
          col,
          reason: "column not present in Drizzle snapshot",
        });
      }
    }
  }

  const sortEntries = (a, b) =>
    a.table.localeCompare(b.table) || a.col.localeCompare(b.col);
  missing.sort(sortEntries);
  unexpected.sort(sortEntries);
  return { missing, unexpected };
}