import type {
  AdminApi,
  AuditEvent,
  CleanupJobFilter,
  CleanupJobPreview,
  ContributorPreview,
  Dashboard,
  JobFilter,
  JobPreview,
  ModerationStatus,
  RecipeModerationPayload,
  RecipePreview,
  ReportFilter,
  ReportPreview,
  ReportStatus,
} from '../types'

const PRODUCTION_API = 'https://recipe-api-x5na.onrender.com'

export class AdminApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'AdminApiError'
  }
}

export function resolveApiBaseUrl(
  configured = import.meta.env.VITE_API_BASE_URL as string | undefined,
  production = import.meta.env.PROD,
): string {
  const candidate = configured?.trim() || (production ? PRODUCTION_API : 'http://127.0.0.1:8000')
  let url: URL
  try {
    url = new URL(candidate)
  } catch {
    throw new Error('VITE_API_BASE_URL must be an absolute URL')
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('VITE_API_BASE_URL must not contain credentials, a query, or a fragment')
  }
  if (production && url.protocol !== 'https:') {
    throw new Error('Production admin builds require an HTTPS API URL')
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('VITE_API_BASE_URL must use HTTP or HTTPS')
  }
  return url.toString().replace(/\/$/, '')
}

function boundedDetail(value: unknown): string | null {
  if (typeof value !== 'object' || value === null || !('detail' in value)) return null
  const detail = (value as { detail?: unknown }).detail
  return typeof detail === 'string' ? detail.slice(0, 240) : null
}

export function createAdminApi(
  getToken: () => Promise<string | null>,
  baseUrl = resolveApiBaseUrl(),
): AdminApi {
  async function request<T>(
    path: string,
    init: RequestInit = {},
  ): Promise<T> {
    const token = await getToken()
    if (!token) throw new AdminApiError('Your session is no longer available. Sign in again.', 401)

    const response = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers,
      },
    })
    if (!response.ok) {
      let body: unknown = null
      try {
        body = await response.json()
      } catch {
        // A generic bounded message is safer than reflecting an upstream body.
      }
      const fallback =
        response.status === 401
          ? 'Your session expired. Refresh and sign in again.'
          : response.status === 403
            ? 'This account does not have administrator access.'
            : response.status === 409
              ? 'That action conflicts with the current record state. Refresh and try again.'
              : 'The admin service could not complete this request.'
      throw new AdminApiError(boundedDetail(body) || fallback, response.status)
    }
    return response.json() as Promise<T>
  }

  const query = (values: Record<string, string>) => {
    const params = new URLSearchParams()
    for (const [key, value] of Object.entries(values)) {
      if (value) params.set(key, value)
    }
    const encoded = params.toString()
    return encoded ? `?${encoded}` : ''
  }

  return {
    dashboard: (signal) => request<Dashboard>('/api/admin/dashboard', { signal }),
    reports: (status: ReportFilter, signal) =>
      request<ReportPreview[]>(`/api/admin/reports${query({ status })}`, { signal }),
    updateReport: (id: string, status: Exclude<ReportStatus, 'open'>, reason: string) =>
      request<ReportPreview>(`/api/admin/reports/${encodeURIComponent(id)}`, {
        method: 'PUT',
        body: JSON.stringify({ status, reason }),
      }),
    recipes: (search: string, status: 'all' | ModerationStatus, signal) =>
      request<RecipePreview[]>(
        `/api/admin/recipes${query({ q: search, moderation_status: status })}`,
        { signal },
      ),
    updateRecipe: (id: string, payload: RecipeModerationPayload) =>
      request<RecipePreview>(`/api/admin/recipes/${encodeURIComponent(id)}/moderation`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      }),
    contributors: (search: string, signal) =>
      request<ContributorPreview[]>(`/api/admin/contributors${query({ q: search })}`, { signal }),
    updateContributor: (id: string, status: ModerationStatus, reason: string) =>
      request<ContributorPreview>(
        `/api/admin/contributors/${encodeURIComponent(id)}/moderation`,
        { method: 'PUT', body: JSON.stringify({ moderation_status: status, reason }) },
      ),
    jobs: (status: JobFilter, signal) =>
      request<JobPreview[]>(`/api/admin/jobs${query({ status })}`, { signal }),
    retryJob: (id: string, reason: string) =>
      request<JobPreview>(`/api/admin/jobs/${encodeURIComponent(id)}/retry`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      }),
    cancelJob: (id: string, reason: string) =>
      request<JobPreview>(`/api/admin/jobs/${encodeURIComponent(id)}/cancel`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      }),
    cleanupJobs: (status: CleanupJobFilter, signal) =>
      request<CleanupJobPreview[]>(`/api/admin/cleanup-jobs${query({ status })}`, { signal }),
    retryCleanupJob: (id: string, reason: string) =>
      request<CleanupJobPreview>(`/api/admin/cleanup-jobs/${encodeURIComponent(id)}/retry`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      }),
    audit: (action: string, targetId: string, signal) =>
      request<AuditEvent[]>(`/api/admin/audit${query({ action, target_id: targetId })}`, { signal }),
  }
}
