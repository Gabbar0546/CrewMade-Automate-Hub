import crypto from "crypto";

const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;

function getKey() {
  const configured = process.env.CREDENTIAL_ENCRYPTION_KEY;
  if (configured && /^[a-f0-9]{64}$/i.test(configured)) {
    return Buffer.from(configured, "hex");
  }

  const fallback = process.env.SESSION_SECRET || "dev-only-change-this-secret-before-production";
  return crypto.createHash("sha256").update(fallback).digest();
}

export function encryptSecret(value: string) {
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64");
}

export function decryptSecret(value: string) {
  const data = Buffer.from(value, "base64");
  const iv = data.subarray(0, IV_LEN);
  const tag = data.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const encrypted = data.subarray(IV_LEN + TAG_LEN);
  const decipher = crypto.createDecipheriv(ALGO, getKey(), iv);
  decipher.setAuthTag(tag);
  return decipher.update(encrypted, undefined, "utf8") + decipher.final("utf8");
}
