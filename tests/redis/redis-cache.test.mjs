import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";

import { createClient } from "redis";
import { z } from "zod";

import { JsonCache } from "../../dist/cache/json-cache.js";

import { RedisCacheStore } from "../../dist/cache/redis-cache-store.js";

// Jest를 직접 실행해도 연결 전에 테스트 환경을 검사합니다.
const url = new URL(process.env.REDIS_TEST_URL ?? "");

if (
  process.env.NODE_ENV !== "test" ||
  url.protocol !== "redis:" ||
  !["127.0.0.1", "localhost"].includes(url.hostname) ||
  url.pathname !== "/15"
) {
  throw new Error("로컬 Redis 15번 테스트 DB가 아닙니다.");
}

function createTestClient() {
  const connection = createClient({
    url: url.toString(),
    disableOfflineQueue: true,

    socket: {
      connectTimeout: 3_000,
      reconnectStrategy: false,
    },
  });

  connection.on("error", () => {
    // 오류 객체에 연결 정보가 포함될 수 있어 그대로 출력하지 않습니다.
  });

  return connection;
}

const client = createTestClient();

// 개별 Redis 명령의 응답 대기 시간을 제한합니다.
const commands = client.withCommandOptions({
  timeout: 1_000,
});

const store = new RedisCacheStore(commands);
const cache = new JsonCache(store);

const prefix = `eodigallae:test:cache:${randomUUID()}:`;
const createdKeys = new Set();

const schema = z.object({
  count: z.number().int().nonnegative(),
});

function newKey() {
  const key = `${prefix}${randomUUID()}`;

  createdKeys.add(key);
  return key;
}

function options(key, load) {
  return {
    key,
    schema,
    ttlSeconds: 15,
    load,
  };
}

beforeAll(async () => {
  await client.connect();

  expect(await commands.ping()).toBe("PONG");
});

afterEach(async () => {
  if (client.isReady && createdKeys.size > 0) {
    await commands.del([...createdKeys]);
  }

  createdKeys.clear();
});

afterAll(() => {
  if (client.isOpen) {
    client.destroy();
  }
});

describe("실제 Redis 캐시", () => {
  it("없는 키를 읽으면 세대 정보와 만료 시간을 만든다", async () => {
    const key = newKey();

    const snapshot = await store.read(key);

    expect(snapshot.version).toEqual(expect.any(String));
    expect(snapshot.version.length).toBeGreaterThan(0);
    expect(snapshot.payload).toBeNull();

    const ttl = await commands.ttl(key);

    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(60);
  });

  it("저장 후에는 캐시를 사용하고 TTL을 설정한다", async () => {
    const key = newKey();
    const load = jest.fn().mockResolvedValue({ count: 1 });

    const first = await cache.getOrLoad(options(key, load));
    const second = await cache.getOrLoad(options(key, load));

    expect(first).toEqual({
      data: { count: 1 },
      cacheStatus: "MISS",
    });

    expect(second).toEqual({
      data: { count: 1 },
      cacheStatus: "HIT",
    });

    expect(load).toHaveBeenCalledTimes(1);

    const ttl = await commands.ttl(key);

    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(15);
  });

  it("동시에 처음 읽어도 같은 세대 정보를 반환한다", async () => {
    const key = newKey();

    const [first, second] = await Promise.all([
      store.read(key),
      store.read(key),
    ]);

    expect(first.version).toBe(second.version);
    expect(first.payload).toBeNull();
    expect(second.payload).toBeNull();
  });

  it("삭제된 키에 이전 조회 결과를 다시 저장하지 않는다", async () => {
    const key = newKey();

    const snapshot = await store.read(key);

    await store.invalidate(key);

    const written = await store.writeIfCurrent(
      key,
      snapshot.version,
      JSON.stringify({ count: 1 }),
      15,
    );

    expect(written).toBe(false);
    expect(await commands.exists(key)).toBe(0);
  });

  it("새 세대의 캐시를 이전 세대가 덮어쓰지 못한다", async () => {
    const key = newKey();

    const oldSnapshot = await store.read(key);

    await store.invalidate(key);

    const freshSnapshot = await store.read(key);

    expect(freshSnapshot.version).not.toBe(oldSnapshot.version);

    expect(
      await store.writeIfCurrent(
        key,
        freshSnapshot.version,
        JSON.stringify({ count: 2 }),
        15,
      ),
    ).toBe(true);

    expect(
      await store.writeIfCurrent(
        key,
        oldSnapshot.version,
        JSON.stringify({ count: 1 }),
        15,
      ),
    ).toBe(false);

    const result = await store.read(key);

    expect(JSON.parse(result.payload)).toEqual({ count: 2 });
  });

  it("TTL이 지나면 데이터가 만료되고 새 세대로 시작한다", async () => {
    const key = newKey();

    const first = await store.read(key);

    expect(
      await store.writeIfCurrent(
        key,
        first.version,
        JSON.stringify({ count: 1 }),
        1,
      ),
    ).toBe(true);

    await delay(1_100);

    expect(await commands.exists(key)).toBe(0);

    const second = await store.read(key);

    expect(second.version).not.toBe(first.version);
    expect(second.payload).toBeNull();
  });

  it("손상된 JSON을 원본 조회 결과로 교체한다", async () => {
    const key = newKey();

    await store.read(key);
    await commands.hSet(key, "payload", "broken-json");

    const load = jest.fn().mockResolvedValue({ count: 3 });

    const result = await cache.getOrLoad(options(key, load));

    expect(result.data).toEqual({ count: 3 });
    expect(result.cacheStatus).toBe("MISS");

    const next = await cache.getOrLoad(options(key, load));

    expect(next.cacheStatus).toBe("HIT");
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("삭제 전 시작한 조회가 늦게 끝나도 새 캐시를 유지한다", async () => {
    const key = newKey();

    const started = Promise.withResolvers();
    const oldLoad = Promise.withResolvers();

    const oldRequest = cache.getOrLoad(
      options(key, async () => {
        started.resolve();
        return oldLoad.promise;
      }),
    );

    await started.promise;

    expect(await cache.invalidate(key)).toBe(true);

    const freshLoad = jest.fn().mockResolvedValue({ count: 2 });

    const fresh = await cache.getOrLoad(options(key, freshLoad));

    expect(fresh.data).toEqual({ count: 2 });

    oldLoad.resolve({ count: 1 });
    await oldRequest;

    const next = await cache.getOrLoad(options(key, freshLoad));

    expect(next).toEqual({
      data: { count: 2 },
      cacheStatus: "HIT",
    });

    expect(freshLoad).toHaveBeenCalledTimes(1);
  });

  it("연결이 종료된 클라이언트면 원본 조회로 대체한다", async () => {
    const key = newKey();
    const disconnected = createTestClient();

    try {
      await disconnected.connect();
      disconnected.destroy();

      const disconnectedStore = new RedisCacheStore(
        disconnected.withCommandOptions({
          timeout: 1_000,
        }),
      );

      const fallbackCache = new JsonCache(disconnectedStore);
      const load = jest.fn().mockResolvedValue({ count: 4 });

      const result = await fallbackCache.getOrLoad(options(key, load));

      expect(result).toEqual({
        data: { count: 4 },
        cacheStatus: "BYPASS",
      });

      expect(load).toHaveBeenCalledTimes(1);
      expect(await fallbackCache.invalidate(key)).toBe(false);
    } finally {
      if (disconnected.isOpen) {
        disconnected.destroy();
      }
    }
  });
});
