import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, TouchableOpacity, View as RNView } from 'react-native';

import { Text, useColors } from '@/components/Themed';
import { fontFamily, fontSize, radius, spacing } from '@/constants/Colors';
import type { JobStatus } from '@/types/recipe';

const ACTIVE_STATUSES: JobStatus['status'][] = ['queued', 'claimed', 'processing'];

type ImportActivityCardProps = {
  jobs: JobStatus[];
  onOpenRecipe: (job: JobStatus) => void;
  onRestore: (job: JobStatus) => void;
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
      label: job.status === 'queued' ? 'Waiting to start' : `Importing · ${job.progress}%`,
    };
  }
  if (job.recipe_id) {
    const needsReview = job.review_state && job.review_state !== 'ready';
    const isSourceDraft = job.review_state === 'source_incomplete';
    return {
      action: 'open',
      actionLabel: needsReview ? 'Review' : 'Open',
      colorKind: needsReview ? 'warning' : 'success',
      icon: needsReview ? 'search-outline' : 'checkmark-circle-outline',
      label: isSourceDraft ? 'Draft needs details' : needsReview ? 'Ready for review' : 'Ready',
    };
  }
  if (job.status === 'failed' || job.status === 'expired') {
    return {
      action: 'restore',
      actionLabel: 'View options',
      colorKind: 'error',
      icon: job.status === 'expired' ? 'time-outline' : 'alert-circle-outline',
      label: job.status === 'expired' ? 'Expired' : 'Needs attention',
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
  jobs,
  onOpenRecipe,
  onRestore,
}: ImportActivityCardProps) {
  const colors = useColors();
  const visibleJobs = jobs.filter((job) => job.status !== 'cancelled').slice(0, 4);
  if (visibleJobs.length === 0) return null;

  const colorFor = (kind: ImportPresentation['colorKind']) => ({
    success: colors.success,
    warning: colors.warning,
    error: colors.error,
    tint: colors.tint,
    muted: colors.textMuted,
  })[kind];

  return (
    <RNView
      style={[styles.container, { backgroundColor: colors.backgroundElevated, borderColor: colors.border }]}
      accessibilityLabel="Recent link imports"
    >
      <RNView style={styles.headingRow}>
        <RNView style={[styles.headingIcon, { backgroundColor: colors.tint + '14' }]}>
          <Ionicons name="file-tray-full-outline" size={20} color={colors.tint} />
        </RNView>
        <RNView style={styles.headingCopy}>
          <Text style={[styles.title, { color: colors.text }]}>Recent link imports</Text>
          <Text style={[styles.subtitle, { color: colors.textMuted }]}>Your latest imports stay here if you leave the app.</Text>
        </RNView>
      </RNView>

      <RNView style={styles.jobList}>
        {visibleJobs.map((job, index) => {
          const presentation = importJobPresentation(job);
          const statusColor = colorFor(presentation.colorKind);
          const timestamp = job.completed_at || job.updated_at || job.created_at;
          const runAction = () => {
            if (presentation.action === 'open') onOpenRecipe(job);
            if (presentation.action === 'restore') onRestore(job);
          };

          return (
            <RNView
              key={job.id}
              style={[
                styles.jobRow,
                index > 0 && { borderTopColor: colors.borderLight, borderTopWidth: StyleSheet.hairlineWidth },
              ]}
            >
              <RNView style={[styles.statusIcon, { backgroundColor: statusColor + '16' }]}>
                <Ionicons name={presentation.icon} size={19} color={statusColor} />
              </RNView>
              <RNView style={styles.jobCopy}>
                <Text style={[styles.source, { color: colors.text }]} numberOfLines={1}>
                  {importSourceLabel(job.url)}
                </Text>
                <Text style={[styles.status, { color: statusColor }]} numberOfLines={1}>
                  {presentation.label} · {importAgeLabel(timestamp)}
                </Text>
                {ACTIVE_STATUSES.includes(job.status) && (
                  <RNView
                    style={[styles.progressTrack, { backgroundColor: colors.border }]}
                    accessibilityRole="progressbar"
                    accessibilityLabel={`${importSourceLabel(job.url)} import progress`}
                    accessibilityValue={{ min: 0, max: 100, now: job.progress }}
                  >
                    <RNView
                      style={[
                        styles.progressFill,
                        { backgroundColor: colors.tint, width: `${Math.max(2, Math.min(100, job.progress))}%` },
                      ]}
                    />
                  </RNView>
                )}
              </RNView>
              {presentation.action && presentation.actionLabel && (
                <TouchableOpacity
                  style={[styles.action, { borderColor: colors.border }]}
                  onPress={runAction}
                  accessibilityRole="button"
                  accessibilityLabel={`${presentation.actionLabel} ${importSourceLabel(job.url)} import`}
                >
                  <Text style={[styles.actionText, { color: colors.tint }]}>{presentation.actionLabel}</Text>
                </TouchableOpacity>
              )}
            </RNView>
          );
        })}
      </RNView>
    </RNView>
  );
}

const styles = StyleSheet.create({
  container: {
    borderWidth: 1,
    borderRadius: radius.xl,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  headingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  headingIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headingCopy: { flex: 1 },
  title: { fontFamily: fontFamily.semibold, fontSize: fontSize.md },
  subtitle: { fontSize: fontSize.xs, lineHeight: 17, marginTop: 2 },
  jobList: { marginTop: spacing.xs },
  jobRow: {
    minHeight: 68,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  statusIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  jobCopy: { flex: 1, minWidth: 0 },
  source: { fontFamily: fontFamily.semibold, fontSize: fontSize.sm },
  status: { fontSize: fontSize.xs, lineHeight: 18, marginTop: 1 },
  progressTrack: {
    height: 4,
    borderRadius: radius.full,
    overflow: 'hidden',
    marginTop: 5,
  },
  progressFill: { height: '100%', borderRadius: radius.full },
  action: {
    minHeight: 44,
    minWidth: 68,
    borderWidth: 1,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  actionText: { fontFamily: fontFamily.semibold, fontSize: fontSize.xs },
});
