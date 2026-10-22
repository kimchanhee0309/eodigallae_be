import { prisma } from "../config/db.js";

export function findSessionByTokenHash(tokenHash: string) {
  return prisma.participantSession.findUnique({
    where: {
      tokenHash,
    },
    select: {
      expiresAt: true,

      participant: {
        select: {
          id: true,
          roomId: true,
          nickname: true,
          role: true,
        },
      },
    },
  });
}
