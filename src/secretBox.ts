import crypto from "node:crypto";

// Encryption at rest for the service credentials in the settings table, with
// a key that lives only in the environment (SETTINGS_ENCRYPTION_KEY), never
// in the database or its backups.
//
// AES-256-GCM with a random 96-bit IV per value. The setting's name is the
// additional authenticated data, so a ciphertext copied into another row
// (say the Plex token into SONARR_API_KEY) fails to open instead of being used
// as that other secret. Stored as "enc:v1:" + base64url(iv | tag | ciphertext).

const PREFIX = "enc:v1:";
const IV_BYTES = 12;
const TAG_BYTES = 16;

export const KEY_HELP =
  "SETTINGS_ENCRYPTION_KEY must be 32 random bytes, base64 or hex encoded; make one with `openssl rand -base64 32`.";

export function isSealed(value: string): boolean {
  return value.startsWith(PREFIX);
}

// The key from SETTINGS_ENCRYPTION_KEY, or null when it isn't set. A value
// that isn't exactly 32 bytes is an error, never silently padded or hashed.
export function encryptionKeyFromEnv(raw = process.env.SETTINGS_ENCRYPTION_KEY): Buffer | null {
  const text = raw?.trim() ?? "";
  if (!text) return null;
  const key = /^[0-9a-f]{64}$/i.test(text)
    ? Buffer.from(text, "hex")
    : /^[A-Za-z0-9+/_-]+={0,2}$/.test(text)
      ? Buffer.from(text, "base64")
      : Buffer.alloc(0);
  if (key.length !== 32) throw new Error(`${KEY_HELP} The value given is not.`);
  return key;
}

export function seal(plain: string, name: string, key: Buffer): string {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(name));
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url");
}

// Throws if the value was sealed with another key, for another setting, or
// was changed.
export function open(stored: string, name: string, key: Buffer): string {
  const raw = Buffer.from(stored.slice(PREFIX.length), "base64url");
  if (raw.length < IV_BYTES + TAG_BYTES) throw new Error("The stored value is truncated.");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, raw.subarray(0, IV_BYTES));
  decipher.setAAD(Buffer.from(name));
  decipher.setAuthTag(raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
  return Buffer.concat([
    decipher.update(raw.subarray(IV_BYTES + TAG_BYTES)),
    decipher.final(),
  ]).toString("utf8");
}
