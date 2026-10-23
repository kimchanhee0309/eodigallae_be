import type { Prisma } from "../generated/prisma/client.js";

export function findActiveRoomSession(
  tx: Prisma.TransactionClient,
  roomId: string,
  tokenHash: string,
) {
  return tx.participantSession.findFirst({
    where: {
      tokenHash,

      expiresAt: {
        gt: new Date(),
      },

      participant: {
        roomId,
      },
    },

    select: {
      participant: {
        select: {
          id: true,
          nickname: true,
          role: true,
        },
      },
    },
  });
}

export function insertMemberParticipant(
  tx: Prisma.TransactionClient,
  roomId: string,
  nickname: string,
) {
  return tx.participant.create({
    data: {
      roomId,
      nickname,
      role: "MEMBER",
    },

    select: {
      id: true,
      nickname: true,
      role: true,
    },
  });
}
