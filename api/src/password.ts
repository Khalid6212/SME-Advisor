import crypto from "node:crypto";

/**
 * scrypt, not bcrypt — built into Node, no native binding to break on the
 * Alpine image (see the pino-pretty crash-loop this project already hit
 * once from exactly that class of problem).
 */
const KEY_LENGTH = 64;

function scrypt(password: string, salt: Buffer, keyLength: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, keyLength, (err, derived) => {
      if (err) reject(err);
      else resolve(derived);
    });
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const derived = await scrypt(password, salt, KEY_LENGTH);
  return `${salt.toString("hex")}:${derived.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;

  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(hashHex, "hex");
  const derived = await scrypt(password, salt, expected.length);

  return derived.length === expected.length && crypto.timingSafeEqual(derived, expected);
}
