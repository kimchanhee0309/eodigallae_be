import { z } from "zod";

export const loginIdSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(4, "아이디는 4자 이상이어야 합니다.")
  .max(30, "아이디는 30자 이하여야 합니다.")
  .regex(/^[a-z0-9_]+$/, "아이디는 영문, 숫자, 밑줄만 사용할 수 있습니다.");

export const signupPasswordSchema = z
  .string()
  .min(15, "비밀번호는 15자 이상이어야 합니다.")
  .max(128, "비밀번호는 128자 이하여야 합니다.")
  .refine(
    (value) => value.trim().length > 0,
    "공백만으로 구성된 비밀번호는 사용할 수 없습니다.",
  );

export const localSignupSchema = z.strictObject({
  loginId: loginIdSchema,

  password: signupPasswordSchema,

  nickname: z
    .string()
    .trim()
    .min(2, "닉네임은 2자 이상이어야 합니다.")
    .max(12, "닉네임은 12자 이하여야 합니다."),
});

export type LocalSignupInput = z.infer<typeof localSignupSchema>;
