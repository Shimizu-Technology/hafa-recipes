export type ModerationStatus = 'active' | 'hidden'
export type ReportStatus = 'open' | 'reviewing' | 'resolved' | 'dismissed'
export type ReportFilter = 'all' | ReportStatus
export type JobFilter = 'attention' | 'failed' | 'expired' | 'stale' | 'all'

export interface AuditEvent {
  id: string
  actor_user_id: string
  action: string
  target_type: string
  target_id: string
  reason: string
  before_summary: Record<string, unknown>
  after_summary: Record<string, unknown>
  created_at: string
}

export interface Dashboard {
  open_reports: number
  hidden_recipes: number
  hidden_contributors: number
  jobs_needing_attention: number
  recent_actions: AuditEvent[]
}

export interface RecipePreview {
  id: string
  title: string
  contributor_id: string | null
  display_name: string
  source_type: string
  is_public: boolean
  moderation_status: ModerationStatus
  is_featured: boolean
  featured_order: number | null
  created_at: string
}

export interface ContributorPreview {
  contributor_id: string
  display_name: string
  moderation_status: ModerationStatus
  public_recipe_count: number
  hidden_recipe_count: number
}

export interface ReportPreview {
  id: string
  target_type: 'recipe' | 'contributor'
  target_id: string | null
  target_label: string
  category: string
  details: string | null
  status: ReportStatus
  resolution_note: string | null
  created_at: string
  updated_at: string
}

export interface JobPreview {
  id: string
  job_kind: string
  status: string
  source_host: string | null
  error_code: string | null
  attempt_count: number
  max_attempts: number
  created_at: string
  updated_at: string
  leased_until: string | null
}

export interface RecipeModerationPayload {
  moderation_status: ModerationStatus
  is_featured: boolean
  featured_order: number | null
  reason: string
}

export interface AdminApi {
  dashboard(signal?: AbortSignal): Promise<Dashboard>
  reports(status: ReportFilter, signal?: AbortSignal): Promise<ReportPreview[]>
  updateReport(id: string, status: Exclude<ReportStatus, 'open'>, reason: string): Promise<ReportPreview>
  recipes(query: string, status: 'all' | ModerationStatus, signal?: AbortSignal): Promise<RecipePreview[]>
  updateRecipe(id: string, payload: RecipeModerationPayload): Promise<RecipePreview>
  contributors(query: string, signal?: AbortSignal): Promise<ContributorPreview[]>
  updateContributor(id: string, status: ModerationStatus, reason: string): Promise<ContributorPreview>
  jobs(status: JobFilter, signal?: AbortSignal): Promise<JobPreview[]>
  retryJob(id: string, reason: string): Promise<JobPreview>
  cancelJob(id: string, reason: string): Promise<JobPreview>
  audit(action: string, targetId: string, signal?: AbortSignal): Promise<AuditEvent[]>
}
