import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * AES-256-GCM envelope for sensitive records (client intake, health screening answers).
 * Format: v1.<iv b64>.<tag b64>.<ciphertext b64>
 */
function keyFrom(b64: string): Buffer {
  const key = Buffer.from(b64, "base64");
  if (key.length !== 32) throw new Error("DATA_ENCRYPTION_KEY must be 32 bytes, base64-encoded");
  return key;
}

export function encryptJson(value: unknown, keyB64: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFrom(keyB64), iv);
  const ct = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), ct.toString("base64")].join(".");
}

export function decryptJson<T = unknown>(envelope: string, keyB64: string): T {
  const [v, iv, tag, ct] = envelope.split(".");
  if (v !== "v1" || !iv || !tag || !ct) throw new Error("Unrecognised encrypted payload");
  const d = createDecipheriv("aes-256-gcm", keyFrom(keyB64), Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return JSON.parse(Buffer.concat([d.update(Buffer.from(ct, "base64")), d.final()]).toString("utf8")) as T;
}
