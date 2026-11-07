import { Router } from "express";

import { signupController } from "../controllers/auth.controller.js";
import { signupRateLimiter } from "../middlewares/auth-rate-limit.js";
import { requireFrontendOrigin } from "../middlewares/require-frontend-origin.js";

const authRouter = Router();

authRouter.post(
  "/signup",
  requireFrontendOrigin,
  signupRateLimiter,
  signupController,
);

export default authRouter;
