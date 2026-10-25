import type { RequestHandler } from "express";

import { AppError } from "../errors/AppError.js";

import {
  createCandidate,
  getCandidates,
} from "../services/candidate.service.js";

import type { RoomAuth } from "../services/session.service.js";
import { createCandidateSchema } from "../validators/candidate.schema.js";

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

export const createCandidateController: RequestHandler = async (req, res) => {
  if (!req.is("application/json")) {
    throw new AppError(
      415,
      "UNSUPPORTED_MEDIA_TYPE",
      "Content-Type은 application/json이어야 합니다.",
    );
  }

  const auth = requireAuthContext(res.locals.roomAuth);
  const input = createCandidateSchema.parse(req.body);

  const candidate = await createCandidate(
    auth.roomId,
    auth.participant.id,
    input,
  );

  res.status(201).json({
    data: {
      candidate,
    },
  });
};

export const getCandidatesController: RequestHandler = async (_req, res) => {
  const auth = requireAuthContext(res.locals.roomAuth);

  const candidates = await getCandidates(auth.roomId);

  res.status(200).json({
    data: {
      candidates,
    },
  });
};
