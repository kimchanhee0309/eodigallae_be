import type { RequestHandler } from "express";
import type { RedisReply } from "rate-limit-redis";

import { env } from "../config/env.js";
import { redisClient } from "../config/redis.js";

import { createRateLimiter } from "./rate-limit.js";
import { createRedisRateLimitStore } from "./redis-rate-limit-store.js";

function buildRoomRateLimiter(
  name: string,
  windowMs: number,
  limit: number,
): RequestHandler {
  if (!env.rateLimitEnabled) {
    return (_req, res, next) => {
      next();
    };
  }

  const store = createRedisRateLimitStore({
    prefix: `eodigallae:${env.nodeEnv}:rate-limit:v1:${name}:`,
    isReady: () => redisClient?.isReady === true,

    sendCommand: async (...args) => {
      if (!redisClient?.isReady) {
        throw new Error("Rate limit Redis is unavailable");
      }

      return redisClient
        .withCommandOptions({
          timeout: 300,
        })
        .sendCommand<RedisReply>(args);
    },
  });

  return createRateLimiter({
    windowMs,
    limit,
    store,
  });
}

export const createRoomRateLimiter = buildRoomRateLimiter(
  "create-room",
  10 * 60 * 1_000,
  10,
);

export const joinRoomRateLimiter = buildRoomRateLimiter(
  "join-room",
  5 * 60 * 1_000,
  30,
);
