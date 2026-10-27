import { prisma } from "../config/db.js";
import { SESSION_TTL_MS } from "../config/session.js";
import { AppError } from "../errors/AppError.js";

import {
  findActiveRoomSession,
  insertMemberParticipant,
} from "../models/participation.model.js";

import {
  insertParticipantSession,
  lockRoomForUpdate,
} from "../models/room.model.js";

import { generateToken, hashToken, matchesToken } from "../utils/token.js";

import type { JoinRoomInput } from "../validators/room.schema.js";

import { invalidateRoomDetailCache } from "../cache/room-cache.js";

export async function joinRoom(
  roomId: string,
  input: JoinRoomInput,
  existingToken?: string,
) {
  const result = await prisma.$transaction(
    async (tx) => {
      const room = await lockRoomForUpdate(tx, roomId);

      if (!room || !matchesToken(input.inviteToken, room.inviteTokenHash)) {
        throw new AppError(
          404,
          "INVITE_INVALID",
          "유효하지 않은 초대 링크입니다.",
        );
      }

      if (room.status !== "OPEN") {
        throw new AppError(
          409,
          "ROOM_CLOSED",
          "이 모임은 새로운 참여를 받지 않습니다.",
        );
      }

      const publicRoom = {
        id: room.id,
        name: room.name,
        description: room.description,
        status: room.status,
        createdAt: room.createdAt,
      };

      if (existingToken) {
        const session = await findActiveRoomSession(
          tx,
          roomId,
          hashToken(existingToken),
        );

        if (session) {
          return {
            room: publicRoom,
            participant: session.participant,
            sessionToken: null,
            created: false,
          };
        }
      }

      const participant = await insertMemberParticipant(
        tx,
        roomId,
        input.nickname,
      );

      const sessionToken = generateToken();

      await insertParticipantSession(tx, {
        participantId: participant.id,
        tokenHash: hashToken(sessionToken),
        expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      });

      return {
        room: publicRoom,
        participant,
        sessionToken,
        created: true,
      };
    },
    {
      maxWait: 5_000,
      timeout: 10_000,
    },
  );

  if (result.created) {
    await invalidateRoomDetailCache(roomId);
  }

  return result;
}
