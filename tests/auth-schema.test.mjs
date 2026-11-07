import { describe, expect, it } from "@jest/globals";

import { localSignupSchema } from "../dist/validators/auth.schema.js";

const validInput = {
  loginId: "test_user",
  password: "this is a test password",
  nickname: "테스트회원",
};

describe("직접 회원가입 입력 검증", () => {
  it("아이디를 소문자로 정리하고 닉네임 공백을 제거한다", () => {
    const result = localSignupSchema.parse({
      ...validInput,
      loginId: "  Test_User  ",
      nickname: "  테스트회원  ",
    });

    expect(result).toEqual(validInput);
  });

  it("비밀번호의 앞뒤 공백을 그대로 유지한다", () => {
    const password = "  this is a test password  ";

    const result = localSignupSchema.parse({
      ...validInput,
      password,
    });

    expect(result.password).toBe(password);
  });

  it.each([15, 128])("비밀번호 길이 경계값 %p를 허용한다", (length) => {
    const result = localSignupSchema.safeParse({
      ...validInput,
      password: "a".repeat(length),
    });

    expect(result.success).toBe(true);
  });

  it.each([
    ["짧은 아이디", { loginId: "abc" }],
    ["긴 아이디", { loginId: "a".repeat(31) }],
    ["한글 아이디", { loginId: "테스트아이디" }],
    ["공백이 포함된 아이디", { loginId: "test user" }],
    ["허용하지 않은 아이디 문자", { loginId: "test-user" }],
    ["숫자 타입 아이디", { loginId: 12345 }],
    ["짧은 비밀번호", { password: "a".repeat(14) }],
    ["긴 비밀번호", { password: "a".repeat(129) }],
    ["공백뿐인 비밀번호", { password: " ".repeat(15) }],
    ["숫자 타입 비밀번호", { password: 123456789012345 }],
    ["짧은 닉네임", { nickname: "가" }],
    ["긴 닉네임", { nickname: "가".repeat(13) }],
    ["공백뿐인 닉네임", { nickname: "   " }],
    ["회원 ID 직접 지정", { userId: "another-user" }],
    ["역할 직접 지정", { role: "ADMIN" }],
    ["비밀번호 해시 직접 지정", { passwordHash: "client-hash" }],
  ])("%s을 거절한다", (_label, changes) => {
    const result = localSignupSchema.safeParse({
      ...validInput,
      ...changes,
    });

    expect(result.success).toBe(false);
  });
});
