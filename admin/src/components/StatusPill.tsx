import { humanize } from '../lib/format'

const positive = new Set(['active', 'resolved', 'completed', 'live'])
const attention = new Set(['open', 'reviewing', 'queued', 'processing', 'claimed', 'stale'])
const negative = new Set(['hidden', 'failed', 'expired', 'cancelled'])

export function StatusPill({ value }: { value: string }) {
  const normalized = value.toLowerCase()
  const tone = positive.has(normalized)
    ? 'positive'
    : attention.has(normalized)
      ? 'attention'
      : negative.has(normalized)
        ? 'negative'
        : 'neutral'
  return <span className={`status-pill status-${tone}`}>{humanize(value)}</span>
}
