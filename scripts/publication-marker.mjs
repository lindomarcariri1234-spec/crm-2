import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const PUBLICATION_META_NAME = "visitecrm-publication";
export const PUBLICATION_VERSION_PLACEHOLDER = "__VISITECRM_PUBLICATION_VERSION__";

function readMetaTags(html) {
  const tags = [];

  for (let index = 0; index < html.length; index += 1) {
    if (html.startsWith("<!--", index)) {
      const commentEnd = html.indexOf("-->", index + 4);
      index = commentEnd === -1 ? html.length : commentEnd + 2;
      continue;
    }
    if (
      html[index] !== "<" ||
      html.slice(index + 1, index + 5).toLowerCase() !== "meta"
    ) {
      continue;
    }

    const boundary = html[index + 5];
    if (boundary !== undefined && !/[\s/>]/.test(boundary)) {
      continue;
    }

    let quote;
    let end = index + 5;
    for (; end < html.length; end += 1) {
      const character = html[end];
      if (quote) {
        if (character === quote) quote = undefined;
      } else if (character === "'" || character === '"') {
        quote = character;
      } else if (character === ">") {
        break;
      }
    }
    if (end >= html.length || quote) break;

    tags.push(html.slice(index, end + 1));
    index = end;
  }

  return tags;
}

function parseMetaAttributes(tag) {
  const attributes = [];
  let index = 5;

  while (index < tag.length - 1) {
    while (/\s/.test(tag[index] ?? "")) index += 1;
    if (tag[index] === "/" || index >= tag.length - 1) break;

    const nameStart = index;
    while (index < tag.length - 1 && !/[\s=/>]/.test(tag[index])) index += 1;
    if (nameStart === index) {
      index += 1;
      continue;
    }

    const name = tag.slice(nameStart, index).toLowerCase();
    while (/\s/.test(tag[index] ?? "")) index += 1;

    let value;
    if (tag[index] === "=") {
      index += 1;
      while (/\s/.test(tag[index] ?? "")) index += 1;

      const quote = tag[index];
      if (quote === "'" || quote === '"') {
        index += 1;
        const valueStart = index;
        while (index < tag.length - 1 && tag[index] !== quote) index += 1;
        if (tag[index] !== quote) return null;
        value = tag.slice(valueStart, index);
        index += 1;
      } else {
        const valueStart = index;
        while (index < tag.length - 1 && !/[\s>]/.test(tag[index])) index += 1;
        value = tag.slice(valueStart, index);
      }
    }

    attributes.push({ name, value });
  }

  return attributes;
}

export function getPublicationVersions(html) {
  const versions = [];

  for (const tag of readMetaTags(html)) {
    const attributes = parseMetaAttributes(tag);
    if (!attributes) continue;

    const names = attributes.filter(
      ({ name, value }) => name === "name" && value === PUBLICATION_META_NAME,
    );
    const contents = attributes.filter(({ name }) => name === "content");
    if (names.length === 1 && contents.length === 1) {
      versions.push(contents[0].value?.trim() ?? "");
    }
  }

  return versions;
}

export function assertPublicationVersion(
  html,
  sourceDescription = "Storefront HTML",
  expectedVersion,
) {
  const versions = getPublicationVersions(html);
  if (versions.length === 0) {
    throw new Error(
      `${sourceDescription} is missing the publication identity marker.`,
    );
  }
  if (versions.length > 1) {
    throw new Error(
      `${sourceDescription} contains multiple publication identity markers; exactly one is required.`,
    );
  }

  const version = versions[0];
  if (!version) {
    throw new Error(
      `${sourceDescription} is missing the publication identity marker.`,
    );
  }
  if (version === PUBLICATION_VERSION_PLACEHOLDER) {
    throw new Error(
      `${sourceDescription} contains the unsubstituted marker "${PUBLICATION_VERSION_PLACEHOLDER}". Replace this marker during the storefront build before publishing.`,
    );
  }
  if (expectedVersion !== undefined && version !== expectedVersion) {
    throw new Error(
      `expected publication version "${expectedVersion}" in ${sourceDescription}, but found "${version}"`,
    );
  }
  return version;
}

export async function readPublicationVersion(
  versionPath,
  sourceDescription = "Publication version file",
) {
  let version;
  try {
    version = (await readFile(versionPath, "utf8")).trim();
  } catch (error) {
    throw new Error(
      `${sourceDescription} is unavailable at ${versionPath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  if (!version) {
    throw new Error(`${sourceDescription} is empty at ${versionPath}.`);
  }

  return version;
}

export async function assertPublicationArtifact({
  indexPath,
  versionPath,
  sourceDescription = "Built storefront",
}) {
  const expectedVersion = await readPublicationVersion(
    versionPath,
    `${sourceDescription} publication version`,
  );

  let html;
  try {
    html = await readFile(indexPath, "utf8");
  } catch (error) {
    throw new Error(
      `${sourceDescription} index is unavailable at ${indexPath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  return assertPublicationVersion(
    html,
    `${sourceDescription} index at ${indexPath}`,
    expectedVersion,
  );
}

const defaultIndexPath = path.resolve(
  "artifacts/visitecrm/dist/public/index.html",
);

async function verifyBuiltArtifact(indexPath, expectedVersion) {
  let html;
  try {
    html = await readFile(indexPath, "utf8");
  } catch (error) {
    throw new Error(
      `Built storefront index is unavailable at ${indexPath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  const version = assertPublicationVersion(
    html,
    `Published storefront index at ${indexPath}`,
    expectedVersion,
  );
  console.log(
    `[publication-marker] Publication version "${version}" confirmed in ${indexPath}.`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const indexPath = path.resolve(process.argv[2] ?? defaultIndexPath);
  const expectedVersion = process.argv[3]?.trim() || undefined;
  verifyBuiltArtifact(indexPath, expectedVersion).catch((error) => {
    console.error(
      `[publication-marker] ERROR: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    process.exitCode = 1;
  });
}