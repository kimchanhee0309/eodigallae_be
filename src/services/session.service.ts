import { AppError } from "../errors/AppError.js";
import { findSessionByTokenHash } from "../models/session.model.js";
import { hashToken } from "../utils/token.js";

export async function authenticateRoomSession(roomId: string, token: string) {
  const session = await findSessionByTokenHash(hashToken(token));

  if (
    !session ||
    session.expiresAt.getTime() <= Date.now() ||
    session.participant.roomId !== roomId
  ) {
    throw new AppError(
      401,
      "UNAUTHORIZED",
      "유효한 모임 참여 정보가 없습니다.",
    );
  }

  return {
    roomId,

    participant: {
      id: session.participant.id,
      nickname: session.participant.nickname,
      role: session.participant.role,
    },
  };
}

export type RoomAuth = Awaited<ReturnType<typeof authenticateRoomSession>>;
