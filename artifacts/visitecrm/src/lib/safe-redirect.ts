export function getSafeRedirectTarget(
  search: string,
  parameter: string,
  fallback: string,
): string {
  const redirect = new URLSearchParams(search).get(parameter);
  // Only accept relative paths. Reject protocol-relative and backslash-based
  // values so authentication cannot be used as an open redirect.
  if (redirect && /^\/[^/\\]/.test(redirect)) return redirect;
  return fallback;
}