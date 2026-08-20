import type { AdminApi, AuditEvent, CleanupJobPreview, ContributorPreview, Dashboard, JobPreview, RecipePreview, ReportPreview } from '../types'

const now = new Date()
const hoursAgo = (hours: number) => new Date(now.getTime() - hours * 3_600_000).toISOString()

const auditEvents: AuditEvent[] = [
  {
    id: 'audit-1',
    actor_user_id: 'operator_48291',
    action: 'report_status_updated',
    target_type: 'report',
    target_id: '5a891ea2-ea46-41be-9f04-97d9732839c2',
    reason: 'Reviewed source attribution and confirmed the recipe links to the original creator.',
    before_summary: { status: 'reviewing' },
    after_summary: { status: 'resolved' },
    created_at: hoursAgo(1),
  },
  {
    id: 'audit-2',
    actor_user_id: 'operator_48291',
    action: 'recipe_moderation_updated',
    target_type: 'recipe',
    target_id: 'f726d591-faf1-44ef-a077-fb11a77fd402',
    reason: 'Temporarily hidden while the copyright report is reviewed.',
    before_summary: { moderation_status: 'active' },
    after_summary: { moderation_status: 'hidden' },
    created_at: hoursAgo(3),
  },
]

const recipes: RecipePreview[] = [
  { id: 'f726d591-faf1-44ef-a077-fb11a77fd402', title: 'Chicken Kelaguen', contributor_id: 'cook_9m3', display_name: 'Maria S.', source_type: 'manual', is_public: true, moderation_status: 'hidden', is_featured: false, featured_order: null, created_at: hoursAgo(72) },
  { id: 'b289f624-40bf-4e73-8adc-6421a46ade0d', title: 'Chamorro Red Rice', contributor_id: 'cook_2jk', display_name: 'Håfa Kitchen', source_type: 'website', is_public: true, moderation_status: 'active', is_featured: true, featured_order: 0, created_at: hoursAgo(120) },
  { id: 'e22d7fb2-d1f4-44ec-8a22-30b2805e6fa2', title: 'Coconut Titiyas', contributor_id: 'cook_9m3', display_name: 'Maria S.', source_type: 'video', is_public: true, moderation_status: 'active', is_featured: false, featured_order: null, created_at: hoursAgo(18) },
]

const contributors: ContributorPreview[] = [
  { contributor_id: 'cook_9m3', display_name: 'Maria S.', moderation_status: 'active', public_recipe_count: 12, hidden_recipe_count: 1 },
  { contributor_id: 'cook_2jk', display_name: 'Håfa Kitchen', moderation_status: 'active', public_recipe_count: 8, hidden_recipe_count: 0 },
  { contributor_id: 'cook_4td', display_name: 'Island Supper Club', moderation_status: 'hidden', public_recipe_count: 4, hidden_recipe_count: 0 },
]

const reports: ReportPreview[] = [
  { id: '5a891ea2-ea46-41be-9f04-97d9732839c2', target_type: 'recipe', target_id: recipes[0]!.id, target_label: 'Chicken Kelaguen', category: 'copyright', details: 'This appears to copy the full recipe and photo from our family cooking site without attribution.', status: 'reviewing', resolution_note: 'Initial source comparison started.', created_at: hoursAgo(8), updated_at: hoursAgo(2) },
  { id: '7943b9d1-8d80-496d-bc7d-424587f06583', target_type: 'contributor', target_id: 'cook_4td', target_label: 'Island Supper Club', category: 'impersonation', details: 'The display name and profile recipes appear to represent a restaurant that says this is not its account.', status: 'open', resolution_note: null, created_at: hoursAgo(4), updated_at: hoursAgo(4) },
  { id: 'da93ee8d-48f2-4f42-8c7f-2fd4c7bbd671', target_type: 'recipe', target_id: recipes[2]!.id, target_label: 'Coconut Titiyas', category: 'appeal', details: 'I added the missing source and updated my public notes. Please review the hold again.', status: 'open', resolution_note: null, created_at: hoursAgo(1), updated_at: hoursAgo(1) },
]

