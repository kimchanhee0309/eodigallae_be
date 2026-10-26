import type { Prisma } from "../generated/prisma/client.js";

export const finalizedCandidateSelect = {
  id: true,
  name: true,
  address: true,
  mapUrl: true,
  memo: true,
} satisfies Prisma.PlaceCandidateSelect;

export function findFinalizationHost(
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

export function findFinalizationCandidate(
  tx: Prisma.TransactionClient,
  roomId: string,
  candidateId: string,
) {
  return tx.placeCandidate.findUnique({
    where: {
      roomId_id: {
        roomId,
        id: candidateId,
      },
    },
    select: {
      id: true,
    },
  });
}

export function saveFinalization(
  tx: Prisma.TransactionClient,
  roomId: string,
  candidateId: string,
) {
  return tx.room.update({
    where: {
      id: roomId,
    },
    data: {
      status: "FINALIZED",
      finalizedCandidateId: candidateId,
      finalizedAt: new Date(),
    },
    select: {
      id: true,
    },
  });
}

export function readFinalization(tx: Prisma.TransactionClient, roomId: string) {
  return tx.room.findUnique({
    where: {
      id: roomId,
    },
    select: {
      id: true,
      status: true,
      finalizedAt: true,

      finalizedCandidate: {
        select: finalizedCandidateSelect,
      },
    },
  });
}
