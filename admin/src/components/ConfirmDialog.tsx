import { useEffect, useId, useRef, useState, type ReactNode } from 'react'

export function ConfirmDialog({
  title,
  description,
  actionLabel,
  canConfirm = true,
  tone = 'primary',
  children,
  onCancel,
  onConfirm,
}: {
  title: string
  description: string
  actionLabel: string
  canConfirm?: boolean
  tone?: 'primary' | 'danger'
  children?: ReactNode
  onCancel: () => void
  onConfirm: (reason: string) => Promise<void>
}) {
  const titleId = useId()
  const descriptionId = useId()
  const reasonId = useId()
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const dialogRef = useRef<HTMLElement>(null)
  const previousFocus = useRef<HTMLElement | null>(null)

  useEffect(() => {
    previousFocus.current = document.activeElement as HTMLElement | null
    inputRef.current?.focus()
    return () => previousFocus.current?.focus()
  }, [])

  useEffect(() => {
    const handleKeyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !submitting) {
        event.preventDefault()
        onCancel()
        return
      }
      if (event.key !== 'Tab') return

      const focusable = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      )
      if (focusable.length === 0) return
      const first = focusable[0]!
      const last = focusable[focusable.length - 1]!
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', handleKeyboard)
    return () => document.removeEventListener('keydown', handleKeyboard)
  }, [onCancel, submitting])

  const submit = async () => {
    const trimmed = reason.trim()
    if (trimmed.length < 3) {
      setError('Enter a reason of at least 3 characters.')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      await onConfirm(trimmed)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The action could not be completed.')
      setSubmitting(false)
    }
  }

  return (
    <div className="dialog-backdrop">
      <section
        ref={dialogRef}
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
      >
        <div className="dialog-heading">
          <div>
            <p className="eyebrow">Confirm admin action</p>
            <h2 id={titleId}>{title}</h2>
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label="Close confirmation"
            onClick={onCancel}
            disabled={submitting}
          >
            ×
          </button>
        </div>
        <p id={descriptionId} className="dialog-description">{description}</p>
        {children}
        <div className="field-group">
          <label htmlFor={reasonId}>Reason <span aria-hidden="true">*</span></label>
          <textarea
            ref={inputRef}
            id={reasonId}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={4}
            maxLength={500}
            placeholder="State the evidence or operational reason for this change."
            aria-describedby={`${reasonId}-hint`}
            disabled={submitting}
          />
          <div className="field-hint" id={`${reasonId}-hint`}>
            Saved permanently in the append-only admin audit history · {reason.length}/500
          </div>
        </div>
        {error ? <p className="inline-error" role="alert">{error}</p> : null}
        <div className="dialog-actions">
          <button className="button button-secondary" type="button" onClick={onCancel} disabled={submitting}>
            Keep unchanged
          </button>
          <button
            className={`button ${tone === 'danger' ? 'button-danger' : 'button-primary'}`}
            type="button"
            onClick={submit}
            disabled={submitting || !canConfirm || reason.trim().length < 3}
          >
            {submitting ? 'Applying…' : actionLabel}
          </button>
        </div>
      </section>
    </div>
  )
}
