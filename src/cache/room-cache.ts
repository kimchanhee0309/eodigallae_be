import { env } from "../config/env.js";
import { redisClient } from "../config/redis.js";

import { JsonCache } from "./json-cache.js";
import { RedisCacheStore } from "./redis-cache-store.js";

import { roomCacheSchema } from "./room-cache.schema.js";
import type { RoomCacheData } from "./room-cache.schema.js";

const TTL_SECONDS = 15;

const sharedCache = new JsonCache(
  env.cacheEnabled && redisClient
    ? new RedisCacheStore(
        redisClient.withCommandOptions({
          timeout: 300,
        }),
      )
    : null,
);

const bypassCache = new JsonCache(null);

const pendingInvalidations = new Set<string>();

function roomCacheKey(roomId: string) {
  return `eodigallae:${env.nodeEnv}:cache:room:v1:${roomId}`;
}

export async function invalidateRoomDetailCache(
  roomId: string,
): Promise<boolean> {
  if (!env.cacheEnabled || !redisClient) {
    return true;
  }

  const success = await sharedCache.invalidate(roomCacheKey(roomId));

  if (success) {
    pendingInvalidations.delete(roomId);
  } else {
    if (!pendingInvalidations.has(roomId)) {
      console.warn(
        "모임 캐시 삭제에 실패했습니다. 삭제 재시도 전까지 해당 모임은 DB로 조회합니다.",
      );
    }

    pendingInvalidations.add(roomId);
  }

  return success;
}

export async function getCachedRoomDetail(
  roomId: string,
  load: () => Promise<RoomCacheData>,
) {
  let canUseCache = env.cacheEnabled && redisClient?.isReady === true;

  if (canUseCache && pendingInvalidations.has(roomId)) {
    canUseCache = await invalidateRoomDetailCache(roomId);
  }

  const cache = canUseCache ? sharedCache : bypassCache;

  return cache.getOrLoad({
    key: roomCacheKey(roomId),
    schema: roomCacheSchema,
    ttlSeconds: TTL_SECONDS,
    load,
  });
}
