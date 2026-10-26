import { prisma } from "../config/db.js";
import { env } from "../config/env.js";
import { SESSION_TTL_MS } from "../config/session.ts";
import { AppError } from "../errors/AppError.js";

import {
  findRoomById,
  insertHostParticipant,
  insertParticipantSession,
  insertRoom,
} from "../models/room.model.js";

import { generateToken, hashToken } from "../utils/token.js";
import type { CreateRoomInput } from "../validators/room.schema.js";

export async function createRoom(input: CreateRoomInput) {
  const inviteToken = generateToken();
  const sessionToken = generateToken();

  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  const result = await prisma.$transaction(
    async (tx) => {
      const room = await insertRoom(tx, {
        name: input.name,
        description: input.description,
        inviteTokenHash: hashToken(inviteToken),
      });

      const participant = await insertHostParticipant(
        tx,
        room.id,
        input.hostNickname,
      );

      await insertParticipantSession(tx, {
        participantId: participant.id,
        tokenHash: hashToken(sessionToken),
        expiresAt,
      });

      return {
        room,
        participant,
      };
    },
    {
      maxWait: 5_000,
      timeout: 10_000,
    },
  );

  const inviteUrl = new URL(`/rooms/${result.room.id}`, env.frontendOrigin);

  inviteUrl.searchParams.set("invite", inviteToken);

  return {
    room: result.room,
    participant: result.participant,
    inviteUrl: inviteUrl.toString(),
    sessionToken,
  };
}

export async function getRoomDetail(roomId: string) {
  const room = await findRoomById(roomId);

  if (!room) {
    throw new AppError(404, "ROOM_NOT_FOUND", "모임을 찾을 수 없습니다.");
  }

  return {
    id: room.id,
    name: room.name,
    description: room.description,
    status: room.status,
    createdAt: room.createdAt,
    participantCount: room._count.participants,
    finalizedAt: room.finalizedAt,
    finalizedCandidate: room.finalizedCandidate,
  };
}
