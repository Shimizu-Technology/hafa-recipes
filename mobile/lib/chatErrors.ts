type ApiErrorShape = {
  code?: string;
  message?: string;
  response?: {
    status?: number;
    data?: { detail?: unknown };
  };
};

function safeDetail(error: ApiErrorShape): string | undefined {
  const detail = error.response?.data?.detail;
  return typeof detail === 'string' && detail.length <= 180 ? detail : undefined;
}

export function chatErrorMessage(error: unknown): string {
  const apiError = (error && typeof error === 'object' ? error : {}) as ApiErrorShape;
  const status = apiError.response?.status;

  if (!status && (apiError.code === 'ERR_NETWORK' || apiError.message === 'Network Error')) {
    return 'You appear to be offline. Check your connection and try again.';
  }
  if (apiError.code === 'ECONNABORTED' || apiError.message?.toLowerCase().includes('timeout')) {
    return 'The response took too long. Try again.';
  }
  if (status === 401) return 'Your session expired. Sign in again, then retry.';
  if (status === 413) return 'That image is too large. Choose a smaller image and try again.';
  if (status === 422) return safeDetail(apiError) || 'That message could not be processed. Review it and try again.';
  if (status === 429) return safeDetail(apiError) || 'Too many requests right now. Wait a moment and retry.';
  if (status === 503 || (status !== undefined && status >= 500)) {
    return 'The cooking assistant is temporarily unavailable. Try again shortly.';
  }
  return 'Your message was not sent. Please try again.';
}
