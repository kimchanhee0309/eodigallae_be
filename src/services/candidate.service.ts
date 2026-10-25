import { prisma } from "../config/db.js";
import { AppError } from "../errors/AppError.js";

import {
  countRoomCandidates,
  findCandidateAuthor,
  findRoomCandidates,
  insertCandidate,
} from "../models/candidate.model.js";

import { lockRoomForUpdate } from "../models/room.model.js";
import type { CreateCandidateInput } from "../validators/candidate.schema.js";

const MAX_CANDIDATES_PER_ROOM = 50;

export async function createCandidate(
  roomId: string,
  participantId: string,
  input: CreateCandidateInput,
) {
  return prisma.$transaction(
    async (tx) => {
      const room = await lockRoomForUpdate(tx, roomId);

      if (!room) {
        throw new AppError(404, "ROOM_NOT_FOUND", "모임을 찾을 수 없습니다.");
      }

      const author = await findCandidateAuthor(tx, roomId, participantId);

      if (!author) {
        throw new AppError(
          403,
          "FORBIDDEN",
          "이 모임의 참여자만 후보를 등록할 수 있습니다.",
        );
      }

      if (room.status !== "OPEN") {
        throw new AppError(
          409,
          "ROOM_CLOSED",
          "확정된 모임에는 후보를 등록할 수 없습니다.",
        );
      }

      const count = await countRoomCandidates(tx, roomId);

      if (count >= MAX_CANDIDATES_PER_ROOM) {
        throw new AppError(
          409,
          "CANDIDATE_LIMIT_REACHED",
          "장소 후보는 모임당 최대 50개까지 등록할 수 있습니다.",
        );
      }

      return insertCandidate(tx, roomId, participantId, input);
    },
    {
      maxWait: 5_000,
      timeout: 10_000,
    },
  );
}

export function getCandidates(roomId: string) {
  return findRoomCandidates(roomId, MAX_CANDIDATES_PER_ROOM);
}
