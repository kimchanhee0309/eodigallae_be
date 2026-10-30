import { afterEach, describe, expect, it, jest } from "@jest/globals";
import express from "express";
import { MemoryStore } from "express-rate-limit";
import request from "supertest";

import { errorHandler } from "../dist/middlewares/error-handler.js";
import { createRateLimiter } from "../dist/middlewares/rate-limit.js";

const stores = [];

function createStore() {
  const store = new MemoryStore();

  stores.push(store);

  return store;
}

function createTestApp(store) {
  const app = express();

  const controller = jest.fn((_req, res) => {
    res.status(200).json({
      data: { ok: true },
    });
  });

  app.post(
    "/limited",
    createRateLimiter({
      windowMs: 60_000,
      limit: 2,
      store,
    }),
    controller,
  );

  app.use(errorHandler);

  return { app, controller };
}

afterEach(() => {
  for (const store of stores) {
    store.shutdown();
  }

  stores.length = 0;

  jest.restoreAllMocks();
});

describe("요청 횟수 제한", () => {
  it("허용 횟수를 초과하면 429와 재시도 정보를 반환한다", async () => {
    const { app, controller } = createTestApp(createStore());

    const first = await request(app).post("/limited");
    const second = await request(app).post("/limited");
    const third = await request(app).post("/limited");

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(third.status).toBe(429);

    expect(controller).toHaveBeenCalledTimes(2);

    expect(third.body).toEqual({
      error: {
        code: "RATE_LIMIT_EXCEEDED",
        message: "요청이 너무 많습니다. 잠시 후 다시 시도해주세요.",
      },
    });

    expect(third.headers["ratelimit"]).toBeDefined();
    expect(Number(third.headers["retry-after"])).toBeGreaterThan(0);
    expect(third.headers["cache-control"]).toBe("no-store");

    expect(third.headers["x-ratelimit-limit"]).toBeUndefined();
  });

  it("저장소 오류 시 요청을 처리하지 않고 503을 반환한다.", async () => {
    const store = createStore();

    jest
      .spyOn(store, "increment")
      .mockRejectedValue(new Error("REDIS_PASSWORD=must-not-be-exposed"));

    const { app, controller } = createTestApp(store);

    const response = await request(app).post("/limited");

    expect(response.status).toBe(503);
    expect(controller).not.toHaveBeenCalled();

    expect(response.body).toEqual({
      error: {
        code: "RATE_LIMIT_UNAVAILABLE",
        message:
          "요청 제한 서비스를 사용할 수 없습니다. 잠시 후 다시 시도해주세요.",
      },
    });

    expect(response.headers["retry-after"]).toBe("5");
    expect(response.headers["cache-control"]).toBe("no-store");

    expect(response.text).not.toContain("REDIS_PASSWORD");
  });

  it("저장소가 복구되면 다시 요청을 처리한다", async () => {
    const store = createStore();

    jest
      .spyOn(store, "increment")
      .mockRejectedValueOnce(new Error("Temporary store failure"));

    const { app, controller } = createTestApp(store);

    const failed = await request(app).post("/limited");
    const recovered = await request(app).post("/limited");

    expect(failed.status).toBe(503);
    expect(recovered.status).toBe(200);

    expect(controller).toHaveBeenCalledTimes(1);
  });
});
