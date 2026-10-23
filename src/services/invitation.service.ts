import { prisma } from "../config/db.js";
import { env } from "../config/env.js";
import { AppError } from "../errors/AppError.js";

import {
  findRoomHost,
  updateInviteTokenHash,
} from "../models/invitation.model.js";

import { lockRoomForUpdate } from "../models/room.model.js";
import { generateToken, hashToken } from "../utils/token.js";

export async function rotateRoomInvite(roomId: string, participantId: string) {
  return prisma.$transaction(
    async (tx) => {
      const room = await lockRoomForUpdate(tx, roomId);

      if (!room) {
        throw new AppError(404, "ROOM_NOT_FOUND", "모임을 찾을 수 없습니다.");
      }

      const host = await findRoomHost(tx, roomId, participantId);

      if (!host) {
        throw new AppError(
          403,
          "FORBIDDEN",
          "방장만 초대 링크를 재발급할 수 있습니다.",
        );
      }

      if (room.status !== "OPEN") {
        throw new AppError(
          409,
          "ROOM_CLOSED",
          "이 모임은 새로운 참여를 받지 않습니다.",
        );
      }

      const inviteToken = generateToken();

      const inviteUrl = new URL(`/rooms/${roomId}`, env.frontendOrigin);

      inviteUrl.searchParams.set("invite", inviteToken);

      await updateInviteTokenHash(tx, roomId, hashToken(inviteToken));

      return {
        inviteUrl: inviteUrl.toString(),
      };
    },
    {
      maxWait: 5_000,
      timeout: 10_000,
    },
  );
}
