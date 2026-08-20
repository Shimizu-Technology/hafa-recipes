import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View as RNView,
} from 'react-native';
import { Stack } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useAuth } from '@clerk/expo';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SafetyActionModal } from '@/components/SafetyActionModal';
import { SignInRequiredView } from '@/components/SignInRequiredView';
import { Card, Text, View, useColors } from '@/components/Themed';
import { fontSize, fontWeight, radius, spacing } from '@/constants/Colors';
import {
  useBlockedContributors,
  useCreateSafetyAppeal,
  useMySafetyReports,
  useSafetyStatus,
  useUnblockContributor,
} from '@/hooks/useCommunitySafety';
import {
  REPORT_CATEGORY_OPTIONS,
  REVIEW_STATUS_LABELS,
  formatSafetyItemTitle,
  getSafetyErrorMessage,
} from '@/lib/communitySafety';

export default function SafetyCenterScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { isSignedIn } = useAuth();
  const [showAccountAppeal, setShowAccountAppeal] = useState(false);
  const reportsQuery = useMySafetyReports(!!isSignedIn);
  const blocksQuery = useBlockedContributors(!!isSignedIn);
  const statusQuery = useSafetyStatus(!!isSignedIn);
  const appealMutation = useCreateSafetyAppeal();
  const unblockMutation = useUnblockContributor();

  if (!isSignedIn) {
    return (
      <>
        <Stack.Screen options={{ title: 'Safety Center' }} />
        <SignInRequiredView
          icon="shield-checkmark-outline"
          title="Sign in for safety controls"
          message="Track reports, manage blocked contributors, and submit appeals from your account."
        />
      </>
    );
  }

  const isRefreshing = reportsQuery.isRefetching || blocksQuery.isRefetching || statusQuery.isRefetching;
  const refresh = () => Promise.all([
    reportsQuery.refetch(),
    blocksQuery.refetch(),
    statusQuery.refetch(),
  ]);

  const handleUnblock = (contributorId: string, displayName: string) => {
    Alert.alert(
      `Unblock ${displayName}?`,
      'Their public recipes can appear in Discover and search again.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Unblock',
          onPress: async () => {
            try {
              await unblockMutation.mutateAsync(contributorId);
            } catch (error) {
              Alert.alert('Couldn’t unblock contributor', getSafetyErrorMessage(error));
            }
          },
        },
      ],
    );
  };

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: 'Safety Center' }} />
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={refresh} tintColor={colors.tint} />}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xl }]}
      >
        <RNView style={styles.intro}>
          <RNView style={[styles.heroIcon, { backgroundColor: colors.accentSoft }]}>
            <Ionicons name="shield-checkmark-outline" size={26} color={colors.accent} />
          </RNView>
          <RNView style={styles.introCopy}>
            <Text style={[styles.title, { color: colors.text }]}>Your safety controls</Text>
            <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
              Reports are private. Blocking changes only what you see and can be reversed anytime.
            </Text>
          </RNView>
        </RNView>

        {statusQuery.data?.account_moderation_status === 'hidden' && (
          <Card style={[styles.holdCard, { borderColor: colors.warning }]}>
            <RNView style={styles.cardHeaderRow}>
              <Ionicons name="alert-circle-outline" size={22} color={colors.warning} />
              <Text style={[styles.cardTitle, { color: colors.text }]}>Your public profile is on hold</Text>
            </RNView>
            <Text style={[styles.cardCopy, { color: colors.textSecondary }]}>
              Your recipes remain available to you but are hidden from public surfaces while the hold is active.
            </Text>
            <TouchableOpacity
              onPress={() => setShowAccountAppeal(true)}
              style={[styles.secondaryButton, { borderColor: colors.tint }]}
            >
              <Text style={[styles.secondaryButtonText, { color: colors.tint }]}>Appeal account hold</Text>
            </TouchableOpacity>
          </Card>
        )}

        <RNView style={styles.section}>
          <RNView style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Blocked contributors</Text>
            <Text style={[styles.sectionCount, { color: colors.textMuted }]}>{blocksQuery.data?.length ?? 0}</Text>
          </RNView>
          {blocksQuery.isLoading ? (
            <ActivityIndicator color={colors.tint} style={styles.loader} />
          ) : blocksQuery.isError ? (
            <ErrorCard message="Couldn’t load blocked contributors." onRetry={() => blocksQuery.refetch()} />
          ) : blocksQuery.data?.length ? (
            <RNView style={[styles.listCard, { backgroundColor: colors.backgroundSecondary, borderColor: colors.border }]}>
              {blocksQuery.data.map((contributor, index) => (
                <RNView key={contributor.contributor_id}>
                  {index > 0 && <RNView style={[styles.divider, { backgroundColor: colors.border }]} />}
                  <RNView style={styles.listRow}>
                    <RNView style={[styles.personIcon, { backgroundColor: `${colors.tint}14` }]}>
                      <Ionicons name="person-outline" size={18} color={colors.tint} />
                    </RNView>
                    <RNView style={styles.rowCopy}>
                      <Text style={[styles.rowTitle, { color: colors.text }]} numberOfLines={1}>
                        {contributor.display_name}
                      </Text>
                      <Text style={[styles.rowMeta, { color: colors.textMuted }]}>Public recipes hidden</Text>
                    </RNView>
                    <TouchableOpacity
                      onPress={() => handleUnblock(contributor.contributor_id, contributor.display_name)}
                      disabled={unblockMutation.isPending}
                      accessibilityRole="button"
                      accessibilityLabel={`Unblock ${contributor.display_name}`}
                      style={[styles.inlineButton, { borderColor: colors.border }]}
                    >
                      <Text style={[styles.inlineButtonText, { color: colors.text }]}>Unblock</Text>
                    </TouchableOpacity>
                  </RNView>
                </RNView>
              ))}
            </RNView>
          ) : (
            <EmptyCard icon="people-outline" message="You haven’t blocked anyone." />
          )}
        </RNView>

        <RNView style={styles.section}>
          <RNView style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Reports and appeals</Text>
            <Text style={[styles.sectionCount, { color: colors.textMuted }]}>{reportsQuery.data?.length ?? 0}</Text>
          </RNView>
          {reportsQuery.isLoading ? (
            <ActivityIndicator color={colors.tint} style={styles.loader} />
          ) : reportsQuery.isError ? (
            <ErrorCard message="Couldn’t load your report history." onRetry={() => reportsQuery.refetch()} />
          ) : reportsQuery.data?.length ? (
            <RNView style={[styles.listCard, { backgroundColor: colors.backgroundSecondary, borderColor: colors.border }]}>
              {reportsQuery.data.map((report, index) => {
                const categoryLabel = report.category === 'appeal'
                  ? 'Appeal'
                  : REPORT_CATEGORY_OPTIONS.find((item) => item.value === report.category)?.label ?? 'Report';
                return (
                  <RNView key={report.id}>
                    {index > 0 && <RNView style={[styles.divider, { backgroundColor: colors.border }]} />}
                    <RNView style={styles.reportRow}>
                      <RNView style={styles.rowCopy}>
                        <Text style={[styles.rowTitle, { color: colors.text }]}>{formatSafetyItemTitle(report)}</Text>
                        <Text style={[styles.rowMeta, { color: colors.textMuted }]}>
                          {categoryLabel} · {new Date(report.created_at).toLocaleDateString()}
                        </Text>
                      </RNView>
                      <RNView style={[styles.statusPill, { backgroundColor: `${colors.accent}18` }]}>
                        <Text style={[styles.statusText, { color: colors.accent }]}>
                          {REVIEW_STATUS_LABELS[report.status]}
                        </Text>
                      </RNView>
                    </RNView>
                  </RNView>
                );
              })}
            </RNView>
          ) : (
            <EmptyCard icon="checkmark-circle-outline" message="No reports or appeals yet." />
          )}
        </RNView>
      </ScrollView>

      <SafetyActionModal
        visible={showAccountAppeal}
        mode="appeal"
        targetType="contributor"
        targetLabel="Your public contributor profile"
        isSubmitting={appealMutation.isPending}
        onClose={() => setShowAccountAppeal(false)}
        onSubmit={async ({ details }) => {
          try {
            await appealMutation.mutateAsync({ target_type: 'contributor', details });
            setShowAccountAppeal(false);
            Alert.alert('Appeal submitted', 'You can track its status here in the Safety Center.');
          } catch (error) {
            Alert.alert('Couldn’t submit appeal', getSafetyErrorMessage(error));
          }
        }}
      />
    </View>
  );
}

