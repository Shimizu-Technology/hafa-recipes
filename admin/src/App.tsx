import { SignIn, useAuth } from '@clerk/react'
import { useMemo } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AdminShell } from './components/AdminShell'
import { AdminApiProvider } from './context/AdminApiContext'
import { createAdminApi } from './lib/api'
import { AuditPage } from './pages/AuditPage'
import { ContributorsPage } from './pages/ContributorsPage'
import { CleanupJobsPage } from './pages/CleanupJobsPage'
import { DashboardPage } from './pages/DashboardPage'
import { JobsPage } from './pages/JobsPage'
import { RecipesPage } from './pages/RecipesPage'
import { ReportsPage } from './pages/ReportsPage'

export function AdminRoutes({ preview = false }: { preview?: boolean }) {
  return (
    <Routes>
      <Route element={<AdminShell preview={preview} />}>
        <Route index element={<DashboardPage />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="recipes" element={<RecipesPage />} />
        <Route path="contributors" element={<ContributorsPage />} />
        <Route path="jobs" element={<JobsPage />} />
        <Route path="cleanup" element={<CleanupJobsPage />} />
        <Route path="audit" element={<AuditPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}

function AuthenticatedAdmin() {
  const { getToken, isLoaded, isSignedIn } = useAuth()
  const api = useMemo(() => createAdminApi(getToken), [getToken])

  if (!isLoaded) {
    return (
      <main className="auth-screen" aria-busy="true">
        <span className="spinner spinner-large" aria-hidden="true" />
        <p>Checking your admin session…</p>
      </main>
    )
  }
  if (!isSignedIn) {
    return (
      <main className="auth-screen">
        <section className="auth-intro">
          <img src="/brand-mark.svg" alt="" width="64" height="64" />
          <p className="eyebrow">Restricted operations</p>
          <h1>Håfa Recipes Admin</h1>
          <p>Sign in with an approved operator account. The API independently verifies the admin role on every request.</p>
        </section>
        <SignIn routing="hash" />
      </main>
    )
  }
  return (
    <AdminApiProvider api={api}>
      <AdminRoutes />
    </AdminApiProvider>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthenticatedAdmin />
    </BrowserRouter>
  )
}
