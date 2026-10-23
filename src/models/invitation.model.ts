import type { Prisma } from "../generated/prisma/client.js";

export function findRoomHost(
  tx: Prisma.TransactionClient,
  roomId: string,
  participantId: string,
) {
  return tx.participant.findFirst({
    where: {
      id: participantId,
      roomId,
      role: "HOST",
    },
    select: {
      id: true,
    },
  });
}

export function updateInviteTokenHash(
  tx: Prisma.TransactionClient,
  roomId: string,
  inviteTokenHash: string,
) {
  return tx.room.update({
    where: {
      id: roomId,
    },
    data: {
      inviteTokenHash,
    },
    select: {
      id: true,
    },
  });
}
