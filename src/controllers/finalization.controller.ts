import type { RequestHandler } from "express";

import { AppError } from "../errors/AppError.js";
import { finalizeRoom } from "../services/finalization.service.js";

import type { RoomAuth } from "../services/session.service.js";
import { finalizeRoomSchema } from "../validators/finalization.schema.js";

export const finalizeRoomController: RequestHandler = async (req, res) => {
  if (!req.is("application/json")) {
    throw new AppError(
      415,
      "UNSUPPORTED_MEDIA_TYPE",
      "Content-Type은 application/json이어야 합니다.",
    );
  }

  const auth = res.locals.roomAuth as RoomAuth | undefined;

  if (!auth) {
    throw new AppError(
      500,
      "AUTH_CONTEXT_MISSING",
      "요청을 처리하지 못했습니다.",
    );
  }

  const input = finalizeRoomSchema.parse(req.body);

  const result = await finalizeRoom(auth.roomId, auth.participant.id, input);

  res.status(200).json({
    data: result,
  });
};
