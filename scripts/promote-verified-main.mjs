import { appendFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const GITHUB_API_URL = "https://api.github.com";
const GITHUB_API_VERSION = "2022-11-28";
export const RELEASE_MARKER_PATH = ".release/verified-source.txt";

function asErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function assertInput(value, name) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${name} is required.`);
  }
  return value.trim();
}

function parseRepository(repository) {
  const match = /^([A-Za-z0-9-]+)\/([A-Za-z0-9_.-]+)$/.exec(repository);
  if (!match) {
    throw new Error("GITHUB_REPOSITORY must have the owner/repository format.");
  }
  return { owner: match[1], name: match[2] };
}

function assertCommitSha(sha, name) {
  if (typeof sha !== "string" || !/^[0-9a-f]{40}$/i.test(sha)) {
    throw new Error(`${name} must be a 40-character Git commit SHA.`);
  }
  return sha.toLowerCase();
}

async function requestJson(
  fetchImpl,
  url,
  token,
  { method = "GET", body } = {},
) {
  let response;
  try {
    response = await fetchImpl(url, {
      method,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": GITHUB_API_VERSION,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch (error) {
    throw new Error(`GitHub API request failed: ${asErrorMessage(error)}`);
  }

  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error(
      `GitHub API returned a non-JSON response (HTTP ${response.status}).`,
    );
  }

  if (!response.ok) {
    const detail =
      typeof data?.message === "string"
        ? `: ${data.message.slice(0, 400)}`
        : "";
    throw new Error(
      `GitHub API request failed with HTTP ${response.status}${detail}.`,
    );
  }
  return data;
}

function getVerification(commit) {
  return commit?.commit?.verification;
}

function isGitHubVerified(commit) {
  const verification = getVerification(commit);
  return verification?.verified === true && verification.reason === "valid";
}

function sourceCommitTrailer(commitMessage, sourceSha) {
  const trailer = `Source-Commit: ${sourceSha}`;
  return (
    typeof commitMessage === "string" &&
    commitMessage.split(/\r?\n/).some((line) => line.trim() === trailer)
  );
}

function isExistingPromotion(commit, sourceSha) {
  return (
    isGitHubVerified(commit) &&
    commit.parents?.some((parent) => parent.sha === sourceSha) === true &&
    sourceCommitTrailer(commit.commit?.message, sourceSha)
  );
}

async function getCommit(fetchImpl, token, owner, repository, sha) {
  return requestJson(
    fetchImpl,
    `${GITHUB_API_URL}/repos/${owner}/${repository}/commits/${sha}`,
    token,
  );
}

async function getMainHead(fetchImpl, token, owner, repository) {
  const response = await requestJson(
    fetchImpl,
    `${GITHUB_API_URL}/repos/${owner}/${repository}/git/ref/heads/main`,
    token,
  );
  return assertCommitSha(response?.object?.sha, "GitHub main branch head");
}

function throwMainMoved(sourceSha, currentSha) {
  throw new Error(
    `main moved from source ${sourceSha} to ${currentSha} before promotion. No promotion commit was created; rerun CI against the latest main commit.`,
  );
}

async function createServerSignedPromotion({
  fetchImpl,
  token,
  repository,
  sourceSha,
  runId,
  runAttempt,
}) {
  const workflowUrl = `https://github.com/${repository}/actions/runs/${runId}`;
  const markerContents = [
    `sourceCommit=${sourceSha}`,
    `workflowRun=${workflowUrl}`,
    `attempt=${runAttempt}`,
    "",
  ].join("\n");
  const query = `mutation CreateVerifiedPromotion($input: CreateCommitOnBranchInput!) {
    createCommitOnBranch(input: $input) {
      commit { oid }
      ref { name }
    }
  }`;
  const input = {
    branch: {
      repositoryNameWithOwner: repository,
      branchName: "main",
    },
    expectedHeadOid: sourceSha,
    message: {
      headline: "chore(release): promote verified main build",
      body: [
        "GitHub created this release commit after main-branch CI validation passed.",
        "",
        `Source-Commit: ${sourceSha}`,
        `Workflow-Run: ${workflowUrl}`,
      ].join("\n"),
    },
    fileChanges: {
      additions: [
        {
          path: RELEASE_MARKER_PATH,
          contents: Buffer.from(markerContents, "utf8").toString("base64"),
        },
      ],
      deletions: [],
    },
  };

  const response = await requestJson(
    fetchImpl,
    `${GITHUB_API_URL}/graphql`,
    token,
    {
      method: "POST",
      body: { query, variables: { input } },
    },
  );
  if (Array.isArray(response.errors) && response.errors.length > 0) {
    const messages = response.errors
      .map((error) => error?.message)
      .filter((message) => typeof message === "string")
      .join("; ");
    throw new Error(
      messages || "GitHub GraphQL rejected the signed promotion.",
    );
  }

  const sha = response?.data?.createCommitOnBranch?.commit?.oid;
  if (!/^[0-9a-f]{40}$/i.test(sha ?? "")) {
    throw new Error("GitHub GraphQL returned no commit SHA for the promotion.");
  }
  return sha.toLowerCase();
}

