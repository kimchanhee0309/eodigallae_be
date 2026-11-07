import type { RequestHandler } from "express";
import type { RedisReply } from "rate-limit-redis";

import { env } from "../config/env.js";
import { redisClient } from "../config/redis.js";

import { createRateLimiter } from "./rate-limit.js";
import { createRedisRateLimitStore } from "./redis-rate-limit-store.js";

function buildSignupRateLimiter(): RequestHandler {
  if (!env.rateLimitEnabled) {
    return (_req, _res, next) => {
      next();
    };
  }

  const store = createRedisRateLimitStore({
    prefix: `eodigallae:${env.nodeEnv}:rate-limit:v1:signup:`,

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
    windowMs: 15 * 60 * 1_000,
    limit: 5,
    store,
  });
}

export const signupRateLimiter = buildSignupRateLimiter();
