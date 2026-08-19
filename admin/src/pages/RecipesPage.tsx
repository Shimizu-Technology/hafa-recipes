import { useCallback, useState, type FormEvent } from 'react'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { EmptyState, ErrorState, LoadingState } from '../components/AsyncState'
import { PageHeader } from '../components/PageHeader'
import { StatusPill } from '../components/StatusPill'
import { useAdminApi } from '../context/AdminApiContext'
import { useToast } from '../context/ToastContext'
import { useAdminResource } from '../hooks/useAdminResource'
import { formatDate, humanize, shortId } from '../lib/format'
import type { ModerationStatus, RecipePreview } from '../types'

export function RecipesPage() {
  const api = useAdminApi()
  const { notify } = useToast()
  const searchParams = new URLSearchParams(window.location.search)
  const initialStatus = searchParams.get('status') === 'hidden' ? 'hidden' : 'all'
  const [queryDraft, setQueryDraft] = useState('')
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<'all' | ModerationStatus>(initialStatus)
  const [selection, setSelection] = useState<RecipePreview | null>(null)
  const [nextStatus, setNextStatus] = useState<ModerationStatus>('active')
  const [featured, setFeatured] = useState(false)
  const [featuredOrder, setFeaturedOrder] = useState('')
  const load = useCallback(
    (signal: AbortSignal) => api.recipes(query, status, signal),
    [api, query, status],
  )
  const { data, error, loading, reload } = useAdminResource(load)
  const normalizedOrder = featured && featuredOrder.trim() ? Number(featuredOrder) : null
  const featureConfigValid = !featured || (
    nextStatus === 'active'
    && Number.isInteger(normalizedOrder)
    && normalizedOrder !== null
    && normalizedOrder >= 0
    && normalizedOrder <= 100_000
  )
  const hasChanges = selection !== null && (
    selection.moderation_status !== nextStatus
    || selection.is_featured !== (nextStatus === 'active' && featured)
    || selection.featured_order !== (nextStatus === 'active' && featured ? normalizedOrder : null)
  )

  const openSelection = (recipe: RecipePreview) => {
    setNextStatus(recipe.moderation_status)
    setFeatured(recipe.is_featured)
    setFeaturedOrder(recipe.featured_order?.toString() || '')
    setSelection(recipe)
  }

  const search = (event: FormEvent) => {
    event.preventDefault()
    setQuery(queryDraft.trim())
  }

  const update = async (reason: string) => {
    if (!selection) return
    const order = nextStatus === 'active' && featured ? normalizedOrder : null
    if (!featureConfigValid || (featured && order === null)) {
      throw new Error('Featured position must be a whole number from 0 through 100,000.')
    }
    await api.updateRecipe(selection.id, {
      moderation_status: nextStatus,
      is_featured: nextStatus === 'active' && featured,
      featured_order: order,
      reason,
    })
    notify('Recipe moderation and placement updated.')
    setSelection(null)
    reload()
  }

  return (
    <>
      <PageHeader
        eyebrow="Public metadata only"
        title="Recipe moderation"
        description="Find intentionally public recipes, apply reversible visibility holds, and curate featured placement. Private recipe contents are never shown here."
        actions={<button className="button button-secondary" type="button" onClick={reload}>Refresh</button>}
      />
      <form className="filter-bar" onSubmit={search}>
        <div className="compact-field compact-field-grow">
          <label htmlFor="recipe-search">Recipe title</label>
          <input id="recipe-search" type="search" value={queryDraft} onChange={(event) => setQueryDraft(event.target.value)} placeholder="Search public recipe titles" maxLength={100} />
        </div>
        <div className="compact-field">
          <label htmlFor="recipe-status">Visibility</label>
          <select id="recipe-status" value={status} onChange={(event) => setStatus(event.target.value as 'all' | ModerationStatus)}>
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="hidden">Hidden</option>
          </select>
        </div>
        <button className="button button-primary" type="submit">Search recipes</button>
      </form>
      {loading ? <LoadingState label="Loading recipes" /> : null}
      {error ? <ErrorState message={error} onRetry={reload} /> : null}
      {data?.length === 0 ? <EmptyState title="No matching recipes">Try a broader title or visibility filter.</EmptyState> : null}
      {data?.length ? (
        <section className="panel panel-table" aria-label="Recipe results">
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th scope="col">Recipe</th>
                  <th scope="col">Contributor</th>
                  <th scope="col">Visibility</th>
                  <th scope="col">Featured</th>
                  <th scope="col">Created</th>
                  <th scope="col"><span className="visually-hidden">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {data.map((recipe) => (
                  <tr key={recipe.id}>
                    <td>
                      <span className="cell-primary">{recipe.title}</span>
                      <span className="cell-secondary">{humanize(recipe.source_type)} · {shortId(recipe.id)}</span>
                    </td>
                    <td>{recipe.display_name}</td>
                    <td><StatusPill value={recipe.moderation_status} /></td>
                    <td>{recipe.is_featured ? <span>Position {recipe.featured_order}</span> : <span className="muted-text">Not featured</span>}</td>
                    <td>{formatDate(recipe.created_at)}</td>
                    <td className="action-cell">
                      <button className="button button-small button-secondary" type="button" onClick={() => openSelection(recipe)}>
                        Edit status
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
          title={`Update “${selection.title}”`}
          description="A hidden recipe disappears from all non-owner surfaces but is not deleted. Featured position controls the order in default and popular Discover views."
          actionLabel="Apply recipe changes"
          canConfirm={hasChanges && featureConfigValid}
          tone={nextStatus === 'hidden' ? 'danger' : 'primary'}
          onCancel={() => setSelection(null)}
          onConfirm={update}
        >
          <div className="dialog-fields-grid">
            <div className="field-group">
              <label htmlFor="next-recipe-status">Moderation status</label>
              <select
                id="next-recipe-status"
                value={nextStatus}
                onChange={(event) => {
                  const value = event.target.value as ModerationStatus
                  setNextStatus(value)
                  if (value === 'hidden') setFeatured(false)
                }}
              >
                <option value="active">Active and eligible for public display</option>
                <option value="hidden">Hidden from non-owners</option>
              </select>
            </div>
            <label className={`checkbox-row ${nextStatus === 'hidden' ? 'checkbox-row-disabled' : ''}`}>
              <input type="checkbox" checked={featured} onChange={(event) => setFeatured(event.target.checked)} disabled={nextStatus === 'hidden'} />
              <span>
                <strong>Feature this recipe</strong>
                <small>Featured recipes appear first in Discover.</small>
              </span>
            </label>
            {featured && nextStatus === 'active' ? (
              <div className="field-group">
                <label htmlFor="featured-order">Featured position</label>
                <input
                  id="featured-order"
                  type="number"
                  min="0"
                  max="100000"
                  step="1"
                  value={featuredOrder}
                  onChange={(event) => setFeaturedOrder(event.target.value)}
                  placeholder="0"
                  aria-invalid={!featureConfigValid}
                  aria-describedby="featured-order-hint"
                />
                <span className="field-hint" id="featured-order-hint">
                  {featureConfigValid
                    ? 'Lower numbers appear first. Each position must be unique.'
                    : 'Enter a whole number from 0 through 100,000.'}
                </span>
              </div>
            ) : null}
            {!hasChanges ? <p className="dialog-guidance">Change visibility or featured placement before applying.</p> : null}
          </div>
        </ConfirmDialog>
      ) : null}
    </>
  )
}
