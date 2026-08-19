/**
 * Guards against the silent migration-skip bug class.
 *
 * Drizzle's migrator applies migrations in `idx` order and only runs a migration
 * whose `when` (folderMillis, from `lib/db/drizzle/meta/_journal.json`) is newer
 * than the most recently applied one. If a newly-appended migration carries a
 * `when` that is NOT greater than the running maximum of all earlier entries,
 * Drizzle SILENTLY skips it — `drizzle-kit migrate` reports "applied
 * successfully" while the migration never actually runs.
 *
 * Migration 0071 shipped with a `when` a year earlier than 0070, so it was never
 * applied and its CHECK constraint never got created. This test fails fast if any
 * NEW migration repeats that mistake.
 *
 * NOTE ON HISTORY: the legacy 0000–0072 migration chain (which also failed to
 * rebuild a fresh database — several tables had only ever been provisioned via
 * `drizzle-kit push`, never by a migration) was squashed into a single
 * consolidated, idempotent baseline (`0000_squash_baseline`). Its `when` is set
 * intentionally low so that databases with existing migration history skip it,
 * while empty databases build the full current schema from it. Because the
 * history was reset, only the baseline sits below `GUARD_FROM_IDX`; every
 * migration added from idx 1 onward MUST carry a `when` strictly greater than the
 * running maximum `when` of all earlier entries, or Drizzle will silently skip it.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { describe, expect, it } from "vitest";

interface JournalEntry {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints?: boolean;
}

interface Journal {
  version: string;
  dialect: string;
  entries: JournalEntry[];
}

/**
 * First index from which the running-max invariant is enforced. idx 0 is the
 * consolidated baseline whose `when` is deliberately low (see header note), so it
 * is exempt. Every real migration starts at idx 1 and must keep `when` monotonic.
 * Do NOT raise this to silence a new failure — a failure at or above this index
 * means a new migration would be silently skipped and must be fixed instead.
 */
const GUARD_FROM_IDX = 1;

const here = dirname(fileURLToPath(import.meta.url));
const journalPath = resolve(
  here,
  "../../../../lib/db/drizzle/meta/_journal.json",
);

function loadJournal(): Journal {
  return JSON.parse(readFileSync(journalPath, "utf8")) as Journal;
}

describe("drizzle migration journal ordering", () => {
  it("has at least one migration entry", () => {
    const journal = loadJournal();
    expect(Array.isArray(journal.entries)).toBe(true);
    expect(journal.entries.length).toBeGreaterThan(0);
  });

  it("has contiguous idx values starting at 0", () => {
    const journal = loadJournal();
    const ordered = [...journal.entries].sort((a, b) => a.idx - b.idx);
    ordered.forEach((entry, position) => {
      expect(entry.idx).toBe(position);
    });
  });

  it("never lets a new migration's `when` fall at or below the running max (silent-skip guard)", () => {
    const journal = loadJournal();
    const ordered = [...journal.entries].sort((a, b) => a.idx - b.idx);

    const violations: string[] = [];
    let runningMax = Number.NEGATIVE_INFINITY;
    let previous: JournalEntry | undefined;

    for (const entry of ordered) {
      if (entry.idx >= GUARD_FROM_IDX && entry.when <= runningMax) {
        violations.push(
          `${entry.tag} (idx ${entry.idx}, when ${entry.when}) is not newer than ` +
            `the running max ${runningMax}` +
            (previous ? ` (last entry: ${previous.tag}, when ${previous.when})` : "") +
            `. Drizzle will silently skip it on migrate — bump its \`when\` in ` +
            `_journal.json so it is strictly greater than every earlier entry.`,
        );
      }
      if (entry.when > runningMax) runningMax = entry.when;
      previous = entry;
    }

    expect(violations).toEqual([]);
  });
});
