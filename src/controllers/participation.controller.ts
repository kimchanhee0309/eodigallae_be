import type { RequestHandler } from "express";
import { env } from "../config/env.js";
import { getRoomSessionCookieName, SESSION_TTL_MS } from "../config/session.js";

import { AppError } from "../errors/AppError.js";
import { joinRoom } from "../services/participation.service.js";

import { joinRoomSchema, roomParamSchema } from "../validators/room.schema.js";

export const joinRoomController: RequestHandler = async (req, res) => {
  if (!req.is("application/json")) {
    throw new AppError(
      415,
      "UNSUPPORTED_MEDIA_TYPE",
      "Content-Type은 application/json이어야 합니다.",
    );
  }

  const params = roomParamSchema.parse(req.params);
  const roomId = params.roomId.toLowerCase();

  const input = joinRoomSchema.parse(req.body);

  const cookieValue: unknown = req.cookies?.[getRoomSessionCookieName(roomId)];

  const existingToken =
    typeof cookieValue === "string" && /^[A-Za-z0-9_-]{43}$/.test(cookieValue)
      ? cookieValue
      : undefined;

  const result = await joinRoom(roomId, input, existingToken);

  if (result.sessionToken) {
    res.cookie(getRoomSessionCookieName(roomId), result.sessionToken, {
      httpOnly: true,
      secure: env.nodeEnv === "production",
      sameSite: "lax",
      maxAge: SESSION_TTL_MS,
      path: `/api/rooms/${roomId}`,
    });
  }

  res.status(result.created ? 201 : 200).json({
    data: {
      room: result.room,
      participant: result.participant,
    },
  });
};
