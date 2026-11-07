import { Prisma } from "../generated/prisma/client.js";

import { AppError } from "../errors/AppError.js";
import { createLocalUser } from "../models/auth.model.js";
import { hashPassword } from "../utils/password.js";

import type { LocalSignupInput } from "../validators/auth.schema.js";

export async function signupLocalUser(input: LocalSignupInput) {
  const passwordHash = await hashPassword(input.password);

  try {
    return await createLocalUser({
      loginId: input.loginId,
      passwordHash,
      nickname: input.nickname,
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw new AppError(409, "LOGIN_ID_TAKEN", "이미 사용중인 아이디입니다.");
    }

    throw error;
  }
}
