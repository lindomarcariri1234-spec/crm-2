/**
 * Extracts a human-readable error message from an API response.
 *
 * All API endpoints return errors in the standardized format:
 *   { error: string, code: string }
 *
 * Use this utility in catch blocks or React Query `onError` callbacks so that
 * the rest of the frontend never needs to branch on response format.
 */
export function extractApiError(err: unknown, fallback = "Ocorreu um erro inesperado."): string {
  if (!err) return fallback;

  // axios-style error with response body
  const axiosErr = err as { response?: { data?: { error?: string; message?: string } } };
  if (axiosErr.response?.data?.error) return axiosErr.response.data.error;
  if (axiosErr.response?.data?.message) return axiosErr.response.data.message;

  // plain fetch / thrown Error
  if (err instanceof Error && err.message) return err.message;

  // object with { error } key (e.g. already-parsed JSON)
  const plain = err as { error?: string; message?: string };
  if (plain.error) return plain.error;
  if (plain.message) return plain.message;

  return fallback;
}
