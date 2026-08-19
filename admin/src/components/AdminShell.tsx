import { NavLink, Outlet } from 'react-router-dom'
import { UserButton } from '@clerk/react'
import { ToastProvider } from '../context/ToastContext'

const navigation = [
  { to: '/', label: 'Overview', end: true },
  { to: '/reports', label: 'Reports' },
  { to: '/recipes', label: 'Recipes' },
  { to: '/contributors', label: 'Contributors' },
  { to: '/jobs', label: 'Extraction jobs' },
  { to: '/audit', label: 'Audit history' },
]

export function AdminShell({ preview = false }: { preview?: boolean }) {
  return (
    <ToastProvider>
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <div className="app-shell">
        <aside className="sidebar" aria-label="Admin navigation">
          <div className="brand-block">
            <img src="/brand-mark.svg" alt="" width="44" height="44" />
            <div>
              <strong>Håfa Recipes</strong>
              <span>Admin operations</span>
            </div>
          </div>
          <nav className="sidebar-nav">
            {navigation.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) => (isActive ? 'nav-link nav-link-active' : 'nav-link')}
              >
                <span className="nav-dot" aria-hidden="true" />
                {item.label}
              </NavLink>
            ))}
          </nav>
          <div className="sidebar-footer">
            <span className="environment-chip">{preview ? 'UI preview' : 'Production controls'}</span>
            <p>Every change requires a reason and is audited.</p>
          </div>
        </aside>
        <div className="content-column">
          <header className="topbar">
            <div>
              <span className="system-state"><span aria-hidden="true" /> Server authorization required</span>
            </div>
            {preview ? <span className="preview-person">Preview operator</span> : <UserButton />}
          </header>
          <main id="main-content" className="main-content" tabIndex={-1}>
            <Outlet />
          </main>
        </div>
      </div>
    </ToastProvider>
  )
}
