import { Router } from "express";
import {
  createRoomController,
  getRoomController,
} from "../controllers/room.controller.js";
import { joinRoomController } from "../controllers/participation.controller.js";
import { rotateInviteController } from "../controllers/invitation.controller.js";

import {
  createCandidateController,
  getCandidatesController,
} from "../controllers/candidate.controller.js";

import { requireRoomParticipant } from "../middlewares/require-room-participant.js";
import { requireFrontendOrigin } from "../middlewares/require-frontend-origin.js";

import {
  getVotesController,
  setVoteController,
} from "../controllers/vote.controller.js";

import { finalizeRoomController } from "../controllers/finalization.controller.js";

import {
  createRoomRateLimiter,
  joinRoomRateLimiter,
} from "../middlewares/room-rate-limit.js";

const roomRouter = Router();

roomRouter.post("/", createRoomRateLimiter, createRoomController);
roomRouter.get("/:roomId", requireRoomParticipant, getRoomController);
roomRouter.post(
  "/:roomId/join",
  requireFrontendOrigin,
  joinRoomController,
  joinRoomRateLimiter,
);
roomRouter.post(
  "/:roomId/invite/rotate",
  requireFrontendOrigin,
  requireRoomParticipant,
  rotateInviteController,
);
roomRouter.post(
  "/:roomId/candidates",
  requireFrontendOrigin,
  requireRoomParticipant,
  createCandidateController,
);
roomRouter.get(
  "/:roomId/candidates",
  requireRoomParticipant,
  getCandidatesController,
);
roomRouter.post(
  "/:roomId/votes",
  requireFrontendOrigin,
  requireRoomParticipant,
  setVoteController,
);
roomRouter.get("/:roomId/votes", requireRoomParticipant, getVotesController);
roomRouter.post(
  "/:roomId/finalize",
  requireFrontendOrigin,
  requireRoomParticipant,
  finalizeRoomController,
);

export default roomRouter;