const jobs: JobPreview[] = [
  { id: 'job-c2f198be-1', job_kind: 'extract', status: 'failed', source_host: 'instagram.com', error_code: 'SOURCE_UNAVAILABLE', attempt_count: 3, max_attempts: 3, created_at: hoursAgo(8), updated_at: hoursAgo(2), leased_until: null },
  { id: 'job-e7a92b01-2', job_kind: 'reextract', status: 'expired', source_host: null, error_code: 'JOB_EXPIRED', attempt_count: 2, max_attempts: 3, created_at: hoursAgo(30), updated_at: hoursAgo(20), leased_until: null },
  { id: 'job-fd2810ce-3', job_kind: 'extract', status: 'queued', source_host: 'youtube.com', error_code: null, attempt_count: 0, max_attempts: 3, created_at: hoursAgo(1), updated_at: hoursAgo(1), leased_until: null },
]

const cleanupJobs: CleanupJobPreview[] = [
  { id: '53bf99a9-bd76-47b5-9f51-06ca37e5081c', kind: 'account', status: 'failed', clerk_target_count: 1, storage_prefix_count: 2, target_count: 3, attempt_count: 20, max_attempts: 20, error_code: 'StorageCleanupError', next_attempt_at: null, leased_until: null, created_at: hoursAgo(36), updated_at: hoursAgo(2), completed_at: hoursAgo(2) },
  { id: 'e47173f1-b462-47c5-aa1c-da82c68e6401', kind: 'recipe', status: 'queued', clerk_target_count: 0, storage_prefix_count: 2, target_count: 2, attempt_count: 1, max_attempts: 20, error_code: 'StorageCleanupError', next_attempt_at: hoursAgo(-1), leased_until: null, created_at: hoursAgo(3), updated_at: hoursAgo(1), completed_at: null },
]

const wait = async () => new Promise((resolve) => setTimeout(resolve, 160))
const copy = <T,>(value: T): T => structuredClone(value)

export const mockAdminApi: AdminApi = {
  async dashboard() {
    await wait()
    const value: Dashboard = { open_reports: reports.filter((item) => ['open', 'reviewing'].includes(item.status)).length, hidden_recipes: recipes.filter((item) => item.moderation_status === 'hidden').length, hidden_contributors: contributors.filter((item) => item.moderation_status === 'hidden').length, jobs_needing_attention: jobs.filter((item) => ['failed', 'expired', 'queued'].includes(item.status)).length, cleanup_jobs_needing_attention: cleanupJobs.filter((item) => item.status === 'failed').length, recent_actions: auditEvents }
    return copy(value)
  },
  async reports(status) { await wait(); return copy(status === 'all' ? reports : status === 'open' ? reports.filter((item) => ['open', 'reviewing'].includes(item.status)) : reports.filter((item) => item.status === status)) },
  async updateReport(id, status, reason) { await wait(); const item = reports.find((report) => report.id === id)!; item.status = status; item.resolution_note = reason; item.updated_at = new Date().toISOString(); return copy(item) },
  async recipes(query, status) { await wait(); return copy(recipes.filter((item) => (!query || item.title.toLowerCase().includes(query.toLowerCase())) && (status === 'all' || item.moderation_status === status))) },
  async updateRecipe(id, payload) { await wait(); const item = recipes.find((recipe) => recipe.id === id)!; Object.assign(item, payload); return copy(item) },
  async contributors(query) { await wait(); return copy(contributors.filter((item) => !query || item.display_name.toLowerCase().includes(query.toLowerCase()))) },
  async updateContributor(id, status) { await wait(); const item = contributors.find((contributor) => contributor.contributor_id === id)!; item.moderation_status = status; return copy(item) },
  async jobs(status) { await wait(); return copy(status === 'all' || status === 'attention' ? jobs : status === 'stale' ? jobs.filter((item) => item.status === 'queued') : jobs.filter((item) => item.status === status)) },
  async retryJob(id) { await wait(); const item = jobs.find((job) => job.id === id)!; item.status = 'queued'; item.attempt_count = 0; item.error_code = null; return copy(item) },
  async cancelJob(id) { await wait(); const item = jobs.find((job) => job.id === id)!; item.status = 'cancelled'; return copy(item) },
  async cleanupJobs(status) { await wait(); return copy(status === 'all' ? cleanupJobs : status === 'attention' ? cleanupJobs.filter((item) => item.status === 'failed') : cleanupJobs.filter((item) => item.status === status)) },
  async retryCleanupJob(id) { await wait(); const item = cleanupJobs.find((job) => job.id === id)!; item.status = 'queued'; item.attempt_count = 0; item.error_code = null; item.next_attempt_at = new Date().toISOString(); item.completed_at = null; return copy(item) },
  async audit(action, targetId) { await wait(); return copy(auditEvents.filter((item) => (!action || item.action === action) && (!targetId || item.target_id === targetId))) },
}
