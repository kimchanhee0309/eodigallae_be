import { createClient } from "redis";

import { env } from "./env.js";

export const redisClient =
  (env.cacheEnabled || env.rateLimitEnabled) && env.redisUrl
    ? createClient({
        url: env.redisUrl,

        disableOfflineQueue: true,
        commandsQueueMaxLength: 100,

        socket: {
          connectTimeout: 1_000,
        },
      })
    : null;

let stopping = false;
let warned = false;

function warnOnce() {
  if (stopping || warned) {
    return;
  }

  warned = true;

  console.warn("Redis 연결을 사용할 수 없습니다.");
}

redisClient?.on("error", warnOnce);

redisClient?.on("ready", () => {
  warned = false;
  console.log("Redis 캐시 연결 준비 완료");
});

export function startRedisCache(): void {
  if (!redisClient || redisClient.isOpen || stopping) {
    return;
  }

  void redisClient.connect().catch(warnOnce);
}

export function stopRedisCache(): void {
  stopping = true;

  if (redisClient?.isOpen) {
    redisClient.destroy();
  }
}
