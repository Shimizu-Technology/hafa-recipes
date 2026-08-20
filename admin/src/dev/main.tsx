import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { AdminRoutes } from '../App'
import { AdminApiProvider } from '../context/AdminApiContext'
import { mockAdminApi } from './mockApi'
import '../styles.css'

const initialEntry = window.location.hash.replace(/^#/, '') || '/'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MemoryRouter initialEntries={[initialEntry]}>
      <AdminApiProvider api={mockAdminApi}>
        <AdminRoutes preview />
      </AdminApiProvider>
    </MemoryRouter>
  </StrictMode>,
)