export async function promoteVerifiedMain({
  token,
  repository,
  sourceSha,
  runId,
  runAttempt = "1",
  fetchImpl = globalThis.fetch,
}) {
  token = assertInput(token, "GITHUB_TOKEN");
  repository = assertInput(repository, "GITHUB_REPOSITORY");
  sourceSha = assertCommitSha(sourceSha, "GITHUB_SHA");
  runId = assertInput(runId, "GITHUB_RUN_ID");
  runAttempt = assertInput(String(runAttempt), "GITHUB_RUN_ATTEMPT");
  const { owner, name: repositoryName } = parseRepository(repository);

  if (typeof fetchImpl !== "function") {
    throw new Error("A Fetch-compatible GitHub API client is required.");
  }

  const sourceCommit = await getCommit(
    fetchImpl,
    token,
    owner,
    repositoryName,
    sourceSha,
  );
  const sourceVerification = getVerification(sourceCommit);
  if (!sourceVerification) {
    throw new Error(
      `GitHub did not return signature verification for source ${sourceSha}; promotion stopped.`,
    );
  }

  if (sourceVerification.verified === true) {
    if (sourceVerification.reason !== "valid") {
      throw new Error(
        `GitHub returned an inconsistent verified-signature result for ${sourceSha} (reason "${sourceVerification.reason ?? "unknown"}"); promotion stopped.`,
      );
    }
    const currentHead = await getMainHead(
      fetchImpl,
      token,
      owner,
      repositoryName,
    );
    if (currentHead !== sourceSha) throwMainMoved(sourceSha, currentHead);
    return {
      publicationSha: sourceSha,
      sourceSha,
      promotionCreated: false,
      reusedExistingPromotion: false,
    };
  }

  if (sourceVerification.reason !== "unsigned") {
    throw new Error(
      `GitHub reports source signature reason "${sourceVerification.reason ?? "unknown"}" for ${sourceSha}, not "unsigned". Promotion is blocked to avoid re-signing an invalid or untrusted signature. Replace or correctly sign the source commit, then rerun CI.`,
    );
  }

  const currentHead = await getMainHead(
    fetchImpl,
    token,
    owner,
    repositoryName,
  );
  if (currentHead !== sourceSha) {
    const currentCommit = await getCommit(
      fetchImpl,
      token,
      owner,
      repositoryName,
      currentHead,
    );
    if (isExistingPromotion(currentCommit, sourceSha)) {
      return {
        publicationSha: currentHead,
        sourceSha,
        promotionCreated: false,
        reusedExistingPromotion: true,
      };
    }
    throwMainMoved(sourceSha, currentHead);
  }

  let publicationSha;
  let promotionCreated = true;
  let reusedExistingPromotion = false;
  let promotionCommit;
  try {
    publicationSha = await createServerSignedPromotion({
      fetchImpl,
      token,
      repository,
      sourceSha,
      runId,
      runAttempt,
    });
  } catch (error) {
    let observedHead;
    try {
      observedHead = await getMainHead(fetchImpl, token, owner, repositoryName);
    } catch (headError) {
      throw new Error(
        `GitHub could not confirm whether the promotion request advanced main: ${asErrorMessage(error)}; head check failed: ${asErrorMessage(headError)}. No Vercel bypass was attempted. Confirm the Actions GITHUB_TOKEN can write contents to main, then rerun CI.`,
      );
    }

    if (observedHead === sourceSha) {
      throw new Error(
        `GitHub could not create the server-signed promotion for ${sourceSha}: ${asErrorMessage(error)}. No Vercel bypass was attempted. Confirm the Actions GITHUB_TOKEN can write contents to main, then rerun CI.`,
      );
    }

    try {
      promotionCommit = await getCommit(
        fetchImpl,
        token,
        owner,
        repositoryName,
        observedHead,
      );
    } catch (commitError) {
      throw new Error(
        `main advanced to ${observedHead} while the promotion request failed (${asErrorMessage(error)}), but GitHub could not verify that head (${asErrorMessage(commitError)}). Keep Vercel's verified-commit gate enabled and inspect main before rerunning CI.`,
      );
    }
    if (!isExistingPromotion(promotionCommit, sourceSha)) {
      throw new Error(
        `main advanced to ${observedHead} while the promotion request failed (${asErrorMessage(error)}), but the new head is not a verified promotion for ${sourceSha}. Keep Vercel's verified-commit gate enabled, inspect main, and rerun CI against the latest source.`,
      );
    }
    publicationSha = observedHead;
    promotionCreated = false;
    reusedExistingPromotion = true;
  }

  promotionCommit ??= await getCommit(
    fetchImpl,
    token,
    owner,
    repositoryName,
    publicationSha,
  );
  if (!isExistingPromotion(promotionCommit, sourceSha)) {
    const verification = getVerification(promotionCommit);
    throw new Error(
      `GitHub did not verify the generated promotion commit ${publicationSha} (reason "${verification?.reason ?? "unknown"}"). Promotion stopped; keep Vercel's verified-commit gate enabled and check GitHub's server-side commit-signing support.`,
    );
  }

  const promotedHead = await getMainHead(
    fetchImpl,
    token,
    owner,
    repositoryName,
  );
  if (promotedHead !== publicationSha) {
    throw new Error(
      `main moved to ${promotedHead} immediately after creating verified promotion ${publicationSha}; no manual deployment was attempted. Rerun CI against the latest main commit.`,
    );
  }

  return {
    publicationSha,
    sourceSha,
    promotionCreated,
    reusedExistingPromotion,
  };
}

