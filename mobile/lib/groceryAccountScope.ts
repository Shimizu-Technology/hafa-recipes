import * as Crypto from 'expo-crypto';

/** Existing API namespace contract (api/app/grocery_sync.py), for legacy cleanup. */
export async function groceryAccountScope(owner: string): Promise<string> {
  const hex = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `hafa-recipes:grocery-account-scope:v1\0${owner}`);
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let encoded = '';
  for (let offset = 0; offset < 36; offset += 6) {
    const value = parseInt(hex.slice(offset, offset + 6), 16);
    for (const shift of [18, 12, 6, 0]) encoded += alphabet[(value >>> shift) & 63];
  }
  return `gacct_${encoded}`;
}
