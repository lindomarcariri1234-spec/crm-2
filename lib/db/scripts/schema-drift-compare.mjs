/**
 * Compare the schema expected by the latest Drizzle snapshot and incremental
 * migrations with live column and CHECK-constraint rows. Kept side-effect free
 * so the drift rules can be tested without connecting to or mutating a database.
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

function constraintKey(table, constraint) {
  return `${table.toLowerCase()}.${constraint.toLowerCase()}`;
}

function removeRedundantOuterParentheses(expression) {
  let result = expression.trim();
  while (result.startsWith("(") && result.endsWith(")")) {
    let depth = 0;
    let wrapsWholeExpression = true;
    for (let index = 0; index < result.length; index += 1) {
      if (result[index] === "(") depth += 1;
      if (result[index] === ")") depth -= 1;
      if (depth === 0 && index < result.length - 1) {
        wrapsWholeExpression = false;
        break;
      }
    }
    if (!wrapsWholeExpression) break;
    result = result.slice(1, -1).trim();
  }
  return result;
}

function normalizeCheckDefinition(definition) {
  const checkMatch = definition.trim().match(/^check\s*\(([\s\S]*)\)$/i);
  const expression = checkMatch ? checkMatch[1] : definition;
  const normalized = normalizeExpression(expression);
  const inMatch = normalized.match(
    /^([a-z_][a-z0-9_]*)in\(([\s\S]*)\)$/,
  );
  if (inMatch) {
    const values = parseTextLiteralList(inMatch[2], false);
    if (values) return `text-membership:${inMatch[1]}:${JSON.stringify(values)}`;
  }

  const anyMatch = normalized.match(
    /^([a-z_][a-z0-9_]*)=any\(array\[([\s\S]*)\]\)$/,
  );
  if (anyMatch) {
    const values = parseTextLiteralList(anyMatch[2], true);
    if (values) return `text-membership:${anyMatch[1]}:${JSON.stringify(values)}`;
  }

  return normalized;
}

function normalizeExpression(expression) {
  const source = removeRedundantOuterParentheses(expression);
  let normalized = "";
  let inString = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (inString) {
      normalized += character;
      if (character === "'" && source[index + 1] === "'") {
        normalized += source[index + 1];
        index += 1;
      } else if (character === "'") {
        inString = false;
      }
    } else if (character === "'") {
      inString = true;
      normalized += character;
    } else if (character === '"') {
      continue;
    } else if (!/\s/.test(character)) {
      normalized += character.toLowerCase();
    }
  }

  return normalized;
}

function parseTextLiteralList(source, allowTextCasts) {
  const values = [];
  let index = 0;

  while (index < source.length) {
    const match = source.slice(index).match(/^'((?:[^']|'')*)'(?:::text)?/);
    if (!match) return null;
    if (!allowTextCasts && match[0].endsWith("::text")) return null;
    values.push(match[1].replaceAll("''", "'"));
    index += match[0].length;

    if (index === source.length) return values;
    if (source[index] !== ",") return null;
    index += 1;
  }

  return null;
}

/**
 * @param {Map<string, {table: string, constraint: string, definition: string, validated?: boolean}>} expected
 * @param {Array<{table_name: string, constraint_name: string, definition: string, validated?: boolean}>} rows
 * @returns {{missing: Array<{table: string, constraint: string, reason: string}>, changed: Array<{table: string, constraint: string, reason: string}>, unvalidated: Array<{table: string, constraint: string, reason: string}>}}
 */
export function compareCheckConstraints(expected, rows) {
  const actual = new Map(
    rows.map((row) => [
      constraintKey(row.table_name, row.constraint_name),
      row,
    ]),
  );
  /** @type {Array<{table: string, constraint: string, reason: string}>} */
  const missing = [];
  /** @type {Array<{table: string, constraint: string, reason: string}>} */
  const changed = [];
  /** @type {Array<{table: string, constraint: string, reason: string}>} */
  const unvalidated = [];

  for (const constraint of expected.values()) {
    const row = actual.get(
      constraintKey(constraint.table, constraint.constraint),
    );
    if (!row) {
      missing.push({
        table: constraint.table,
        constraint: constraint.constraint,
        reason: "CHECK constraint missing from DB",
      });
    } else if (
      normalizeCheckDefinition(row.definition) !==
      normalizeCheckDefinition(constraint.definition)
    ) {
      changed.push({
        table: constraint.table,
        constraint: constraint.constraint,
        reason: "CHECK constraint definition differs from migrations",
      });
    }
    if (row && constraint.validated === true && row.validated !== true) {
      unvalidated.push({
        table: constraint.table,
        constraint: constraint.constraint,
        reason: "CHECK constraint is not validated in DB",
      });
    }
  }

  const sortEntries = (a, b) =>
    a.table.localeCompare(b.table) || a.constraint.localeCompare(b.constraint);
  missing.sort(sortEntries);
  changed.sort(sortEntries);
  unvalidated.sort(sortEntries);
  return { missing, changed, unvalidated };
}

