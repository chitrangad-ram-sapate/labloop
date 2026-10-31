import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

export function hashPassword(pw: string) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(pw, salt, 32).toString("hex")}`;
}

export function checkPassword(pw: string, stored: string) {
  const match = /^([a-f0-9]{32}):([a-f0-9]{64})$/i.exec(stored);
  if (!match) return false;
  const [, salt, hash] = match;
  return timingSafeEqual(Buffer.from(hash, "hex"), scryptSync(pw, salt, 32));
}
