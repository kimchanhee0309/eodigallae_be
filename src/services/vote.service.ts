import { prisma } from "../config/db.js";
import { AppError } from "../errors/AppError.js";

import { lockRoomForUpdate } from "../models/room.model.js";

import {
  deleteParticipantVote,
  findVotingCandidate,
  findVotingParticipant,
  readVoteSummary,
  upsertParticipantVote,
} from "../models/vote.model.js";

import type { SetVoteInput } from "../validators/vote.schema.js";

export async function setVote(
  roomId: string,
  participantId: string,
  input: SetVoteInput,
) {
  return prisma.$transaction(
    async (tx) => {
      const room = await lockRoomForUpdate(tx, roomId);

      if (!room) {
        throw new AppError(404, "ROOM_NOT_FOUND", "모임을 찾을 수 없습니다.");
      }

      const participant = await findVotingParticipant(
        tx,
        roomId,
        participantId,
      );

      if (!participant) {
        throw new AppError(
          403,
          "FORBIDDEN",
          "이 모임의 참여자만 투표할 수 있습니다.",
        );
      }

      if (room.status !== "OPEN") {
        throw new AppError(
          409,
          "ROOM_CLOSED",
          "확정된 모임에서는 투표를 변경할 수 없습니다.",
        );
      }

      if (input.candidateId === null) {
        await deleteParticipantVote(tx, roomId, participantId);
      } else {
        const candidate = await findVotingCandidate(
          tx,
          roomId,
          input.candidateId,
        );

        if (!candidate) {
          throw new AppError(
            404,
            "CANDIDATE_NOT_FOUND",
            "이 모임에서 장소 후보를 찾을 수 없습니다.",
          );
        }

        await upsertParticipantVote(tx, roomId, participantId, candidate.id);
      }

      return readVoteSummary(tx, roomId, participantId);
    },
    {
      maxWait: 5_000,
      timeout: 10_000,
      isolationLevel: "ReadCommitted",
    },
  );
}

export function getVotes(roomId: string, participantId: string) {
  return prisma.$transaction(
    (tx) => readVoteSummary(tx, roomId, participantId),
    {
      maxWait: 5_000,
      timeout: 10_000,
      isolationLevel: "RepeatableRead",
    },
  );
}
