import type { RequestHandler } from "express";
import { rateLimit, type Store } from "express-rate-limit";

import { AppError } from "../errors/AppError.js";

interface CreateRateLimiterOptions {
  windowMs: number;
  limit: number;
  store: Store;
}

export function createRateLimiter({
  windowMs,
  limit,
  store,
}: CreateRateLimiterOptions): RequestHandler {
  const limiter = rateLimit({
    windowMs,
    limit,
    store,

    standardHeaders: "draft-7",
    legacyHeaders: false,

    skipFailedRequests: false,
    skipSuccessfulRequests: false,

    passOnStoreError: false,

    handler: (_req, res, next) => {
      res.setHeader("Cache-Control", "no-store");

      next(
        new AppError(
          429,
          "RATE_LIMIT_EXCEEDED",
          "요청이 너무 많습니다. 잠시 후 다시 시도해주세요.",
        ),
      );
    },
  });

  return (req, res, next) => {
    limiter(req, res, (error?: unknown) => {
      if (!error) {
        next();
        return;
      }

      if (error instanceof AppError) {
        next(error);
        return;
      }

      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Retry-After", "5");

      next(
        new AppError(
          503,
          "RATE_LIMIT_UNAVAILABLE",
          "요청 제한 서비스를 사용할 수 없습니다. 잠시 후 다시 시도해주세요.",
        ),
      );
    });
  };
}