function EmptyCard({ icon, message }: { icon: keyof typeof Ionicons.glyphMap; message: string }) {
  const colors = useColors();
  return (
    <RNView style={[styles.emptyCard, { backgroundColor: colors.backgroundSecondary, borderColor: colors.border }]}>
      <Ionicons name={icon} size={22} color={colors.textMuted} />
      <Text style={[styles.emptyText, { color: colors.textMuted }]}>{message}</Text>
    </RNView>
  );
}

function ErrorCard({ message, onRetry }: { message: string; onRetry: () => void }) {
  const colors = useColors();
  return (
    <RNView style={[styles.emptyCard, { backgroundColor: colors.backgroundSecondary, borderColor: colors.border }]}>
      <Text style={[styles.emptyText, { color: colors.textSecondary }]}>{message}</Text>
      <TouchableOpacity onPress={onRetry}>
        <Text style={[styles.retryText, { color: colors.tint }]}>Try again</Text>
      </TouchableOpacity>
    </RNView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: spacing.md, gap: spacing.xl },
  intro: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, paddingTop: spacing.sm },
  heroIcon: { width: 48, height: 48, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  introCopy: { flex: 1, gap: spacing.xs },
  title: { fontSize: fontSize.xl, fontWeight: fontWeight.bold },
  subtitle: { fontSize: fontSize.sm, lineHeight: 20 },
  holdCard: { gap: spacing.md },
  cardHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  cardTitle: { fontSize: fontSize.md, fontWeight: fontWeight.semibold, flex: 1 },
  cardCopy: { fontSize: fontSize.sm, lineHeight: 20 },
  secondaryButton: { minHeight: 44, borderWidth: 1, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  secondaryButtonText: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold },
  section: { gap: spacing.sm },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitle: { fontSize: fontSize.lg, fontWeight: fontWeight.semibold },
  sectionCount: { fontSize: fontSize.sm },
  loader: { paddingVertical: spacing.xl },
  listCard: { borderWidth: 1, borderRadius: radius.lg, overflow: 'hidden' },
  divider: { height: StyleSheet.hairlineWidth, marginLeft: 60 },
  listRow: { minHeight: 70, flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md },
  reportRow: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md },
  personIcon: { width: 36, height: 36, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center' },
  rowCopy: { flex: 1, gap: 3 },
  rowTitle: { fontSize: fontSize.md, fontWeight: fontWeight.medium },
  rowMeta: { fontSize: fontSize.xs },
  inlineButton: { borderWidth: 1, borderRadius: radius.full, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  inlineButtonText: { fontSize: fontSize.sm, fontWeight: fontWeight.medium },
  statusPill: { borderRadius: radius.full, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  statusText: { fontSize: fontSize.xs, fontWeight: fontWeight.semibold },
  emptyCard: { minHeight: 76, borderWidth: 1, borderRadius: radius.lg, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.md },
  emptyText: { fontSize: fontSize.sm, textAlign: 'center' },
  retryText: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold },
});
