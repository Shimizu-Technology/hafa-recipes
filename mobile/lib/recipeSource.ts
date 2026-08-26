export type RecipeSourcePresentation = {
  icon: string;
  label: string;
};

const SOURCE_PRESENTATION: Record<string, RecipeSourcePresentation> = {
  tiktok: { icon: 'logo-tiktok', label: 'TikTok' },
  youtube: { icon: 'logo-youtube', label: 'YouTube' },
  instagram: { icon: 'logo-instagram', label: 'Instagram' },
  website: { icon: 'globe-outline', label: 'Website' },
  manual: { icon: 'create-outline', label: 'Manual' },
  photo: { icon: 'camera-outline', label: 'Photo import' },
  text: { icon: 'document-text-outline', label: 'Text import' },
};

export function getRecipeSourcePresentation(sourceType: string): RecipeSourcePresentation {
  return SOURCE_PRESENTATION[sourceType] || { icon: 'globe-outline', label: 'Source' };
}
