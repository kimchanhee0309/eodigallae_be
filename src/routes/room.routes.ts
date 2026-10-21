import { Router } from "express";
import { createRoomController } from "../controllers/room.controller.js";

const roomRouter = Router();

roomRouter.post("/", createRoomController);

export default roomRouter;