/**
 * Adds columns declared in incremental migrations to an expected schema map.
 * Drizzle snapshots are not emitted for every hand-written migration, so live
 * verification must include both idempotent additions and post-snapshot tables.
 *
 * @param {Map<string, Set<string>>} expected
 * @param {string} sql
 */
export function applyIncrementalMigrationColumns(expected, sql) {
  const alterTableRe =
    /alter table\s+(?:if exists\s+)?"?([a-z][a-z0-9_]*)"?\s+([\s\S]*?);/gi;
  let alterMatch;
  while ((alterMatch = alterTableRe.exec(sql)) !== null) {
    const table = alterMatch[1].toLowerCase();
    const additions = alterMatch[2];
    const addColumnRe =
      /add column\s+(?:if not exists\s+)?"?([a-z][a-z0-9_]*)"?/gi;
    let additionMatch;
    while ((additionMatch = addColumnRe.exec(additions)) !== null) {
      if (!expected.has(table)) expected.set(table, new Set());
      expected.get(table).add(additionMatch[1].toLowerCase());
    }
  }

  const createTableRe =
    /create table\s+(?:if not exists\s+)?"?([a-z][a-z0-9_]*)"?\s*\(([\s\S]*?)\);/gi;
  let createMatch;
  while ((createMatch = createTableRe.exec(sql)) !== null) {
    const table = createMatch[1].toLowerCase();
    if (!expected.has(table)) expected.set(table, new Set());
    for (const line of createMatch[2].split(/\r?\n/)) {
      const trimmed = line.trim();
      if (
        /^(constraint|primary|foreign|unique|check|on|references|using|with|deferrable|initially)\b/i.test(
          trimmed,
        )
      )
        continue;
      const columnMatch = trimmed.match(/^"?([a-z][a-z0-9_]*)"?\s+/i);
      if (columnMatch) expected.get(table).add(columnMatch[1].toLowerCase());
    }
  }
}

/**
 * Adds named CHECK constraints declared in incremental ALTER TABLE and CREATE
 * TABLE migrations. Table-created checks are validated by PostgreSQL on creation.
 *
 * @param {Map<string, {table: string, constraint: string, definition: string, validated?: boolean}>} expected
 * @param {string} sql
 */
export function applyIncrementalMigrationCheckConstraints(expected, sql) {
  const alterTableRe =
    /\balter\s+table\s+(?:if\s+exists\s+)?(?:(?:"?[a-z][a-z0-9_]*"?)[.])?"?([a-z][a-z0-9_]*)"?\s+([\s\S]*?);/gi;
  let alterMatch;
  while ((alterMatch = alterTableRe.exec(sql)) !== null) {
    const table = alterMatch[1].toLowerCase();
    const statement = alterMatch[2];
    const addConstraintRe =
      /\badd\s+constraint\s+"?([a-z][a-z0-9_]*)"?\s+check\s*\(/gi;
    let constraintMatch;
    while ((constraintMatch = addConstraintRe.exec(statement)) !== null) {
      const openParenIndex = addConstraintRe.lastIndex - 1;
      const expression = readParenthesizedExpression(statement, openParenIndex);
      if (expression === null) continue;
      const constraint = constraintMatch[1].toLowerCase();
      expected.set(constraintKey(table, constraint), {
        table,
        constraint,
        definition: `CHECK (${expression})`,
      });
    }
  }

  const createTableRe =
    /\bcreate\s+table\s+(?:if\s+not\s+exists\s+)?(?:(?:"?[a-z][a-z0-9_]*"?)[.])?"?([a-z][a-z0-9_]*)"?\s*\(/gi;
  let createMatch;
  while ((createMatch = createTableRe.exec(sql)) !== null) {
    const table = createMatch[1].toLowerCase();
    const openParenIndex = createTableRe.lastIndex - 1;
    const body = readParenthesizedExpression(sql, openParenIndex);
    if (body === null) continue;

    const closingParenIndex = openParenIndex + body.length + 1;
    createTableRe.lastIndex = closingParenIndex + 1;

    const namedCheckRe =
      /\bconstraint\s+"?([a-z][a-z0-9_]*)"?\s+check\s*\(/gi;
    let checkMatch;
    while ((checkMatch = namedCheckRe.exec(body)) !== null) {
      const checkOpenParenIndex = namedCheckRe.lastIndex - 1;
      const expression = readParenthesizedExpression(body, checkOpenParenIndex);
      if (expression === null) continue;
      const constraint = checkMatch[1].toLowerCase();
      expected.set(constraintKey(table, constraint), {
        table,
        constraint,
        definition: `CHECK (${expression})`,
        validated: true,
      });
    }
  }
}

function readParenthesizedExpression(source, openParenIndex) {
  let depth = 0;
  let quote = null;
  for (let index = openParenIndex; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === quote) {
        if (source[index + 1] === quote) {
          index += 1;
        } else {
          quote = null;
        }
      }
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
    } else if (character === "(") {
      depth += 1;
    } else if (character === ")") {
      depth -= 1;
      if (depth === 0) return source.slice(openParenIndex + 1, index).trim();
    }
  }
  return null;
}
