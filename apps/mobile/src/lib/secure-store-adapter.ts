import * as SecureStore from "expo-secure-store";

const CHUNK_SIZE = 1800; // stays under expo-secure-store's ~2048-byte per-key ceiling
const CHUNK_COUNT_SUFFIX = ".chunks";

function chunkKey(key: string, index: number): string {
  return `${key}.${index}`;
}

async function removeItem(key: string): Promise<void> {
  const chunkCountRaw = await SecureStore.getItemAsync(`${key}${CHUNK_COUNT_SUFFIX}`);
  if (chunkCountRaw !== null) {
    const chunkCount = Number(chunkCountRaw);
    for (let i = 0; i < chunkCount; i++) {
      await SecureStore.deleteItemAsync(chunkKey(key, i));
    }
    await SecureStore.deleteItemAsync(`${key}${CHUNK_COUNT_SUFFIX}`);
  }
  await SecureStore.deleteItemAsync(key);
}

async function setItem(key: string, value: string): Promise<void> {
  await removeItem(key);

  if (value.length <= CHUNK_SIZE) {
    await SecureStore.setItemAsync(key, value);
    return;
  }

  const chunkCount = Math.ceil(value.length / CHUNK_SIZE);
  for (let i = 0; i < chunkCount; i++) {
    const chunk = value.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
    await SecureStore.setItemAsync(chunkKey(key, i), chunk);
  }
  await SecureStore.setItemAsync(`${key}${CHUNK_COUNT_SUFFIX}`, String(chunkCount));
}

async function getItem(key: string): Promise<string | null> {
  const chunkCountRaw = await SecureStore.getItemAsync(`${key}${CHUNK_COUNT_SUFFIX}`);
  if (chunkCountRaw === null) {
    return SecureStore.getItemAsync(key);
  }

  const chunkCount = Number(chunkCountRaw);
  const chunks: string[] = [];
  for (let i = 0; i < chunkCount; i++) {
    const chunk = await SecureStore.getItemAsync(chunkKey(key, i));
    if (chunk === null) {
      return null;
    }
    chunks.push(chunk);
  }
  return chunks.join("");
}

export const secureStoreAdapter = { getItem, setItem, removeItem };
