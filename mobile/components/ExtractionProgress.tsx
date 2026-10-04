import { StyleSheet, View } from 'react-native';
import { Text, useColors } from './Themed';
import { fontSize, spacing } from '@/constants/Colors';

interface ExtractionProgressProps {
  progress: number; currentStep: string; message: string; elapsedTime: number;
  error?: string | null; terminalStatus?: 'failed' | 'cancelled' | 'expired' | null;
  connectionNotice?: string | null; isRetrying?: boolean; nextAttemptAt?: string | null;
  attemptCount?: number; maxAttempts?: number; isWebsite?: boolean;
  lowConfidence?: boolean; confidenceWarning?: string | null;
}

/** Optional import details. Stage percentages are not reliable time estimates. */
export default function ExtractionProgress(props: ExtractionProgressProps) {
  const colors = useColors();
  const elapsed = Math.max(0, Math.floor(props.elapsedTime));
  const duration = elapsed >= 60 ? `${Math.floor(elapsed / 60)}m ${elapsed % 60}s` : `${elapsed}s`;
  return <View style={[styles.details, { borderTopColor: colors.border }]}>
    {props.message && <Text style={[styles.copy, { color: colors.textSecondary }]}>{props.message}</Text>}
    {props.connectionNotice && <Text style={[styles.copy, { color: colors.textSecondary }]}>{props.connectionNotice}</Text>}
    {props.error && <Text style={[styles.copy, { color: colors.error }]}>{props.error}</Text>}
    {props.isRetrying && <Text style={[styles.copy, { color: colors.textSecondary }]}>
      Retrying automatically{props.maxAttempts ? ` · Attempt ${Math.min(props.attemptCount || 0, props.maxAttempts)} of ${props.maxAttempts}` : ''}
    </Text>}
    {props.currentStep === 'complete' && props.lowConfidence && props.confidenceWarning &&
      <Text style={[styles.copy, { color: colors.textSecondary }]}>{props.confidenceWarning}</Text>}
    <Text style={[styles.copy, { color: colors.textMuted }]}>Elapsed · {duration}</Text>
  </View>;
}

const styles = StyleSheet.create({
  details: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: spacing.sm, gap: spacing.sm },
  copy: { fontSize: fontSize.sm, lineHeight: 20 },
});
