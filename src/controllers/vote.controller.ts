import type { RequestHandler } from "express";

import { AppError } from "../errors/AppError.js";

import { getVotes, setVote } from "../services/vote.service.js";

import type { RoomAuth } from "../services/session.service.js";
import { setVoteSchema } from "../validators/vote.schema.js";

function requireAuthContext(value: unknown): RoomAuth {
  const auth = value as RoomAuth | undefined;

  if (!auth) {
    throw new AppError(
      500,
      "AUTH_CONTEXT_MISSING",
      "요청을 처리하지 못했습니다.",
    );
  }

  return auth;
}

export const setVoteController: RequestHandler = async (req, res) => {
  if (!req.is("application/json")) {
    throw new AppError(
      415,
      "UNSUPPORTED_MEDIA_TYPE",
      "Content-Type은 application/json이어야 합니다.",
    );
  }

  const auth = requireAuthContext(res.locals.roomAuth);
  const input = setVoteSchema.parse(req.body);

  const result = await setVote(auth.roomId, auth.participant.id, input);

  res.status(200).json({
    data: result,
  });
};

export const getVotesController: RequestHandler = async (_req, res) => {
  const auth = requireAuthContext(res.locals.roomAuth);

  const result = await getVotes(auth.roomId, auth.participant.id);

  res.status(200).json({
    data: result,
  });
};
