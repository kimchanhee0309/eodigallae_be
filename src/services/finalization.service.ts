import { prisma } from "../config/db.js";
import { AppError } from "../errors/AppError.js";

import {
  findFinalizationCandidate,
  findFinalizationHost,
  readFinalization,
  saveFinalization,
} from "../models/finalization.model.js";

import { lockRoomForUpdate } from "../models/room.model.js";

import type { FinalizeRoomInput } from "../validators/finalization.schema.js";

import { invalidateRoomDetailCache } from "../cache/room-cache.js";

export async function finalizeRoom(
  roomId: string,
  participantId: string,
  input: FinalizeRoomInput,
) {
  const result = await prisma.$transaction(
    async (tx) => {
      const room = await lockRoomForUpdate(tx, roomId);

      if (!room) {
        throw new AppError(404, "ROOM_NOT_FOUND", "모임을 찾을 수 없습니다.");
      }

      const host = await findFinalizationHost(tx, roomId, participantId);

      if (!host) {
        throw new AppError(
          403,
          "FORBIDDEN",
          "방장만 최종 장소를 확정할 수 있습니다.",
        );
      }

      if (room.status === "FINALIZED") {
        if (room.finalizedCandidateId !== input.candidateId) {
          throw new AppError(
            409,
            "ROOM_ALREADY_FINALIZED",
            "이미 다른 장소로 확정된 모임입니다.",
          );
        }
      } else {
        const candidate = await findFinalizationCandidate(
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

        await saveFinalization(tx, roomId, candidate.id);
      }

      const result = await readFinalization(tx, roomId);

      if (
        !result ||
        result.status !== "FINALIZED" ||
        !result.finalizedAt ||
        !result.finalizedCandidate
      ) {
        throw new AppError(
          500,
          "FINALIZATION_STATE_INVALID",
          "확정 결과를 확인하지 못했습니다.",
        );
      }

      return {
        roomId: result.id,
        status: result.status,
        finalizedAt: result.finalizedAt,
        finalizedCandidate: result.finalizedCandidate,
      };
    },
    {
      maxWait: 5_000,
      timeout: 10_000,
      isolationLevel: "ReadCommitted",
    },
  );

  await invalidateRoomDetailCache(roomId);

  return result;
}
