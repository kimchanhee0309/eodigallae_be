import { randomUUID } from "node:crypto";

import { prisma } from "../config/db.js";

type CreateLocalUserData = {
  loginId: string;
  passwordHash: string;
  nickname: string;
};

export function createLocalUser(data: CreateLocalUserData) {
  return prisma.user.create({
    data: {
      id: randomUUID(),
      nickname: data.nickname,

      localCredential: {
        create: {
          loginId: data.loginId,
          passwordHash: data.passwordHash,
        },
      },
    },

    select: {
      id: true,
      nickname: true,
      createdAt: true,
    },
  });
}
