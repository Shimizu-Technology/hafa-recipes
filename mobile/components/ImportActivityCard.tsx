import type { ReactNode } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, TouchableOpacity, View as RNView } from 'react-native';

import { Card, Text, useColors } from '@/components/Themed';
import { fontFamily, fontSize, radius, spacing } from '@/constants/Colors';
import type { JobStatus } from '@/types/recipe';

const ACTIVE_STATUSES: JobStatus['status'][] = ['queued', 'claimed', 'processing'];

type ImportActivityCardProps = {
  jobs: JobStatus[];
  captures?: { id: string; createdAt: number; content: ReactNode }[];
  active?: { id: string; createdAt: number; content: ReactNode } | null;
  onOpenRecipe: (job: JobStatus) => void;
  onRestore: (job: JobStatus) => void;
  onCancel?: (job: JobStatus) => void;
};

type ImportPresentation = {
  action: 'open' | 'restore' | null;
  actionLabel: string | null;
  colorKind: 'success' | 'warning' | 'error' | 'tint' | 'muted';
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
};

export function importSourceLabel(sourceUrl: string): string {
  try {
    const hostname = new URL(sourceUrl).hostname.toLowerCase().replace(/^www\./, '');
    if (hostname === 'youtu.be' || hostname.endsWith('youtube.com')) return 'YouTube';
    if (hostname.endsWith('tiktok.com')) return 'TikTok';
    if (hostname.endsWith('instagram.com')) return 'Instagram';
    return hostname || 'Recipe website';
  } catch {
    return 'Recipe link';
  }
}

export function importSourceDetail(sourceUrl: string): string {
  try {
    const url = new URL(sourceUrl);
    let path = url.pathname;
    try { path = decodeURIComponent(path); } catch { /* Keep an invalid escape encoded. */ }
    path = path.replace(/^\/+|\/+$/g, '');
    const hostname = url.hostname.toLowerCase();
    const videoId = (hostname === 'youtube.com' || hostname.endsWith('.youtube.com'))
      ? url.searchParams.get('v') : null;
    return videoId ? `${path} · ${videoId}` : path || url.hostname;
  } catch {
    return 'Recipe link';
  }
}

export function importAgeLabel(timestamp?: string, now = Date.now()): string {
  if (!timestamp) return 'Recently';
  const parsed = new Date(timestamp).getTime();
  if (!Number.isFinite(parsed)) return 'Recently';
  const minutes = Math.max(0, Math.floor((now - parsed) / 60_000));
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? 'Yesterday' : `${days}d ago`;
}

export function importJobPresentation(job: JobStatus): ImportPresentation {
  if (ACTIVE_STATUSES.includes(job.status)) {
    return {
      action: 'restore',
      actionLabel: 'View progress',
      colorKind: 'tint',
      icon: 'hourglass-outline',
      label: job.status === 'queued' ? 'Waiting' : `Importing · ${job.progress}%`,
    };
  }
  if (job.recipe_id) {
    const needsReview = job.review_state && job.review_state !== 'ready';
    const isSourceDraft = job.review_state === 'source_incomplete';
    return {
      action: 'open',
      actionLabel: 'Open recipe',
      colorKind: needsReview ? 'warning' : 'success',
      icon: needsReview ? 'search-outline' : 'checkmark-circle-outline',
      label: isSourceDraft ? 'Draft saved' : needsReview ? 'Saved · Some details uncertain' : 'Saved',
    };
  }
  if (job.status === 'failed' || job.status === 'expired') {
    return {
      action: 'restore',
      actionLabel: 'View options',
      colorKind: 'error',
      icon: job.status === 'expired' ? 'time-outline' : 'alert-circle-outline',
      label: job.status === 'expired' ? 'Needs help · Expired' : 'Needs help',
    };
  }
  return {
    action: null,
    actionLabel: null,
    colorKind: 'muted',
    icon: 'remove-circle-outline',
    label: job.status === 'cancelled' ? 'Cancelled' : 'Finished',
  };
}

