import { useCallback, useState, type FormEvent } from 'react'
import { EmptyState, ErrorState, LoadingState } from '../components/AsyncState'
import { PageHeader } from '../components/PageHeader'
import { StatusPill } from '../components/StatusPill'
import { useAdminApi } from '../context/AdminApiContext'
import { useAdminResource } from '../hooks/useAdminResource'
import { formatDate, humanize, shortId } from '../lib/format'

export function AuditPage() {
  const api = useAdminApi()
  const [actionDraft, setActionDraft] = useState('')
  const [targetDraft, setTargetDraft] = useState('')
  const [filters, setFilters] = useState({ action: '', target: '' })
  const load = useCallback(
    (signal: AbortSignal) => api.audit(filters.action, filters.target, signal),
    [api, filters],
  )
  const { data, error, loading, reload } = useAdminResource(load)

  const submit = (event: FormEvent) => {
    event.preventDefault()
    setFilters({ action: actionDraft.trim(), target: targetDraft.trim() })
  }

  return (
    <>
      <PageHeader
        eyebrow="Append-only history"
        title="Audit history"
        description="Every successful admin mutation is stored with its actor, reason, target, and bounded state change."
        actions={<button className="button button-secondary" type="button" onClick={reload}>Refresh</button>}
      />
      <form className="filter-bar" onSubmit={submit}>
        <div className="compact-field">
          <label htmlFor="audit-action">Action</label>
          <input id="audit-action" value={actionDraft} onChange={(event) => setActionDraft(event.target.value)} placeholder="e.g. report_status_updated" maxLength={48} />
        </div>
        <div className="compact-field compact-field-grow">
          <label htmlFor="audit-target">Target ID</label>
          <input id="audit-target" value={targetDraft} onChange={(event) => setTargetDraft(event.target.value)} placeholder="Exact recipe, report, contributor, or job ID" maxLength={128} />
        </div>
        <button className="button button-primary" type="submit">Apply filters</button>
      </form>
      {loading ? <LoadingState label="Loading audit history" /> : null}
      {error ? <ErrorState message={error} onRetry={reload} /> : null}
      {data?.length === 0 ? <EmptyState title="No matching audit events">Try a broader action or target filter.</EmptyState> : null}
      {data?.length ? (
        <section className="panel panel-table" aria-label="Audit events">
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">Action</th>
                  <th scope="col">Target</th>
                  <th scope="col">Reason</th>
                  <th scope="col">Actor</th>
                </tr>
              </thead>
              <tbody>
                {data.map((event) => (
                  <tr key={event.id}>
                    <td>{formatDate(event.created_at)}</td>
                    <td><StatusPill value={event.action} /></td>
                    <td>
                      <span className="cell-primary">{humanize(event.target_type)}</span>
                      <code className="cell-secondary" title={event.target_id}>{shortId(event.target_id)}</code>
                    </td>
                    <td className="reason-cell">{event.reason}</td>
                    <td><code>{shortId(event.actor_user_id)}</code></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </>
  )
}
