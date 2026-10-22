import { Router } from "express";
import {
  createRoomController,
  getRoomController,
} from "../controllers/room.controller.js";

import { requireRoomParticipant } from "../middlewares/require-room-participant.js";

const roomRouter = Router();

roomRouter.post("/", createRoomController);

roomRouter.get("/:roomId", requireRoomParticipant, getRoomController);

export default roomRouter;
