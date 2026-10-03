import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const sourceScript = fileURLToPath(
  new URL("./vercel-ignore-build.sh", import.meta.url),
);

function git(repositoryPath, args) {
  const result = spawnSync("git", args, {
    cwd: repositoryPath,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

test("a verified-release marker change triggers a Vercel production build", async () => {
  const repositoryPath = await mkdtemp(join(tmpdir(), "vercel-ignore-build-"));
  try {
    git(repositoryPath, ["init", "--quiet", "--initial-branch=main"]);
    git(repositoryPath, ["config", "user.name", "Publication test"]);
    git(repositoryPath, [
      "config",
      "user.email",
      "publication-test@example.com",
    ]);
    await mkdir(join(repositoryPath, "scripts"), { recursive: true });
    await mkdir(join(repositoryPath, "artifacts/visitecrm"), {
      recursive: true,
    });
    await copyFile(
      sourceScript,
      join(repositoryPath, "scripts/vercel-ignore-build.sh"),
    );
    await writeFile(
      join(repositoryPath, "artifacts/visitecrm/index.html"),
      "<html>baseline</html>\n",
    );
    git(repositoryPath, ["add", "."]);
    git(repositoryPath, ["commit", "--quiet", "-m", "baseline"]);
    const previousSha = git(repositoryPath, ["rev-parse", "HEAD"]);

    await mkdir(join(repositoryPath, ".release"), { recursive: true });
    await writeFile(
      join(repositoryPath, ".release/verified-source.txt"),
      "sourceCommit=validated-source\n",
    );
    git(repositoryPath, ["add", ".release/verified-source.txt"]);
    git(repositoryPath, ["commit", "--quiet", "-m", "verified release marker"]);
    const currentSha = git(repositoryPath, ["rev-parse", "HEAD"]);

    const result = spawnSync(
      "bash",
      [join(repositoryPath, "scripts/vercel-ignore-build.sh")],
      {
        cwd: repositoryPath,
        encoding: "utf8",
        env: {
          ...process.env,
          VERCEL_GIT_PREVIOUS_SHA: previousSha,
          VERCEL_GIT_COMMIT_SHA: currentSha,
        },
      },
    );

    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
    assert.match(
      result.stdout,
      /Published app or dependency changed; building/,
    );
  } finally {
    await rm(repositoryPath, { recursive: true, force: true });
  }
});
