import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
} from "@jest/globals";

import express from "express";
import { createClient } from "redis";
import request from "supertest";

import { createRateLimiter } from "../../dist/middlewares/rate-limit.js";

import { createRedisRateLimitStore } from "../../dist/middlewares/redis-rate-limit-store.js";

import { errorHandler } from "../../dist/middlewares/error-handler.js";

const url = new URL(process.env.REDIS_TEST_URL ?? "");

if (
  process.env.NODE_ENV !== "test" ||
  url.protocol !== "redis:" ||
  !["127.0.0.1", "localhost"].includes(url.hostname) ||
  url.pathname !== "/15"
) {
  throw new Error("로컬 Redis 15번 테스트 DB가 아닙니다.");
}

const client = createClient({
  url: url.toString(),
  disableOfflineQueue: true,

  socket: {
    connectTimeout: 3_000,
    reconnectStrategy: false,
  },
});

client.on("error", () => {
  // 연결 정보가 포함될 수 있으므로 오류 원문은 출력하지 않습니다.
});

const commands = client.withCommandOptions({
  timeout: 1_000,
});

// 이 파일에서 생성한 키만 정리합니다.
const createdKeys = new Set();

function newPrefix() {
  return `eodigallae:test:rate-limit:${randomUUID()}:`;
}

function createTestApp({
  prefix = newPrefix(),
  windowMs = 60_000,
  limit = 2,
} = {}) {
  const store = createRedisRateLimitStore({
    prefix,
    isReady: () => client.isReady,

    sendCommand: async (...args) => {
      // EVALSHA, scriptSha, keyCount, key, ...
      if (
        args[0] === "EVALSHA" &&
        typeof args[3] === "string" &&
        args[3].startsWith(prefix)
      ) {
        createdKeys.add(args[3]);
      }

      return commands.sendCommand(args);
    },
  });

  const app = express();

  // 직접 접속하는 개발 환경의 설정을 명시합니다.
  app.set("trust proxy", false);

  app.post(
    "/limited",
    createRateLimiter({
      windowMs,
      limit,
      store,
    }),
    (_req, res) => {
      res.status(200).json({
        data: { ok: true },
      });
    },
  );

  app.use(errorHandler);

  return app;
}

beforeAll(async () => {
  await client.connect();

  expect(await commands.ping()).toBe("PONG");
});

afterEach(async () => {
  // 연결 종료 테스트가 중간에 실패해도 정리할 수 있도록 복구합니다.
  if (!client.isOpen) {
    await client.connect();
  }

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

describe("실제 Redis 요청 제한", () => {
  it("서로 다른 미들웨어 인스턴스가 카운터를 공유한다", async () => {
    const prefix = newPrefix();

    const firstApp = createTestApp({ prefix });
    const secondApp = createTestApp({ prefix });

    const first = await request(firstApp).post("/limited");
    const second = await request(secondApp).post("/limited");
    const third = await request(firstApp).post("/limited");

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(third.status).toBe(429);

    expect(createdKeys.size).toBe(1);
  });

  it("동시에 요청해도 허용 횟수를 초과해서 처리하지 않는다", async () => {
    const app = createTestApp({
      limit: 2,
    });

    const responses = await Promise.all(
      Array.from({ length: 10 }, () => request(app).post("/limited")),
    );

    const statuses = responses.map((response) => response.status);

    expect(statuses.filter((status) => status === 200)).toHaveLength(2);
    expect(statuses.filter((status) => status === 429)).toHaveLength(8);
  });

  it("Redis에 만료 시간을 설정하고 만료 후 다시 허용한다", async () => {
    const app = createTestApp({
      windowMs: 1_000,
      limit: 1,
    });

    const first = await request(app).post("/limited");
    const blocked = await request(app).post("/limited");

    expect(first.status).toBe(200);
    expect(blocked.status).toBe(429);

    const [key] = createdKeys;

    expect(key).toBeDefined();

    const ttl = await commands.pTTL(key);

    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(1_000);

    await delay(1_100);

    const recovered = await request(app).post("/limited");

    expect(recovered.status).toBe(200);
  });

  it("서로 다른 prefix는 제한 횟수를 공유하지 않는다", async () => {
    const firstApp = createTestApp({ limit: 1 });
    const secondApp = createTestApp({ limit: 1 });

    const first = await request(firstApp).post("/limited");
    const blocked = await request(firstApp).post("/limited");
    const independent = await request(secondApp).post("/limited");

    expect(first.status).toBe(200);
    expect(blocked.status).toBe(429);
    expect(independent.status).toBe(200);
  });

  it("연결 종료 시 503을 반환하고 복구 후 기존 횟수를 유지한다", async () => {
    const app = createTestApp({
      limit: 2,
    });

    const first = await request(app).post("/limited");

    expect(first.status).toBe(200);

    client.destroy();

    const unavailable = await request(app).post("/limited");

    expect(unavailable.status).toBe(503);
    expect(unavailable.body.error.code).toBe("RATE_LIMIT_UNAVAILABLE");

    await client.connect();

    const recovered = await request(app).post("/limited");
    const blocked = await request(app).post("/limited");

    expect(recovered.status).toBe(200);
    expect(blocked.status).toBe(429);
  });

  it("위조한 X-Forwarded-For 헤더로 제한을 우회하지 못한다", async () => {
    const app = createTestApp({
      limit: 1,
    });

    const first = await request(app).post("/limited");

    const second = await request(app)
      .post("/limited")
      .set("X-Forwarded-For", "203.0.113.10");

    const third = await request(app)
      .post("/limited")
      .set("X-Forwarded-For", "203.0.113.20");

    expect(first.status).toBe(200);
    expect(second.status).toBe(429);
    expect(third.status).toBe(429);
  });
});
