import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function matchesToken(token: string, storedHash: string): boolean {
  if (!/^[a-f0-9]{64}$/i.test(storedHash)) {
    return false;
  }

  return timingSafeEqual(
    Buffer.from(hashToken(token), "hex"),
    Buffer.from(storedHash, "hex"),
  );
}
