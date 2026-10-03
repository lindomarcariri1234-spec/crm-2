import { execFileSync } from "node:child_process";

const generatedPaths = [
  "lib/api-zod/src/generated",
  "lib/api-zod/src/index.ts",
  "lib/api-client-react/src/generated",
];

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" });
}

const trackedChanges = git([
  "diff",
  "HEAD",
  "--name-only",
  "--",
  ...generatedPaths,
])
  .split(/\r?\n/)
  .filter(Boolean);

const untrackedFiles = git([
  "ls-files",
  "--others",
  "--exclude-standard",
  "--",
  ...generatedPaths,
])
  .split(/\r?\n/)
  .filter(Boolean);

const mismatches = [...new Set([...trackedChanges, ...untrackedFiles])].sort();

if (mismatches.length > 0) {
  console.error("Generated API files are out of sync with the committed output:");
  for (const file of mismatches) {
    console.error(`  ${file}`);
  }
  console.error("Run pnpm run api:codegen and commit the generated changes.");
  process.exitCode = 1;
}