/** A compact, explicit recovery surface for recent durable link imports. */
export function ImportActivityCard({
  jobs, captures = [], active,
  onOpenRecipe,
  onRestore,
  onCancel,
}: ImportActivityCardProps) {
  const colors = useColors();
  const visibleJobs = jobs.filter((job) => job.status !== 'cancelled' && job.id !== active?.id &&
    !captures.some((capture) => capture.id === job.id));
  const rows = [
    ...visibleJobs.map((job) => ({ id: job.id, createdAt: Date.parse(job.created_at || '') || 0, job })),
    ...captures.filter(capture => capture.id !== active?.id), ...(active ? [active] : []),
  ].sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id));
  if (!rows.length) return null;

  const colorFor = (kind: ImportPresentation['colorKind']) => ({
    success: colors.success, warning: colors.warning, error: colors.error,
    // Status words are text, so they use the readable accent (actionText), not the fill colour.
    tint: colors.actionText, muted: colors.textMuted,
  })[kind];

  const renderJob = (job: JobStatus) => {
    const presentation = importJobPresentation(job);
    const statusColor = colorFor(presentation.colorKind);
    const detail = importSourceDetail(job.url);
    return (
      <RNView key={job.id}>
        <TouchableOpacity disabled={!presentation.action}
          accessibilityRole={presentation.action ? 'button' : undefined}
          accessibilityLabel={presentation.actionLabel ? `${presentation.actionLabel} ${importSourceLabel(job.url)} import, ${detail}` : undefined}
          accessibilityHint={presentation.label}
          onPress={() => {
            if (presentation.action === 'open') onOpenRecipe(job);
            if (presentation.action === 'restore') onRestore(job);
          }} style={styles.jobRow}>
          <Ionicons name={presentation.icon} size={20} color={statusColor} />
          <RNView style={styles.jobCopy}>
            <Text style={[styles.source, { color: colors.text }]}>{importSourceLabel(job.url)}</Text>
            <Text numberOfLines={2} style={[styles.status, { color: colors.textSecondary }]}>{detail}</Text>
            <Text style={[styles.status, { color: statusColor }]}>{presentation.label}</Text>
            {ACTIVE_STATUSES.includes(job.status) && (
              <RNView style={[styles.progressTrack, { backgroundColor: colors.border }]}
                accessibilityRole="progressbar" accessibilityLabel={`${importSourceLabel(job.url)} import progress`}
                accessibilityValue={{ min: 0, max: 100, now: job.progress }}>
                <RNView style={[styles.progressFill, { backgroundColor: colors.tint, width: `${Math.max(2, Math.min(100, job.progress))}%` }]} />
              </RNView>
            )}
          </RNView>
          <Text style={[styles.age, { color: colors.textMuted }]}>{importAgeLabel(job.completed_at || job.updated_at || job.created_at)}</Text>
          {presentation.action && <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />}
        </TouchableOpacity>
        {onCancel && (ACTIVE_STATUSES.includes(job.status) || (!job.recipe_id && (job.status === 'failed' || job.status === 'expired'))) &&
          <TouchableOpacity onPress={() => onCancel(job)} style={styles.cancelAction} accessibilityRole="button"
            accessibilityLabel={`${ACTIVE_STATUSES.includes(job.status) ? 'Cancel import' : 'Remove unfinished import'} ${importSourceLabel(job.url)}, ${detail}`}>
            <Text style={[styles.status, { color: colors.textSecondary }]}>{ACTIVE_STATUSES.includes(job.status) ? 'Cancel import' : 'Remove unfinished import'}</Text>
          </TouchableOpacity>}
      </RNView>
    );
  };

  return <RNView style={styles.container}>
    <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>Imports</Text>
    <Card noPadding style={styles.card}>
    {rows.map((row, index) => <RNView key={row.id}>
      {index > 0 && <RNView style={[styles.separator, { backgroundColor: colors.border }]} />}
      {'job' in row ? renderJob(row.job) : row.content}
    </RNView>)}
    </Card>
  </RNView>;

}

const styles = StyleSheet.create({
  container: { marginBottom: spacing.md },
  card: { borderRadius: 12, overflow: 'hidden' },
  separator: { height: StyleSheet.hairlineWidth, marginLeft: 48, marginRight: 16 },
  unfinished: { borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm },
  title: { fontFamily: fontFamily.semibold, fontWeight: '600', fontSize: fontSize.md, marginBottom: spacing.sm },
  historyToggle: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 48 },
  historyTitle: { flex: 1, fontFamily: fontFamily.semibold, fontWeight: '600', fontSize: fontSize.sm },
  jobRow: { minHeight: 64, flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingHorizontal: 16, paddingVertical: 12 },
  cancelAction: { marginLeft: 48, marginRight: 16, minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  jobCopy: { flex: 1, minWidth: 0 },
  source: { fontFamily: fontFamily.semibold, fontWeight: '600', fontSize: 17, lineHeight: 24 },
  status: { fontSize: 15, lineHeight: 21, marginTop: 4 },
  age: { fontSize: 13, lineHeight: 24, maxWidth: 72 },
  progressTrack: { height: 4, borderRadius: radius.full, overflow: 'hidden', marginTop: 5 },
  progressFill: { height: '100%', borderRadius: radius.full },
});
