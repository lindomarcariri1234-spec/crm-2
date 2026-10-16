export function resolveClerkProxyUrl(
  configuredUrls: string | undefined,
  currentOrigin: string,
): string | undefined {
  if (!configuredUrls?.trim() || !currentOrigin) return undefined;

  let normalizedOrigin: string;
  try {
    normalizedOrigin = new URL(currentOrigin).origin;
  } catch {
    return undefined;
  }

  for (const entry of configuredUrls.split(",")) {
    const candidate = entry.trim();
    if (!candidate) continue;

    try {
      if (new URL(candidate).origin === normalizedOrigin) return candidate;
    } catch {
      // Ignore malformed entries and continue looking for a valid domain.
    }
  }

  return undefined;
}
