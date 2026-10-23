import type { RequestHandler } from "express";

import { AppError } from "../errors/AppError.js";
import { rotateRoomInvite } from "../services/invitation.service.js";

import type { RoomAuth } from "../services/session.service.js";
import { rotateInviteSchema } from "../validators/room.schema.js";

export const rotateInviteController: RequestHandler = async (req, res) => {
  if (!req.is("application/json")) {
    throw new AppError(
      415,
      "UNSUPPORTED_MEDIA_TYPE",
      "Content-Type은 application/json이어야 합니다.",
    );
  }

  rotateInviteSchema.parse(req.body);

  const auth = res.locals.roomAuth as RoomAuth | undefined;

  if (!auth) {
    throw new AppError(
      500,
      "AUTH_CONTEXT_MISSING",
      "요청을 처리하지 못했습니다.",
    );
  }

  const result = await rotateRoomInvite(auth.roomId, auth.participant.id);

  res.status(200).json({
    data: {
      inviteUrl: result.inviteUrl,
    },
  });
};
