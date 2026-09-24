/**
 * Клиентское шифрование сообщений (AES-256-GCM + PBKDF2).
 * В Supabase уходит только ciphertext + iv — plaintext на сервере не хранится.
 *
 * Важно: pepper в клиенте извлекаем. Это защита от утечки БД / логов,
 * не полный Signal-протокол. Для production E2E — отдельные identity keys.
 */

const APP_PEPPER = "share-v1-pepper-change-in-prod-9f3a2c";
const PBKDF2_ITERATIONS = 210_000;

function b64encode(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  bytes.forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s);
}

function b64decode(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function deriveChatKey(
  userA: string,
  userB: string,
): Promise<CryptoKey> {
  const pair = [userA.toLowerCase(), userB.toLowerCase()].sort().join("|");
  const material = `${APP_PEPPER}|chat|${pair}`;
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(material),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  const salt = enc.encode(`salt|${pair}|share`);
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export type EncryptedPayload = {
  ciphertext: string;
  iv: string;
};

export async function encryptText(
  plain: string,
  myUsername: string,
  peerUsername: string,
): Promise<EncryptedPayload> {
  const key = await deriveChatKey(myUsername, peerUsername);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plain),
  );
  return { ciphertext: b64encode(ct), iv: b64encode(iv) };
}

export async function decryptText(
  ciphertext: string,
  iv: string,
  myUsername: string,
  peerUsername: string,
): Promise<string> {
  try {
    const key = await deriveChatKey(myUsername, peerUsername);
    const pt = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: b64decode(iv) },
      key,
      b64decode(ciphertext),
    );
    return new TextDecoder().decode(pt);
  } catch {
    return "[не удалось расшифровать]";
  }
}

/** Шифруем data-URL картинки целиком (для небольших фото). */
export async function encryptImageDataUrl(
  dataUrl: string,
  myUsername: string,
  peerUsername: string,
): Promise<EncryptedPayload> {
  return encryptText(dataUrl, myUsername, peerUsername);
}

export async function decryptImageDataUrl(
  ciphertext: string,
  iv: string,
  myUsername: string,
  peerUsername: string,
): Promise<string> {
  return decryptText(ciphertext, iv, myUsername, peerUsername);
}
