import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const root = process.cwd();
const workspaceRoot = path.resolve(root, "../..");
const sourceRoot = path.join(root, "src");
const tempConfigRoot = await mkdtemp(path.join(os.tmpdir(), "visitecrm-api-typecheck-"));
const batchSize = 4;
const aggregateEntrypoints = [
  "src/app.ts",
  "src/index.ts",
  "src/routes/index.ts",
];
const sharedFiles = [
  "src/vendor.d.ts",
  "src/typecheck-globals.d.ts",
  "src/typecheck-googleapis.d.ts",
  "src/middlewares/errorHandler.ts",
];

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "__tests__") files.push(...(await sourceFiles(filePath)));
    } else if (
      entry.isFile() &&
      entry.name.endsWith(".ts") &&
      !entry.name.endsWith(".d.ts") &&
      !entry.name.endsWith(".test.ts")
    ) {
      files.push(path.relative(root, filePath).split(path.sep).join("/"));
    }
  }
  return files;
}

function runTypecheck(configPath) {
  return new Promise((resolve, reject) => {
    const child = spawn("pnpm", ["exec", "tsc", "-p", configPath, "--noEmit"], {
      cwd: root,
      stdio: "inherit",
      env: process.env,
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`Typecheck failed (${signal ?? `exit ${code}`})`));
    });
  });
}

const files = (await sourceFiles(sourceRoot))
  .filter((file) => !aggregateEntrypoints.includes(file))
  .filter((file) => !sharedFiles.includes(file))
  .sort();
const batches = aggregateEntrypoints.map((file) => [file]);
for (let index = 0; index < files.length; index += batchSize) {
  batches.push(files.slice(index, index + batchSize));
}

try {
  for (const [index, batch] of batches.entries()) {
    const configPath = path.join(tempConfigRoot, `batch-${index + 1}.json`);
    await writeFile(
      configPath,
      JSON.stringify(
        {
          extends: path.join(root, "tsconfig.check.json"),
          compilerOptions: {
            incremental: false,
            typeRoots: [
              path.join(workspaceRoot, "node_modules/@types"),
              path.join(root, "node_modules/@types"),
            ],
          },
          include: [...sharedFiles, ...batch].map((file) => path.join(root, file)),
        },
        null,
        2,
      ) + "\n",
    );
    console.log(`api-typecheck batch ${index + 1}/${batches.length}: ${batch.join(", ")}`);
    await runTypecheck(configPath);
  }
} finally {
  await rm(tempConfigRoot, { recursive: true, force: true });
}