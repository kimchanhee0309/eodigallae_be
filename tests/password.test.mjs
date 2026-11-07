import { describe, expect, it } from "@jest/globals";

import { hashPassword, verifyPassword } from "../dist/utils/password.js";

const password = "this is a test password";

describe("비밀번호 해싱과 검증", () => {
  it("비밀번호를 Argon2id 해시로 변환한다", async () => {
    const storedHash = await hashPassword(password);

    expect(storedHash).toMatch(/^\$argon2id\$/);
    expect(storedHash).not.toContain(password);

    // 현재 DB 컬럼에 저장 가능한 길이인지 확인합니다.
    expect(storedHash.length).toBeLessThanOrEqual(255);
  });

  it("같은 비밀번호도 서로 다른 솔트로 저장한다", async () => {
    const first = await hashPassword(password);
    const second = await hashPassword(password);

    expect(first).not.toBe(second);

    expect(await verifyPassword(password, first)).toBe(true);
    expect(await verifyPassword(password, second)).toBe(true);
  });

  it("틀린 비밀번호는 인증하지 않는다", async () => {
    const storedHash = await hashPassword(password);

    expect(await verifyPassword("a different test password", storedHash)).toBe(
      false,
    );
  });

  it("비밀번호의 앞뒤 공백도 검증에 반영한다", async () => {
    const original = `  ${password}  `;
    const storedHash = await hashPassword(original);

    expect(await verifyPassword(original, storedHash)).toBe(true);
    expect(await verifyPassword(password, storedHash)).toBe(false);
  });
});
