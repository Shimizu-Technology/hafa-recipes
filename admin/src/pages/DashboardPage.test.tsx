import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { AdminApiProvider } from '../context/AdminApiContext'
import { mockAdminApi } from '../dev/mockApi'
import { DashboardPage } from './DashboardPage'

describe('DashboardPage', () => {
  it('shows the actionable operational counts', async () => {
    render(
      <MemoryRouter>
        <AdminApiProvider api={mockAdminApi}>
          <DashboardPage />
        </AdminApiProvider>
      </MemoryRouter>,
    )

    expect(await screen.findByText('Open reports')).toBeVisible()
    expect(screen.getByText('Jobs needing attention')).toBeVisible()
    expect(screen.getByRole('link', { name: /Open reports/ })).toHaveAttribute('href', '/reports')
  })
})
