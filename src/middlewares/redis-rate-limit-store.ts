import type { Options, Store } from "express-rate-limit";
import { RedisStore, type SendCommandFn } from "rate-limit-redis";

interface CreateRedisRateLimitStoreOptions {
  prefix: string;
  isReady: () => boolean;
  sendCommand: SendCommandFn;
}

export function createRedisRateLimitStore({
  prefix,
  isReady,
  sendCommand,
}: CreateRedisRateLimitStoreOptions): Store {
  let limiterOptions: Options | undefined;
  let initialization: Promise<RedisStore> | null = null;

  async function getStore(): Promise<RedisStore> {
    if (!isReady()) {
      throw new Error("Rate limit Redis is unavailable");
    }

    const options = limiterOptions;

    if (!options) {
      throw new Error("Rate limit store has not been configured");
    }

    if (!initialization) {
      const store = new RedisStore({
        prefix,
        sendCommand,
      });

      initialization = store.init(options).then(() => store);
    }

    const pending = initialization;

    try {
      return await pending;
    } catch (error) {
      if (initialization === pending) {
        initialization = null;
      }
      throw error;
    }
  }

  return {
    prefix,
    localKeys: false,

    init(options) {
      limiterOptions = options;
    },

    async increment(key) {
      const store = await getStore();

      return store.increment(key);
    },

    async decrement(key) {
      const store = await getStore();

      await store.decrement(key);
    },

    async resetKey(key) {
      const store = await getStore();

      await store.resetKey(key);
    },

    async get(key) {
      const store = await getStore();

      return store.get(key);
    },
  };
}
