import { useCallback, useState } from 'react'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { EmptyState, ErrorState, LoadingState } from '../components/AsyncState'
import { PageHeader } from '../components/PageHeader'
import { StatusPill } from '../components/StatusPill'
import { useAdminApi } from '../context/AdminApiContext'
import { useToast } from '../context/ToastContext'
import { useAdminResource } from '../hooks/useAdminResource'
import { formatDate, humanize, shortId } from '../lib/format'
import type { JobFilter, JobPreview } from '../types'

interface JobSelection {
  job: JobPreview
  action: 'retry' | 'cancel'
}

const cancellable = new Set(['queued', 'claimed', 'processing', 'failed', 'expired'])

export function JobsPage() {
  const api = useAdminApi()
  const { notify } = useToast()
  const [filter, setFilter] = useState<JobFilter>('attention')
  const [selection, setSelection] = useState<JobSelection | null>(null)
  const load = useCallback((signal: AbortSignal) => api.jobs(filter, signal), [api, filter])
  const { data, error, loading, reload } = useAdminResource(load)

  const apply = async (reason: string) => {
    if (!selection) return
    if (selection.action === 'retry') await api.retryJob(selection.job.id, reason)
    else await api.cancelJob(selection.job.id, reason)
    notify(selection.action === 'retry' ? 'Job queued for an administrator-approved retry.' : 'Job cancelled.')
    setSelection(null)
    reload()
  }

  return (
    <>
      <PageHeader
        eyebrow="Privacy-bounded recovery"
        title="Extraction jobs"
        description="Recover failed or expired work without seeing full source URLs, user notes, or provider error bodies."
        actions={<button className="button button-secondary" type="button" onClick={reload}>Refresh</button>}
      />
      <div className="segmented-control" role="group" aria-label="Filter extraction jobs">
        {(['attention', 'failed', 'expired', 'stale', 'all'] as JobFilter[]).map((status) => (
          <button key={status} type="button" className={filter === status ? 'segment segment-active' : 'segment'} aria-pressed={filter === status} onClick={() => setFilter(status)}>
            {humanize(status)}
          </button>
        ))}
      </div>
      {loading ? <LoadingState label="Loading extraction jobs" /> : null}
      {error ? <ErrorState message={error} onRetry={reload} /> : null}
      {data?.length === 0 ? <EmptyState title="No matching jobs">There is no extraction work matching this filter.</EmptyState> : null}
      {data?.length ? (
        <section className="panel panel-table" aria-label="Extraction jobs">
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th scope="col">Job</th>
                  <th scope="col">Status</th>
                  <th scope="col">Safe source</th>
                  <th scope="col">Attempts</th>
                  <th scope="col">Last updated</th>
                  <th scope="col"><span className="visually-hidden">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {data.map((job) => (
                  <tr key={job.id}>
                    <td>
                      <span className="cell-primary">{humanize(job.job_kind)}</span>
                      <code className="cell-secondary" title={job.id}>{shortId(job.id)}</code>
                    </td>
                    <td>
                      <StatusPill value={job.status} />
                      {job.error_code ? <span className="cell-secondary">{job.error_code}</span> : null}
                    </td>
                    <td>{job.source_host || <span className="muted-text">Redacted or unavailable</span>}</td>
                    <td>{job.attempt_count} / {job.max_attempts}</td>
                    <td>{formatDate(job.updated_at)}</td>
                    <td className="action-cell">
                      <div className="inline-actions">
                        {['failed', 'expired'].includes(job.status) ? (
                          <button className="button button-small button-primary" type="button" onClick={() => setSelection({ job, action: 'retry' })}>Retry</button>
                        ) : null}
                        {cancellable.has(job.status) ? (
                          <button className="button button-small button-quiet-danger" type="button" onClick={() => setSelection({ job, action: 'cancel' })}>Cancel</button>
                        ) : null}
                      </div>
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
          title={`${selection.action === 'retry' ? 'Retry' : 'Cancel'} ${humanize(selection.job.job_kind)} job`}
          description={selection.action === 'retry'
            ? 'This clears bounded failure state, resets attempts, and places the job at the front of the durable queue. It does not change recipe ownership.'
            : 'This fences active work or archives failed work as cancelled. A cancelled job cannot be resumed from this screen.'}
          actionLabel={selection.action === 'retry' ? 'Queue retry' : 'Cancel job'}
          tone={selection.action === 'cancel' ? 'danger' : 'primary'}
          onCancel={() => setSelection(null)}
          onConfirm={apply}
        />
      ) : null}
    </>
  )
}
