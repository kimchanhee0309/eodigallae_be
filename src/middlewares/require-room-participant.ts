import type { RequestHandler } from "express";

import { getRoomSessionCookieName } from "../config/session.js";
import { AppError } from "../errors/AppError.js";
import { authenticateRoomSession } from "../services/session.service.js";
import { roomParamSchema } from "../validators/room.schema.js";

export const requireRoomParticipant: RequestHandler = async (
  req,
  res,
  next,
) => {
  res.setHeader("Cache-Control", "no-store");

  const { roomId } = roomParamSchema.parse(req.params);

  const token: unknown = req.cookies?.[getRoomSessionCookieName(roomId)];

  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
    throw new AppError(
      401,
      "UNAUTHORIZED",
      "유효한 모임 참여 정보가 없습니다.",
    );
  }

  res.locals.roomAuth = await authenticateRoomSession(roomId, token);

  next();
};
