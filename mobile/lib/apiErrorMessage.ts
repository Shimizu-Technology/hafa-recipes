/** Extract a user-facing API error while preserving a safe fallback. */
export function getApiErrorMessage(error: unknown, fallback: string): string {
  const candidate = error as {
    message?: unknown;
    response?: { data?: { detail?: unknown } };
  };
  const detail = candidate?.response?.data?.detail;
  if (typeof detail === 'string' && detail.trim()) return detail;
  if (
    detail &&
    typeof detail === 'object' &&
    'message' in detail &&
    typeof detail.message === 'string' &&
    detail.message.trim()
  ) {
    return detail.message;
  }
  return typeof candidate?.message === 'string' && candidate.message.trim()
    ? candidate.message
    : fallback;
}
