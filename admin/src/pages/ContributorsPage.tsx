import { useCallback, useState, type FormEvent } from 'react'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { EmptyState, ErrorState, LoadingState } from '../components/AsyncState'
import { PageHeader } from '../components/PageHeader'
import { StatusPill } from '../components/StatusPill'
import { useAdminApi } from '../context/AdminApiContext'
import { useToast } from '../context/ToastContext'
import { useAdminResource } from '../hooks/useAdminResource'
import { shortId } from '../lib/format'
import type { ContributorPreview } from '../types'

export function ContributorsPage() {
  const api = useAdminApi()
  const { notify } = useToast()
  const [draft, setDraft] = useState('')
  const [query, setQuery] = useState('')
  const [selection, setSelection] = useState<ContributorPreview | null>(null)
  const load = useCallback((signal: AbortSignal) => api.contributors(query, signal), [api, query])
  const { data, error, loading, reload } = useAdminResource(load)

  const search = (event: FormEvent) => {
    event.preventDefault()
    setQuery(draft.trim())
  }

  const update = async (reason: string) => {
    if (!selection) return
    const next = selection.moderation_status === 'active' ? 'hidden' : 'active'
    await api.updateContributor(selection.contributor_id, next, reason)
    notify(`${selection.display_name} is now ${next}.`)
    setSelection(null)
    reload()
  }

  return (
    <>
      <PageHeader
        eyebrow="Reversible account holds"
        title="Contributor moderation"
        description="Search contributors with intentionally public recipes. Hiding a contributor removes those recipes from non-owner surfaces without deleting evidence."
        actions={<button className="button button-secondary" type="button" onClick={reload}>Refresh</button>}
      />
      <form className="filter-bar" onSubmit={search}>
        <div className="compact-field compact-field-grow">
          <label htmlFor="contributor-search">Display name</label>
          <input id="contributor-search" type="search" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Search contributor display names" maxLength={100} />
        </div>
        <button className="button button-primary" type="submit">Search contributors</button>
      </form>
      {loading ? <LoadingState label="Loading contributors" /> : null}
      {error ? <ErrorState message={error} onRetry={reload} /> : null}
      {data?.length === 0 ? <EmptyState title="No matching contributors">Try a broader display-name search.</EmptyState> : null}
      {data?.length ? (
        <section className="panel panel-table" aria-label="Contributor results">
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th scope="col">Contributor</th>
                  <th scope="col">Account visibility</th>
                  <th scope="col">Public recipes</th>
                  <th scope="col">Recipe holds</th>
                  <th scope="col"><span className="visually-hidden">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {data.map((contributor) => (
                  <tr key={contributor.contributor_id}>
                    <td>
                      <span className="cell-primary">{contributor.display_name}</span>
                      <code className="cell-secondary" title={contributor.contributor_id}>{shortId(contributor.contributor_id)}</code>
                    </td>
                    <td><StatusPill value={contributor.moderation_status} /></td>
                    <td>{contributor.public_recipe_count}</td>
                    <td>{contributor.hidden_recipe_count}</td>
                    <td className="action-cell">
                      <button
                        className={`button button-small ${contributor.moderation_status === 'active' ? 'button-quiet-danger' : 'button-secondary'}`}
                        type="button"
                        onClick={() => setSelection(contributor)}
                      >
                        {contributor.moderation_status === 'active' ? 'Hide contributor' : 'Restore contributor'}
                      </button>
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
          title={`${selection.moderation_status === 'active' ? 'Hide' : 'Restore'} ${selection.display_name}`}
          description={selection.moderation_status === 'active'
            ? `This hides all ${selection.public_recipe_count} intentionally public recipes from non-owner views. The contributor and recipes are not deleted.`
            : 'This restores the contributor account. Individual recipe holds and each owner’s sharing choice still apply.'}
          actionLabel={selection.moderation_status === 'active' ? 'Hide contributor' : 'Restore contributor'}
          tone={selection.moderation_status === 'active' ? 'danger' : 'primary'}
          onCancel={() => setSelection(null)}
          onConfirm={update}
        />
      ) : null}
    </>
  )
}
