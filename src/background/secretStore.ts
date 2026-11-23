/**
 * Encrypts the Sorare API key at rest with AES-GCM. The AES key is a non-extractable WebCrypto key
 * kept in this extension's own IndexedDB: content scripts and web pages run in another origin and
 * cannot read it, and even extension code can only use it, never export it. The ciphertext lives in
 * chrome.storage.local. If the IndexedDB key is ever lost, the stored key cannot be decrypted and the
 * user simply enters it again.
 */

export interface EncryptedSecret {
  v: 1;
  iv: string;
  ct: string;
}

const DB_NAME = "jamassist_secrets";
const STORE = "keys";
const KEY_ID = "api_key_wrap_v1";
/** Shown to the side panel instead of the real key; never written back. */
export const MASK_PREFIX = "••••";

let cachedKey: CryptoKey | null = null;
let pendingKey: Promise<CryptoKey> | null = null;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idb<T>(db: IDBDatabase, mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return new Promise((resolve, reject) => {
    const req = run(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error);
  });
}

async function getAesKey(): Promise<CryptoKey> {
  if (cachedKey) return cachedKey;
  if (!pendingKey) {
    pendingKey = (async () => {
      const db = await openDb();
      try {
        let key = await idb<CryptoKey | undefined>(db, "readonly", (s) => s.get(KEY_ID));
        if (!key) {
          key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
          await idb(db, "readwrite", (s) => s.put(key, KEY_ID));
        }
        cachedKey = key;
        return key;
      } finally {
        db.close();
        pendingKey = null;
      }
    })();
  }
  return pendingKey;
}

const toB64 = (buf: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export async function encryptSecret(plain: string): Promise<EncryptedSecret> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await getAesKey(), new TextEncoder().encode(plain));
  return { v: 1, iv: toB64(iv), ct: toB64(ct) };
}

export function isEncryptedSecret(v: unknown): v is EncryptedSecret {
  return (
    Boolean(v) &&
    typeof v === "object" &&
    (v as EncryptedSecret).v === 1 &&
    typeof (v as EncryptedSecret).iv === "string" &&
    typeof (v as EncryptedSecret).ct === "string"
  );
}

/** Decrypts a stored secret; returns "" when it cannot be read (the user re-enters the key). */
export async function decryptSecret(secret: EncryptedSecret): Promise<string> {
  try {
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(secret.iv) }, await getAesKey(), fromB64(secret.ct));
    return new TextDecoder().decode(pt);
  } catch {
    return "";
  }
}

/** "abcd...wxyz" -> "••••wxyz" for display; "" stays "". */
export function maskSecret(plain: string): string {
  return plain ? `${MASK_PREFIX}${plain.slice(-4)}` : "";
}

/**
 * What goes into chrome.storage: the encrypted key. Only where IndexedDB or WebCrypto do not exist
 * (unit-test runners, never Chrome) is the plain key kept, so tests can still save settings.
 */
export async function sealForStorage(plain: string): Promise<EncryptedSecret | string> {
  if (!plain) return "";
  if (typeof indexedDB === "undefined" || typeof crypto === "undefined" || !crypto.subtle) return plain;
  return encryptSecret(plain);
}
