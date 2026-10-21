import type { RequestHandler } from "express";
import { env } from "../config/env.js";
import { getRoomSessionCookieName, SESSION_TTL_MS } from "../config/session.js";

import { AppError } from "../errors/AppError.js";
import { createRoom } from "../services/room.service.js";
import { createRoomSchema } from "../validators/room.schema.js";

export const createRoomController: RequestHandler = async (req, res) => {
  if (!req.is("application/json")) {
    throw new AppError(
      415,
      "UNSUPPORTED_MEDIA_TYPE",
      "Content-Type은 application/json이어야 합니다.",
    );
  }

  const input = createRoomSchema.parse(req.body);
  const result = await createRoom(input);

  res.cookie(getRoomSessionCookieName(result.room.id), result.sessionToken, {
    httpOnly: true,
    secure: env.nodeEnv === "production",
    sameSite: "lax",
    maxAge: SESSION_TTL_MS,
    path: `/api/rooms/${result.room.id}`,
  });

  res.setHeader("Cache-Control", "no-store");

  res.status(201).json({
    data: {
      room: result.room,
      participant: result.participant,
      inviteUrl: result.inviteUrl,
    },
  });
};
