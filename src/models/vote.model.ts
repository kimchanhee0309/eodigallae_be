import type { Prisma } from "../generated/prisma/client.js";

export function findVotingParticipant(
  tx: Prisma.TransactionClient,
  roomId: string,
  participantId: string,
) {
  return tx.participant.findUnique({
    where: {
      roomId_id: {
        roomId,
        id: participantId,
      },
    },
    select: {
      id: true,
    },
  });
}

export function findVotingCandidate(
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

export function upsertParticipantVote(
  tx: Prisma.TransactionClient,
  roomId: string,
  participantId: string,
  candidateId: string,
) {
  return tx.placeVote.upsert({
    where: {
      roomId_participantId: {
        roomId,
        participantId,
      },
    },
    create: {
      roomId,
      participantId,
      candidateId,
    },
    update: {
      candidateId,
    },
    select: {
      candidateId: true,
    },
  });
}

export function deleteParticipantVote(
  tx: Prisma.TransactionClient,
  roomId: string,
  participantId: string,
) {
  return tx.placeVote.deleteMany({
    where: {
      roomId,
      participantId,
    },
  });
}

export async function readVoteSummary(
  tx: Prisma.TransactionClient,
  roomId: string,
  participantId: string,
) {
  const candidates = await tx.placeCandidate.findMany({
    where: {
      roomId,
    },
    select: {
      id: true,

      _count: {
        select: {
          votes: true,
        },
      },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: 50,
  });

  const myVote = await tx.placeVote.findUnique({
    where: {
      roomId_participantId: {
        roomId,
        participantId,
      },
    },
    select: {
      candidateId: true,
    },
  });

  const counts = candidates.map((candidate) => ({
    candidateId: candidate.id,
    voteCount: candidate._count.votes,
  }));

  return {
    myCandidateId: myVote?.candidateId ?? null,

    totalVotes: counts.reduce(
      (total, candidate) => total + candidate.voteCount,
      0,
    ),

    candidates: counts,
  };
}
