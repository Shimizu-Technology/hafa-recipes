import { Platform } from 'react-native';

type ImageUpload = string | { uri: string; fileName?: string; mimeType?: string };

function imageMimeType(name: string) {
  const extension = name.split('.').pop()?.toLowerCase();
  if (extension === 'png') return 'image/png';
  if (extension === 'gif') return 'image/gif';
  if (extension === 'webp') return 'image/webp';
  if (extension === 'heic') return 'image/heic';
  if (extension === 'heif') return 'image/heif';
  return 'image/jpeg';
}

/** Preserve picker metadata while supporting Expo fetch and native XHR multipart. */
export async function appendRecipeImage(formData: FormData, field: string, image: ImageUpload, fallbackName = 'photo.jpg') {
  const uri = typeof image === 'string' ? image : image.uri;
  const uriName = uri.split('/').pop()?.split(/[?#]/)[0] || fallbackName;
  const name = typeof image === 'string' ? uriName : image.fileName || uriName;
  const explicitType = typeof image === 'string' ? undefined : image.mimeType;
  const fallbackType = imageMimeType(name);

  if (Platform.OS === 'web') {
    const response = await fetch(uri);
    if (!response.ok) throw new Error('Could not read the selected image');
    const blob = await response.blob();
    const type = explicitType || (blob.type.startsWith('image/') ? blob.type : undefined) || fallbackType;
    formData.append(field, blob.type === type ? blob : new Blob([blob], { type }), name);
    return;
  }

  const { File } = await import('expo-file-system');
  const file = new File(uri);
  // Expo's converter accepts File/ExpoBlob's bytes() interface, while native XHR
  // accepts uri. Keep both without eagerly reading/copying the whole image.
  // Preserve explicit MIME/name even when a shared URI has no extension.
  const part = { uri, name, type: explicitType || fallbackType, bytes: () => file.bytes() };
  formData.append(field, part as unknown as Blob);
}
