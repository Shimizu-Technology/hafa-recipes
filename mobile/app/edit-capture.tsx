import { useMemo, useRef } from 'react';
import { useAuth } from '@clerk/expo';
import { useLocalSearchParams } from 'expo-router';
import { useImportInbox } from '@/hooks/useImportInbox';
import { EditRecipeForm } from './edit-recipe/[id]';
import type { Recipe } from '@/types/recipe';
import { Text } from '@/components/Themed';

/** Reuse the canonical component editor only after a definitive validation rejection. */
export default function EditCaptureScreen() {
  const params = useLocalSearchParams<{ initialData: string; captureId: string; captureOwnerId: string; captureSource: string; isPublic: string; resumeDraft: string; originalPages?: string }>();
  const { userId } = useAuth();
  const { ownerId } = useImportInbox();
  const current = useRef(ownerId); current.current = ownerId;
  const recipe = useMemo(() => ({ id: params.captureId, extracted: JSON.parse(params.initialData),
    source_type: params.captureSource, is_public: params.isPublic === 'true', thumbnail_url: null }) as Recipe, [params.initialData, params.captureId]);
  if (!ownerId || ownerId !== params.captureOwnerId) return <Text>Sign in to the account that owns this draft.</Text>;
  return <EditRecipeForm key={`${ownerId}:${params.captureId}`} owner={userId} capture={{ id: params.captureId,
    ownerId, recipe, originalPages: params.originalPages ? JSON.parse(params.originalPages) : undefined, resume: params.resumeDraft === 'true', guard: () => { if (current.current !== ownerId) throw new Error('Account changed.'); } }} />;
}
