import type { RequestHandler } from "express";

import { env } from "../config/env.js";
import { AppError } from "../errors/AppError.js";

export const requireFrontendOrigin: RequestHandler = (req, res, next) => {
  res.setHeader("Cache-Control", "no-store");

  if (req.get("Origin") !== env.frontendOrigin) {
    throw new AppError(
      403,
      "ORIGIN_NOT_ALLOWED",
      "허용되지 않은 출처의 요청입니다.",
    );
  }

  next();
};
