/** Preserve unrelated query parameters while updating a profile navigation control. */
export function profileQuery(search: string, key: "tab" | "status", value: string | null) {
  const params = new URLSearchParams(search);
  if (value === null) params.delete(key);
  else params.set(key, value);
  return `?${params.toString()}`;
}