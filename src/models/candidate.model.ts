import { prisma } from "../config/db.js";
import type { Prisma } from "../generated/prisma/client.js";
import type { CreateCandidateInput } from "../validators/candidate.schema.js";

const candidateSelect = {
  id: true,
  name: true,
  address: true,
  mapUrl: true,
  memo: true,
  createdAt: true,
  updatedAt: true,

  createdBy: {
    select: {
      id: true,
      nickname: true,
    },
  },
} satisfies Prisma.PlaceCandidateSelect;

export function findCandidateAuthor(
  tx: Prisma.TransactionClient,
  roomId: string,
  participantId: string,
) {
  return tx.participant.findFirst({
    where: {
      id: participantId,
      roomId,
    },
    select: {
      id: true,
    },
  });
}

export function countRoomCandidates(
  tx: Prisma.TransactionClient,
  roomId: string,
) {
  return tx.placeCandidate.count({
    where: {
      roomId,
    },
  });
}

export function insertCandidate(
  tx: Prisma.TransactionClient,
  roomId: string,
  participantId: string,
  input: CreateCandidateInput,
) {
  return tx.placeCandidate.create({
    data: {
      roomId,
      createdById: participantId,
      name: input.name,
      address: input.address,
      mapUrl: input.mapUrl,
      memo: input.memo,
    },
    select: candidateSelect,
  });
}

export function findRoomCandidates(roomId: string, limit: number) {
  return prisma.placeCandidate.findMany({
    where: {
      roomId,
    },
    select: candidateSelect,
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: limit,
  });
}
