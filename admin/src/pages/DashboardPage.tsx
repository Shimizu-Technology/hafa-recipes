import { useCallback } from 'react'
import { Link } from 'react-router-dom'
import { ErrorState, LoadingState } from '../components/AsyncState'
import { PageHeader } from '../components/PageHeader'
import { StatusPill } from '../components/StatusPill'
import { useAdminApi } from '../context/AdminApiContext'
import { useAdminResource } from '../hooks/useAdminResource'
import { formatDate, humanize, shortId } from '../lib/format'

export function DashboardPage() {
  const api = useAdminApi()
  const load = useCallback((signal: AbortSignal) => api.dashboard(signal), [api])
  const { data, error, loading, reload } = useAdminResource(load)

  return (
    <>
      <PageHeader
        eyebrow="Operational overview"
        title="What needs attention"
        description="Start with reports and stalled work. Recent changes are shown below for quick accountability."
        actions={<button className="button button-secondary" type="button" onClick={reload}>Refresh</button>}
      />
      {loading ? <LoadingState label="Loading operational summary" /> : null}
      {error ? <ErrorState message={error} onRetry={reload} /> : null}
      {data ? (
        <>
          <section className="metric-grid" aria-label="Admin summary">
            <Link className="metric-card metric-card-attention" to="/reports">
              <span>Open reports</span>
              <strong>{data.open_reports}</strong>
              <small>Review oldest first</small>
            </Link>
            <Link className="metric-card" to="/jobs">
              <span>Jobs needing attention</span>
              <strong>{data.jobs_needing_attention}</strong>
              <small>Failed, expired, or stale</small>
            </Link>
            <Link className="metric-card" to="/recipes?status=hidden">
              <span>Hidden recipes</span>
              <strong>{data.hidden_recipes}</strong>
              <small>Reversible holds</small>
            </Link>
            <Link className="metric-card" to="/contributors">
              <span>Hidden contributors</span>
              <strong>{data.hidden_contributors}</strong>
              <small>Account-level visibility holds</small>
            </Link>
          </section>

          <section className="panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Accountability</p>
                <h2>Recent admin actions</h2>
              </div>
              <Link className="text-link" to="/audit">View full history</Link>
            </div>
            {data.recent_actions.length ? (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Action</th>
                      <th scope="col">Target</th>
                      <th scope="col">Reason</th>
                      <th scope="col">When</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recent_actions.map((event) => (
                      <tr key={event.id}>
                        <td><StatusPill value={event.action} /></td>
                        <td>
                          <span className="cell-primary">{humanize(event.target_type)}</span>
                          <code className="cell-secondary">{shortId(event.target_id)}</code>
                        </td>
                        <td className="reason-cell">{event.reason}</td>
                        <td>{formatDate(event.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <p className="panel-empty">No administrative changes have been recorded yet.</p>}
          </section>
        </>
      ) : null}
    </>
  )
}
