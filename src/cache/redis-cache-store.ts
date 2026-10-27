import { randomUUID } from "node:crypto";

import type { CacheSnapshot, CacheStore } from "./json-cache.js";

type RedisCommandClient = {
  eval(
    script: string,
    options: {
      keys: string[];
      arguments: string[];
    },
  ): Promise<unknown>;

  del(key: string): Promise<unknown>;
};

const READ_SCRIPT = `
local version = redis.call("HGET", KEYS[1], "version")

if not version then
  version = ARGV[1]
  redis.call("HSET", KEYS[1], "version", version)
  redis.call("EXPIRE", KEYS[1], 60)
end

local payload = redis.call("HGET", KEYS[1], "payload")

return {version, payload or ""}
`;

const WRITE_SCRIPT = `
local current = redis.call("HGET", KEYS[1], "version")

if current ~= ARGV[1] then
  return 0
end

redis.call("HSET", KEYS[1], "payload", ARGV[2])
redis.call("EXPIRE", KEYS[1], tonumber(ARGV[3]))

return 1
`;

export class RedisCacheStore implements CacheStore {
  constructor(private readonly client: RedisCommandClient) {}

  async read(key: string): Promise<CacheSnapshot> {
    const result = await this.client.eval(READ_SCRIPT, {
      keys: [key],
      arguments: [randomUUID()],
    });

    if (
      !Array.isArray(result) ||
      result.length !== 2 ||
      typeof result[0] !== "string" ||
      typeof result[1] !== "string"
    ) {
      throw new Error("올바르지 않은 캐시 응답입니다.");
    }

    return {
      version: result[0],
      payload: result[1] === "" ? null : result[1],
    };
  }

  async writeIfCurrent(
    key: string,
    version: string,
    payload: string,
    ttlSeconds: number,
  ): Promise<boolean> {
    const result = await this.client.eval(WRITE_SCRIPT, {
      keys: [key],
      arguments: [version, payload, String(ttlSeconds)],
    });

    return result === 1;
  }

  async invalidate(key: string): Promise<void> {
    await this.client.del(key);
  }
}
