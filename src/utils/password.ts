import * as argon2 from "argon2";

export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
    hashLength: 32,
  });
}

export function verifyPassword(
  password: string,
  storedHash: string,
): Promise<boolean> {
  return argon2.verify(storedHash, password);
}
