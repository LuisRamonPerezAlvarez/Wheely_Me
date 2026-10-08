import AsyncStorage from '@react-native-async-storage/async-storage';
import { File, Paths } from 'expo-file-system';

const PLAYER_PHOTO_KEY = 'playerPhotoUri';

export async function loadPlayerPhotoUri() {
  const storedUri = await AsyncStorage.getItem(PLAYER_PHOTO_KEY);
  if (!storedUri) return null;

  try {
    const storedPhoto = new File(storedUri);
    if (storedPhoto.exists) return storedUri;
  } catch {
    // Una URI inválida se limpia abajo para volver al placeholder.
  }

  await AsyncStorage.removeItem(PLAYER_PHOTO_KEY);
  return null;
}

export async function savePlayerPhoto(sourceUri: string) {
  const previousUri = await AsyncStorage.getItem(PLAYER_PHOTO_KEY);
  const sourcePhoto = new File(sourceUri);
  const savedPhoto = new File(Paths.document, `wheely-player-face-${Date.now()}.jpg`);

  await sourcePhoto.copy(savedPhoto);
  await AsyncStorage.setItem(PLAYER_PHOTO_KEY, savedPhoto.uri);

  if (previousUri && previousUri !== savedPhoto.uri) {
    try {
      const previousPhoto = new File(previousUri);
      if (previousPhoto.exists) previousPhoto.delete();
    } catch {
      // La foto nueva ya quedó guardada; un archivo anterior inválido no la afecta.
    }
  }

  return savedPhoto.uri;
}
