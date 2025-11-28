import { StyleSheet, TouchableOpacity, Linking, Alert, View as RNView, ScrollView } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { View, Text, Card, SectionHeader, Divider, useColors } from '@/components/Themed';
import { useRecipeCount } from '@/hooks/useRecipes';
import { API_BASE_URL } from '@/lib/api';
import { spacing, fontSize, fontWeight, radius } from '@/constants/Colors';

interface MenuItemProps {
  icon: string;
  label: string;
  value?: string;
  onPress?: () => void;
  colors: ReturnType<typeof useColors>;
}

function MenuItem({ icon, label, value, onPress, colors }: MenuItemProps) {
  const content = (
    <RNView 
      style={[
        styles.menuItem, 
        { backgroundColor: colors.backgroundSecondary }
      ]}
    >
      <RNView style={styles.menuItemLeft}>
        <Text style={styles.menuIcon}>{icon}</Text>
        <Text style={[styles.menuLabel, { color: colors.text }]}>{label}</Text>
      </RNView>
      {value ? (
        <Text style={[styles.menuValue, { color: colors.textMuted }]} numberOfLines={1}>
          {value}
        </Text>
      ) : onPress ? (
        <Text style={[styles.menuArrow, { color: colors.textMuted }]}>›</Text>
      ) : null}
    </RNView>
  );

  if (onPress) {
    return (
      <TouchableOpacity onPress={onPress} activeOpacity={0.7}>
        {content}
      </TouchableOpacity>
    );
  }

  return content;
}

export default function SettingsScreen() {
  const queryClient = useQueryClient();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { data: countData } = useRecipeCount();

  const handleClearCache = () => {
    Alert.alert(
      'Clear Cache',
      'This will refresh all recipe data from the server.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: () => {
            queryClient.clear();
            Alert.alert('Done', 'Cache cleared successfully');
          },
        },
      ]
    );
  };

  const handleOpenAPI = () => {
    Linking.openURL(`${API_BASE_URL}/docs`);
  };

  return (
    <View style={styles.container}>
      <ScrollView 
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + spacing.xl }]}
      >
        {/* Stats Card */}
        <RNView style={styles.section}>
          <SectionHeader title="Statistics" />
          <RNView style={[styles.statCard, { backgroundColor: colors.tint }]}>
            <Text style={styles.statValue}>{countData?.count ?? '...'}</Text>
            <Text style={styles.statLabel}>Recipes Saved</Text>
          </RNView>
        </RNView>

        {/* Data Section */}
        <RNView style={styles.section}>
          <SectionHeader title="Data" />
          <MenuItem 
            icon="🗑️" 
            label="Clear Cache" 
            onPress={handleClearCache}
            colors={colors}
          />
        </RNView>

        {/* Developer Section */}
        <RNView style={styles.section}>
          <SectionHeader title="Developer" />
          <RNView style={styles.menuGroup}>
            <MenuItem 
              icon="📚" 
              label="API Documentation" 
              onPress={handleOpenAPI}
              colors={colors}
            />
            <RNView style={[styles.menuDivider, { backgroundColor: colors.border }]} />
            <MenuItem 
              icon="🔗" 
              label="API URL" 
              value={API_BASE_URL.replace('http://', '').replace('https://', '')}
              colors={colors}
            />
          </RNView>
        </RNView>

        {/* About Section */}
        <RNView style={styles.section}>
          <SectionHeader title="About" />
          <Card>
            <RNView style={styles.aboutHeader}>
              <Text style={styles.aboutEmoji}>🍳</Text>
              <RNView>
                <Text style={[styles.aboutTitle, { color: colors.text }]}>
                  Recipe Extractor
                </Text>
                <Text style={[styles.aboutVersion, { color: colors.textMuted }]}>
                  Version 1.0.0
                </Text>
              </RNView>
            </RNView>
            
            <Divider />
            
            <Text style={[styles.aboutDescription, { color: colors.textSecondary }]}>
              Transform cooking videos from TikTok, YouTube, and Instagram into 
              detailed, structured recipes using AI.
            </Text>
            
            <Divider />
            
            <Text style={[styles.techLabel, { color: colors.textMuted }]}>
              Powered by
            </Text>
            <RNView style={styles.techList}>
              <Text style={[styles.techItem, { color: colors.textSecondary }]}>
                • OpenAI Whisper
              </Text>
              <Text style={[styles.techItem, { color: colors.textSecondary }]}>
                • GPT-4o-mini
              </Text>
              <Text style={[styles.techItem, { color: colors.textSecondary }]}>
                • FastAPI + React Native
              </Text>
            </RNView>
          </Card>
        </RNView>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    padding: spacing.lg,
  },
  section: {
    marginBottom: spacing.xl,
  },
  statCard: {
    borderRadius: radius.lg,
    padding: spacing.xl,
    alignItems: 'center',
  },
  statValue: {
    fontSize: 56,
    fontWeight: fontWeight.bold,
    color: '#FFFFFF',
  },
  statLabel: {
    fontSize: fontSize.md,
    color: '#FFFFFF',
    opacity: 0.9,
    marginTop: spacing.xs,
  },
  menuGroup: {
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  menuItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: spacing.md,
    borderRadius: radius.md,
    marginBottom: spacing.sm,
  },
  menuItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  menuIcon: {
    fontSize: 18,
  },
  menuLabel: {
    fontSize: fontSize.md,
  },
  menuValue: {
    fontSize: fontSize.sm,
    maxWidth: 150,
  },
  menuArrow: {
    fontSize: 24,
    fontWeight: fontWeight.medium,
  },
  menuDivider: {
    height: 1,
    marginHorizontal: spacing.md,
  },
  aboutHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  aboutEmoji: {
    fontSize: 40,
  },
  aboutTitle: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.semibold,
  },
  aboutVersion: {
    fontSize: fontSize.sm,
    marginTop: 2,
  },
  aboutDescription: {
    fontSize: fontSize.md,
    lineHeight: 22,
  },
  techLabel: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.sm,
  },
  techList: {
    gap: spacing.xs,
  },
  techItem: {
    fontSize: fontSize.sm,
  },
});
