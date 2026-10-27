import { describe, expect, it, jest } from "@jest/globals";

import { z } from "zod";

import { JsonCache } from "../dist/cache/json-cache.js";

const schema = z.object({
  count: z.number().int().nonnegative(),
});

function createStore() {
  const entries = new Map();
  let sequence = 0;

  return {
    entries,

    read: jest.fn(async (key) => {
      let entry = entries.get(key);

      if (!entry) {
        entry = {
          version: String(++sequence),
          payload: null,
        };

        entries.set(key, entry);
      }

      return { ...entry };
    }),

    writeIfCurrent: jest.fn(async (key, version, payload, _ttlSeconds) => {
      const current = entries.get(key);

      if (!current || current.version !== version) {
        return false;
      }

      entries.set(key, {
        version,
        payload,
      });

      return true;
    }),

    invalidate: jest.fn(async (key) => {
      entries.delete(key);
    }),
  };
}

function getOptions(load) {
  return {
    key: "test:room",
    schema,
    ttlSeconds: 15,
    load,
  };
}

describe("JSON 캐시", () => {
  it("처음에는 원본을 조회하고 다음에는 캐시를 사용한다", async () => {
    const store = createStore();
    const cache = new JsonCache(store);

    const load = jest.fn().mockResolvedValue({ count: 1 });

    const first = await cache.getOrLoad(getOptions(load));
    const second = await cache.getOrLoad(getOptions(load));

    expect(first).toEqual({
      data: { count: 1 },
      cacheStatus: "MISS",
    });

    expect(second).toEqual({
      data: { count: 1 },
      cacheStatus: "HIT",
    });

    expect(load).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["잘못된 JSON", "broken-json"],
    ["스키마가 다른 JSON", '{"count":"wrong"}'],
  ])("%s이면 원본을 다시 조회한다", async (_label, payload) => {
    const store = createStore();
    const cache = new JsonCache(store);

    await store.read("test:room");
    store.entries.get("test:room").payload = payload;

    const load = jest.fn().mockResolvedValue({ count: 2 });

    const result = await cache.getOrLoad(getOptions(load));

    expect(result).toEqual({
      data: { count: 2 },
      cacheStatus: "MISS",
    });

    expect(load).toHaveBeenCalledTimes(1);

    const next = await cache.getOrLoad(getOptions(load));

    expect(next.cacheStatus).toBe("HIT");
    expect(next.data).toEqual({ count: 2 });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("캐시 조회가 실패하면 원본 조회로 대체한다", async () => {
    const store = createStore();

    store.read.mockRejectedValue(new Error("Redis unavailable"));

    const cache = new JsonCache(store);
    const load = jest.fn().mockResolvedValue({ count: 3 });

    const result = await cache.getOrLoad(getOptions(load));

    expect(result).toEqual({
      data: { count: 3 },
      cacheStatus: "BYPASS",
    });

    expect(load).toHaveBeenCalledTimes(1);
    expect(store.writeIfCurrent).not.toHaveBeenCalled();
  });

  it("캐시 저장이 실패해도 원본 조회 결과를 반환한다", async () => {
    const store = createStore();

    store.writeIfCurrent.mockRejectedValue(new Error("Redis unavailable"));

    const cache = new JsonCache(store);
    const load = jest.fn().mockResolvedValue({ count: 4 });

    const result = await cache.getOrLoad(getOptions(load));

    expect(result.data).toEqual({ count: 4 });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("원본 조회 실패는 숨기지 않고 전달한다", async () => {
    const store = createStore();
    const cache = new JsonCache(store);

    const error = new Error("Database unavailable");
    const load = jest.fn().mockRejectedValue(error);

    await expect(cache.getOrLoad(getOptions(load))).rejects.toBe(error);

    expect(store.writeIfCurrent).not.toHaveBeenCalled();
  });

  it("캐시 삭제 후에는 원본을 다시 조회한다", async () => {
    const store = createStore();
    const cache = new JsonCache(store);

    const load = jest
      .fn()
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 2 });

    await cache.getOrLoad(getOptions(load));

    expect(await cache.invalidate("test:room")).toBe(true);

    const result = await cache.getOrLoad(getOptions(load));

    expect(result).toEqual({
      data: { count: 2 },
      cacheStatus: "MISS",
    });

    expect(load).toHaveBeenCalledTimes(2);
  });

  it("캐시 삭제 실패를 호출자에게 알린다", async () => {
    const store = createStore();

    store.invalidate.mockRejectedValue(new Error("Redis unavailable"));

    const cache = new JsonCache(store);

    expect(await cache.invalidate("test:room")).toBe(false);
  });

  it("삭제 전 시작한 조회가 새 캐시를 덮어쓰지 않는다", async () => {
    const store = createStore();
    const cache = new JsonCache(store);

    const started = Promise.withResolvers();
    const oldLoad = Promise.withResolvers();

    const oldRequest = cache.getOrLoad(
      getOptions(async () => {
        started.resolve();
        return oldLoad.promise;
      }),
    );

    // 이전 요청이 캐시를 확인하고 원본 조회를 시작할 때까지 대기합니다.
    await started.promise;

    await cache.invalidate("test:room");

    const freshLoad = jest.fn().mockResolvedValue({ count: 2 });

    const fresh = await cache.getOrLoad(getOptions(freshLoad));

    expect(fresh.data).toEqual({ count: 2 });

    // 이전 조회가 늦게 끝나더라도 새 캐시는 유지되어야 합니다.
    oldLoad.resolve({ count: 1 });
    await oldRequest;

    const next = await cache.getOrLoad(getOptions(freshLoad));

    expect(next).toEqual({
      data: { count: 2 },
      cacheStatus: "HIT",
    });

    expect(freshLoad).toHaveBeenCalledTimes(1);
  });

  it("캐시를 사용하지 않는 설정이면 원본을 조회한다", async () => {
    const cache = new JsonCache(null);
    const load = jest.fn().mockResolvedValue({ count: 5 });

    const result = await cache.getOrLoad(getOptions(load));

    expect(result).toEqual({
      data: { count: 5 },
      cacheStatus: "BYPASS",
    });

    expect(load).toHaveBeenCalledTimes(1);
  });
});
