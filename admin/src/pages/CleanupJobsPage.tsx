import { useCallback, useState } from 'react'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { EmptyState, ErrorState, LoadingState } from '../components/AsyncState'
import { PageHeader } from '../components/PageHeader'
import { StatusPill } from '../components/StatusPill'
import { useAdminApi } from '../context/AdminApiContext'
import { useToast } from '../context/ToastContext'
import { useAdminResource } from '../hooks/useAdminResource'
import { formatDate, humanize, shortId } from '../lib/format'
import type { CleanupJobFilter, CleanupJobPreview } from '../types'

const filters: CleanupJobFilter[] = ['attention', 'failed', 'queued', 'processing', 'completed', 'all']

function targetSummary(job: CleanupJobPreview) {
  const parts = []
  if (job.clerk_target_count) parts.push(`${job.clerk_target_count} ${job.clerk_target_count === 1 ? 'identity' : 'identities'}`)
  if (job.storage_prefix_count) parts.push(`${job.storage_prefix_count} storage ${job.storage_prefix_count === 1 ? 'group' : 'groups'}`)
  return parts.join(' · ') || 'No target scope recorded'
}

export function CleanupJobsPage() {
  const api = useAdminApi()
  const { notify } = useToast()
  const [filter, setFilter] = useState<CleanupJobFilter>('attention')
  const [selection, setSelection] = useState<CleanupJobPreview | null>(null)
  const load = useCallback((signal: AbortSignal) => api.cleanupJobs(filter, signal), [api, filter])
  const { data, error, loading, reload } = useAdminResource(load)

  const retry = async (reason: string) => {
    if (!selection) return
    await api.retryCleanupJob(selection.id, reason)
    notify('Deletion cleanup queued for an administrator-approved retry.')
    setSelection(null)
    reload()
  }

  return (
    <>
      <PageHeader
        eyebrow="Required erasure recovery"
        title="Deletion cleanup"
        description="Recover failed account and media cleanup without exposing user IDs, identity subjects, storage paths, or provider responses."
        actions={<button className="button button-secondary" type="button" onClick={reload}>Refresh</button>}
      />
      <div className="segmented-control" role="group" aria-label="Filter deletion cleanup jobs">
        {filters.map((status) => (
          <button key={status} type="button" className={filter === status ? 'segment segment-active' : 'segment'} aria-pressed={filter === status} onClick={() => setFilter(status)}>
            {humanize(status)}
          </button>
        ))}
      </div>
      {loading ? <LoadingState label="Loading deletion cleanup" /> : null}
      {error ? <ErrorState message={error} onRetry={reload} /> : null}
      {data?.length === 0 ? <EmptyState title="No matching cleanup jobs">Required external deletion work is clear for this filter.</EmptyState> : null}
      {data?.length ? (
        <section className="panel panel-table" aria-label="Deletion cleanup jobs">
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th scope="col">Cleanup</th>
                  <th scope="col">Status</th>
                  <th scope="col">Target scope</th>
                  <th scope="col">Attempts</th>
                  <th scope="col">Last updated</th>
                  <th scope="col"><span className="visually-hidden">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {data.map((job) => (
                  <tr key={job.id}>
                    <td>
                      <span className="cell-primary">{humanize(job.kind)}</span>
                      <code className="cell-secondary" title={job.id}>{shortId(job.id)}</code>
                    </td>
                    <td>
                      <StatusPill value={job.status} />
                      {job.error_code ? <span className="cell-secondary">{job.error_code}</span> : null}
                    </td>
                    <td>{targetSummary(job)}</td>
                    <td>{job.attempt_count} / {job.max_attempts}</td>
                    <td>{formatDate(job.updated_at)}</td>
                    <td className="action-cell">
                      {job.status === 'failed' ? (
                        <button className="button button-small button-primary" type="button" onClick={() => setSelection(job)}>Retry</button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
      {selection ? (
        <ConfirmDialog
          title={`Retry ${humanize(selection.kind)} cleanup`}
          description="This resets the bounded attempt counter and requeues idempotent external erasure. It does not restore the deleted account or recipe, and the job cannot be cancelled from this portal."
          actionLabel="Queue cleanup retry"
          onCancel={() => setSelection(null)}
          onConfirm={retry}
        />
      ) : null}
    </>
  )
}
