import { describe, expect, it, jest } from "@jest/globals";

import { createRedisRateLimitStore } from "../dist/middlewares/redis-rate-limit-store.js";

function createFixture() {
  let ready = true;

  const sendCommand = jest.fn(async (...args) => {
    if (args[0] === "SCRIPT") {
      return "test-script-sha";
    }

    if (args[0] === "EVALSHA") {
      return [1, 60_000];
    }

    throw new Error("Unexpected Redis command");
  });

  const store = createRedisRateLimitStore({
    prefix: "test:rate-limit:",
    isReady: () => ready,
    sendCommand,
  });

  store.init({
    windowMs: 60_000,
  });

  return {
    store,
    sendCommand,

    setReady(value) {
      ready = value;
    },
  };
}

describe("Redis 요청 제한 저장소", () => {
  it("설정 시에는 Redis 명령을 실행하지 않는다", () => {
    const { sendCommand } = createFixture();

    expect(sendCommand).not.toHaveBeenCalled();
  });

  it("동시 첫 요청은 초기화를 공유한다", async () => {
    const { store, sendCommand } = createFixture();

    await Promise.all([
      store.increment("first-ip"),
      store.increment("second-ip"),
    ]);

    const scriptLoads = sendCommand.mock.calls.filter(
      ([command]) => command === "SCRIPT",
    );

    const increments = sendCommand.mock.calls.filter(
      ([command]) => command === "EVALSHA",
    );

    expect(scriptLoads).toHaveLength(2);
    expect(increments).toHaveLength(2);
  });

  it("초기화 실패 후 다음 요청에서 다시 초기화한다", async () => {
    const { store, sendCommand } = createFixture();

    sendCommand.mockRejectedValueOnce(
      new Error("Temporary connection failure"),
    );

    await expect(store.incremet("test-ip")).rejects.toThrow();

    const result = await store.increment("test-ip");

    expect(result.totalHits).toBe(1);

    const scriptLoads = sendCommand.mock.calls.filter(
      ([command]) => command === "SCRIPT",
    );

    expect(scriptLoads).toHaveLength(4);
  });

  it("연결이 끊기면 거절하고 복구 후 다시 처리한다", async () => {
    const { store, sendCommand, setReady } = createFixture();

    await store.increment("test-ip");

    setReady(false);
    sendCommand.mockClear();

    await expect(store.increment("test-ip")).rejects.toThrow(
      "Rate limit Redis is unavailable",
    );

    expect(sendCommand).not.toHaveBeenCalled();

    setReady(true);

    const result = await store.increment("test-ip");

    expect(result.totalHits).toBe(1);
    expect(sendCommand).toHaveBeenCalled();
  });
});
