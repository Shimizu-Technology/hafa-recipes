import { useAuth } from '@clerk/expo';
import { SignInBanner } from '@/components/SignInBanner';
import { useRouter } from 'expo-router';
import { ScrollView, View, Pressable, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Text, useColors } from '@/components/Themed';

const entries = [
  { title: 'Paste a link', icon: 'link-outline', route: '/' },
  { title: 'Scan a cookbook page', icon: 'scan-outline', route: '/?entry=scan' },
  { title: 'Choose photos', icon: 'images-outline', route: '/?entry=photos' },
  { title: 'Type it in', icon: 'create-outline', route: '/add-recipe' },
] as const;

export default function AddRecipeOptions() {
  const colors = useColors();
  const { isSignedIn } = useAuth();
  const router = useRouter();
  return <ScrollView contentInsetAdjustmentBehavior="automatic" style={{ backgroundColor: colors.groupedBackground }} contentContainerStyle={styles.content}>
    {!isSignedIn && <SignInBanner message="Sign in to add a recipe" />}
    <View style={[styles.group, { backgroundColor: colors.backgroundElevated }]}>
      {entries.map(({ title, icon, route }, index) => <Pressable key={title} accessibilityRole="button" accessibilityLabel={title} disabled={!isSignedIn} accessibilityState={{ disabled: !isSignedIn }} onPress={isSignedIn ? () => router.replace(route) : undefined} style={({ pressed }) => [styles.row, { opacity: !isSignedIn ? 0.5 : pressed ? 0.65 : 1 }]}>
        <Ionicons name={icon} size={22} color={colors.actionText} />
        <View style={[styles.label, index < entries.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }]}>
          <Text style={{ flex: 1 }}>{title}</Text>
          <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
        </View>
      </Pressable>)}
    </View>
    <Text style={{ fontSize: 13, lineHeight: 18, color: colors.textSecondary, paddingHorizontal: 16 }}>Tip: share straight from TikTok, Instagram or Safari.</Text>
  </ScrollView>;
}
const styles = StyleSheet.create({
  content: { padding: 16, gap: 16, paddingBottom: 32 },
  group: { borderRadius: 12, overflow: 'hidden' },
  row: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 16, paddingLeft: 16 },
  label: { flex: 1, minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingRight: 16 },
});