async function runFromEnvironment(environment = process.env) {
  const result = await promoteVerifiedMain({
    token: environment["GITHUB_TOKEN"],
    repository: environment["GITHUB_REPOSITORY"],
    sourceSha: environment["GITHUB_SHA"],
    runId: environment["GITHUB_RUN_ID"],
    runAttempt: environment["GITHUB_RUN_ATTEMPT"] ?? "1",
  });
  const outputPath = assertInput(environment["GITHUB_OUTPUT"], "GITHUB_OUTPUT");
  await appendFile(
    outputPath,
    `publication_sha=${result.publicationSha}\n`,
    "utf8",
  );
  if (result.promotionCreated) {
    console.log(
      `[verified-promotion] GitHub created verified release commit ${result.publicationSha} from unsigned source ${result.sourceSha}.`,
    );
  } else if (result.reusedExistingPromotion) {
    console.log(
      `[verified-promotion] Reusing already-verified promotion ${result.publicationSha} for source ${result.sourceSha}.`,
    );
  } else {
    console.log(
      `[verified-promotion] Source commit ${result.sourceSha} is already GitHub-verified; no promotion commit was needed.`,
    );
  }
}

const entrypoint = process.argv[1];
if (entrypoint && fileURLToPath(import.meta.url) === resolve(entrypoint)) {
  runFromEnvironment().catch((error) => {
    console.error(`[verified-promotion] ERROR: ${asErrorMessage(error)}`);
    process.exitCode = 1;
  });
}
