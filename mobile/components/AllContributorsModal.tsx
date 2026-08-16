/**
 * Modal showing all contributors with search functionality.
 * Allows users to find and filter recipes by any contributor.
 */

import React, { useState, useMemo } from 'react';
import {
  StyleSheet,
  Modal,
  TouchableOpacity,
  FlatList,
  View as RNView,
  TextInput,
  ActivityIndicator,
  Pressable,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';

import { Text, useColors } from '@/components/Themed';
import { spacing, fontSize, fontWeight, radius } from '@/constants/Colors';
import { useAllContributors, Contributor } from '@/hooks/useRecipes';

interface AllContributorsModalProps {
  visible: boolean;
  onClose: () => void;
  onSelectContributor: (contributor: Contributor) => void;
  selectedContributorId?: string;
}

export default function AllContributorsModal({
  visible,
  onClose,
  onSelectContributor,
  selectedContributorId,
}: AllContributorsModalProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [searchQuery, setSearchQuery] = useState('');
  
  // Fetch all contributors
  const { data: contributors, isLoading } = useAllContributors(visible);
  
  // Filter contributors by search query
  const filteredContributors = useMemo(() => {
    if (!contributors) return [];
    if (!searchQuery.trim()) return contributors;
    
    const query = searchQuery.toLowerCase().trim();
    return contributors.filter(c => 
      c.display_name.toLowerCase().includes(query)
    );
  }, [contributors, searchQuery]);

  const handleSelectContributor = (contributor: Contributor) => {
    onSelectContributor(contributor);
    onClose();
    setSearchQuery('');
  };

  const renderContributor = ({ item }: { item: Contributor }) => {
    const isSelected = selectedContributorId === item.user_id;
    
    return (
      <TouchableOpacity
        style={[
          styles.contributorRow,
          { 
            backgroundColor: isSelected ? colors.tint + '15' : 'transparent',
            borderColor: colors.border,
          }
        ]}
        onPress={() => handleSelectContributor(item)}
        activeOpacity={0.7}
      >
        <RNView style={[styles.avatar, { backgroundColor: colors.tint + '20' }]}>
          <Ionicons name="person" size={20} color={colors.tint} />
        </RNView>
        <RNView style={styles.contributorInfo}>
          <Text style={[styles.contributorName, { color: colors.text }]}>
            {item.display_name}
          </Text>
          <Text style={[styles.contributorCount, { color: colors.textMuted }]}>
            {item.recipe_count} {item.recipe_count === 1 ? 'recipe' : 'recipes'}
          </Text>
        </RNView>
        {isSelected && (
          <Ionicons name="checkmark-circle" size={22} color={colors.tint} />
        )}
      </TouchableOpacity>
    );
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView 
        style={styles.keyboardAvoid}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <Pressable style={styles.overlay} onPress={onClose}>
          <Pressable 
            style={[
              styles.sheet, 
              { 
                backgroundColor: colors.background,
                paddingTop: insets.top + spacing.md,
                paddingBottom: insets.bottom + spacing.md,
              }
            ]}
            onPress={(e) => e.stopPropagation()}
          >
          {/* Header */}
          <RNView style={styles.header}>
            <Text style={[styles.title, { color: colors.text }]}>All Contributors</Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Ionicons name="close" size={24} color={colors.textMuted} />
            </TouchableOpacity>
          </RNView>
          
          {/* Search Input */}
          <RNView style={[styles.searchContainer, { backgroundColor: colors.backgroundSecondary, borderColor: colors.border }]}>
            <Ionicons name="search" size={18} color={colors.textMuted} />
            <TextInput
              style={[styles.searchInput, { color: colors.text }]}
              placeholder="Search contributors..."
              placeholderTextColor={colors.textMuted}
              value={searchQuery}
              onChangeText={setSearchQuery}
              autoCapitalize="none"
              autoCorrect={false}
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity onPress={() => setSearchQuery('')}>
                <Ionicons name="close-circle" size={18} color={colors.textMuted} />
              </TouchableOpacity>
            )}
          </RNView>
          
          {/* Contributors List */}
          {isLoading ? (
            <RNView style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={colors.tint} />
              <Text style={[styles.loadingText, { color: colors.textMuted }]}>
                Loading contributors...
              </Text>
            </RNView>
          ) : filteredContributors.length === 0 ? (
            <RNView style={styles.emptyContainer}>
              <Ionicons name="person-outline" size={48} color={colors.textMuted} />
              <Text style={[styles.emptyText, { color: colors.textMuted }]}>
                {searchQuery ? 'No contributors found' : 'No contributors yet'}
              </Text>
            </RNView>
          ) : (
            <FlatList
              data={filteredContributors}
              renderItem={renderContributor}
              keyExtractor={(item) => item.user_id}
              contentContainerStyle={styles.list}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            />
          )}
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  keyboardAvoid: {
    flex: 1,
  },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    maxHeight: '80%',
    minHeight: '50%',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.md,
  },
  title: {
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: spacing.sm,
  },
  searchInput: {
    flex: 1,
    fontSize: fontSize.md,
    paddingVertical: spacing.xs,
  },
  list: {
    paddingHorizontal: spacing.lg,
  },
  contributorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radius.lg,
    marginBottom: spacing.xs,
    gap: spacing.md,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  contributorInfo: {
    flex: 1,
  },
  contributorName: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
  },
  contributorCount: {
    fontSize: fontSize.sm,
    marginTop: 2,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.md,
  },
  loadingText: {
    fontSize: fontSize.md,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.md,
  },
  emptyText: {
    fontSize: fontSize.md,
  },
});

