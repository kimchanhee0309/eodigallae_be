import { Router } from "express";
import {
  createRoomController,
  getRoomController,
} from "../controllers/room.controller.js";
import { joinRoomController } from "../controllers/participation.controller.js";
import { rotateInviteController } from "../controllers/invitation.controller.js";

import { requireRoomParticipant } from "../middlewares/require-room-participant.js";
import { requireFrontendOrigin } from "../middlewares/require-frontend-origin.js";

const roomRouter = Router();

roomRouter.post("/", createRoomController);
roomRouter.get("/:roomId", requireRoomParticipant, getRoomController);
roomRouter.post("/:roomId/join", requireFrontendOrigin, joinRoomController);
roomRouter.post(
  "/:roomId/invite/rotate",
  requireFrontendOrigin,
  requireRoomParticipant,
  rotateInviteController,
);

export default roomRouter;
