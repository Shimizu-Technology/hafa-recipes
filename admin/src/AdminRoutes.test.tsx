import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { AdminRoutes } from './App'
import { AdminApiProvider } from './context/AdminApiContext'
import { mockAdminApi } from './dev/mockApi'

function renderAdmin() {
  return render(
    <MemoryRouter>
      <AdminApiProvider api={mockAdminApi}>
        <AdminRoutes preview />
      </AdminApiProvider>
    </MemoryRouter>,
  )
}

describe('AdminRoutes', () => {
  it('keeps every focused operator area reachable from the primary navigation', async () => {
    const user = userEvent.setup()
    renderAdmin()

    expect(await screen.findByRole('heading', { name: 'What needs attention' })).toBeVisible()
    for (const [link, heading] of [
      ['Reports', 'Reports and appeals'],
      ['Recipes', 'Recipe moderation'],
      ['Contributors', 'Contributor moderation'],
      ['Extraction jobs', 'Extraction jobs'],
      ['Audit history', 'Audit history'],
    ]) {
      await user.click(screen.getByRole('link', { name: link }))
      expect(await screen.findByRole('heading', { name: heading, level: 1 })).toBeVisible()
    }
  })

  it('prevents blank featured placement and no-op recipe audit events', async () => {
    const user = userEvent.setup()
    renderAdmin()
    await user.click(screen.getByRole('link', { name: 'Recipes' }))

    const recipeRow = await screen.findByRole('row', { name: /Chamorro Red Rice/ })
    await user.click(within(recipeRow).getByRole('button', { name: 'Edit status' }))
    const apply = screen.getByRole('button', { name: 'Apply recipe changes' })
    await user.type(screen.getByLabelText(/Reason/), 'Curating the Discover order')
    expect(apply).toBeDisabled()

    await user.clear(screen.getByLabelText('Featured position'))
    expect(screen.getByLabelText('Featured position')).toHaveAttribute('aria-invalid', 'true')
    expect(apply).toBeDisabled()

    await user.type(screen.getByLabelText('Featured position'), '2')
    expect(screen.getByLabelText('Featured position')).toHaveAttribute('aria-invalid', 'false')
    expect(apply).toBeEnabled()
  })
})
