import type { ReactNode } from 'react'

export function LoadingState({ label = 'Loading records' }: { label?: string }) {
  return (
    <div className="state-panel" role="status">
      <span className="spinner" aria-hidden="true" />
      <span>{label}…</span>
    </div>
  )
}

export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="state-panel state-error" role="alert">
      <div>
        <strong>Couldn’t load this view</strong>
        <p>{message}</p>
      </div>
      <button className="button button-secondary" type="button" onClick={onRetry}>
        Try again
      </button>
    </div>
  )
}

export function EmptyState({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="empty-state">
      <div className="empty-mark" aria-hidden="true">✓</div>
      <h2>{title}</h2>
      <p>{children}</p>
    </div>
  )
}
