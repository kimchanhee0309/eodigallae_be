import type { Prisma } from "../generated/prisma/client.js";

type CreateRoomData = {
  name: string;
  description: string;
  inviteTokenHash: string;
};

type CreateSessionData = {
  participantId: string;
  tokenHash: string;
  expiresAt: Date;
};

export function insertRoom(tx: Prisma.TransactionClient, data: CreateRoomData) {
  return tx.room.create({
    data,
    select: {
      id: true,
      name: true,
      description: true,
      status: true,
      createdAt: true,
    },
  });
}

export function insertHostParticipant(
  tx: Prisma.TransactionClient,
  roomId: string,
  nickname: string,
) {
  return tx.participant.create({
    data: {
      roomId,
      nickname,
      role: "HOST",
    },
    select: {
      id: true,
      nickname: true,
      role: true,
    },
  });
}

export function insertParticipantSession(
  tx: Prisma.TransactionClient,
  data: CreateSessionData,
) {
  return tx.participantSession.create({
    data,
    select: {
      id: true,
    },
  });
}
