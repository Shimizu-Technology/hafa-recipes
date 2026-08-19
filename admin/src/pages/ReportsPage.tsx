import { useCallback, useState } from 'react'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { EmptyState, ErrorState, LoadingState } from '../components/AsyncState'
import { PageHeader } from '../components/PageHeader'
import { StatusPill } from '../components/StatusPill'
import { useAdminApi } from '../context/AdminApiContext'
import { useToast } from '../context/ToastContext'
import { useAdminResource } from '../hooks/useAdminResource'
import { formatDate, humanize, shortId } from '../lib/format'
import type { ReportFilter, ReportPreview, ReportStatus } from '../types'

interface ReviewSelection {
  report: ReportPreview
  status: Exclude<ReportStatus, 'open'>
}

const reviewCopy: Record<Exclude<ReportStatus, 'open'>, { action: string; title: string }> = {
  reviewing: { action: 'Start review', title: 'Start reviewing this report' },
  resolved: { action: 'Resolve report', title: 'Resolve this report' },
  dismissed: { action: 'Dismiss report', title: 'Dismiss this report' },
}

export function ReportsPage() {
  const api = useAdminApi()
  const { notify } = useToast()
  const [filter, setFilter] = useState<ReportFilter>('open')
  const [selection, setSelection] = useState<ReviewSelection | null>(null)
  const load = useCallback((signal: AbortSignal) => api.reports(filter, signal), [api, filter])
  const { data, error, loading, reload } = useAdminResource(load)

  const review = async (reason: string) => {
    if (!selection) return
    await api.updateReport(selection.report.id, selection.status, reason)
    notify(`Report marked ${humanize(selection.status).toLowerCase()}.`)
    setSelection(null)
    reload()
  }

  return (
    <>
      <PageHeader
        eyebrow="Oldest first"
        title="Reports and appeals"
        description="Review the submitted context, choose an explicit outcome, and record the evidence behind the decision."
        actions={<button className="button button-secondary" type="button" onClick={reload}>Refresh</button>}
      />
      <div className="segmented-control" role="group" aria-label="Filter reports by status">
        {(['open', 'reviewing', 'resolved', 'dismissed', 'all'] as ReportFilter[]).map((status) => (
          <button
            key={status}
            type="button"
            className={filter === status ? 'segment segment-active' : 'segment'}
            aria-pressed={filter === status}
            onClick={() => setFilter(status)}
          >
            {humanize(status)}
          </button>
        ))}
      </div>
      {loading ? <LoadingState label="Loading report queue" /> : null}
      {error ? <ErrorState message={error} onRetry={reload} /> : null}
      {data?.length === 0 ? (
        <EmptyState title="Queue is clear">There are no reports matching this status.</EmptyState>
      ) : null}
      {data?.length ? (
        <div className="record-list" aria-label="Report queue">
          {data.map((report) => (
            <article className="record-card" key={report.id}>
              <div className="record-main">
                <div className="record-heading">
                  <div>
                    <span className="record-kicker">{humanize(report.target_type)} · {humanize(report.category)}</span>
                    <h2>{report.target_label}</h2>
                  </div>
                  <StatusPill value={report.status} />
                </div>
                <p className={report.details ? 'report-details' : 'report-details report-details-empty'}>
                  {report.details || 'No additional details were submitted.'}
                </p>
                {report.resolution_note ? (
                  <div className="resolution-note">
                    <strong>Most recent review note</strong>
                    <p>{report.resolution_note}</p>
                  </div>
                ) : null}
                <div className="record-meta">
                  <span>Submitted {formatDate(report.created_at)}</span>
                  <code title={report.id}>{shortId(report.id)}</code>
                  {report.target_id ? <code title={report.target_id}>Target {shortId(report.target_id)}</code> : <span>Target unavailable</span>}
                </div>
              </div>
              <div className="record-actions" aria-label={`Actions for ${report.target_label}`}>
                {report.status === 'open' ? (
                  <button className="button button-secondary" type="button" onClick={() => setSelection({ report, status: 'reviewing' })}>
                    Start review
                  </button>
                ) : null}
                {report.status === 'open' || report.status === 'reviewing' ? (
                  <>
                    <button className="button button-primary" type="button" onClick={() => setSelection({ report, status: 'resolved' })}>
                      Resolve
                    </button>
                    <button className="button button-quiet-danger" type="button" onClick={() => setSelection({ report, status: 'dismissed' })}>
                      Dismiss
                    </button>
                  </>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      ) : null}
      {selection ? (
        <ConfirmDialog
          title={reviewCopy[selection.status].title}
          description={`This will mark the ${humanize(selection.report.category).toLowerCase()} report for “${selection.report.target_label}” as ${selection.status}. It does not automatically hide or restore the target.`}
          actionLabel={reviewCopy[selection.status].action}
          tone={selection.status === 'dismissed' ? 'danger' : 'primary'}
          onCancel={() => setSelection(null)}
          onConfirm={review}
        />
      ) : null}
    </>
  )
}
