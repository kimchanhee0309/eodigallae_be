import "../tests/helpers/assert-test-env.mjs";
import "../tests/helpers/assert-cache-env.mjs";

import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

import request from "supertest";

import app from "../dist/app.js";
import { prisma } from "../dist/config/db.js";

import { redisClient, stopRedisCache } from "../dist/config/redis.js";

const ROUNDS = 4;
const SAMPLES_PER_BLOCK = 5;

const roomName = `bench-${randomUUID()}`.slice(0, 40);

const timings = {
  BYPASS: [],
  HIT: [],
};

let totalGetRequests = 0;
let skippedMisses = 0;

class BenchmarkError extends Error {}

function round(value) {
  return Number(value.toFixed(2));
}

function summarize(values) {
  const sorted = [...values].sort((a, b) => a - b);

  function percentile(ratio) {
    const index = Math.ceil(sorted.length * ratio) - 1;
    return sorted[Math.max(0, index)];
  }

  return {
    samples: sorted.length,
    meanMs: round(
      values.reduce((sum, value) => sum + value, 0) / values.length,
    ),
    p50Ms: round(percentile(0.5)),
    p95Ms: round(percentile(0.95)),
    minMs: round(sorted[0]),
    maxMs: round(sorted[sorted.length - 1]),
  };
}

async function connectCache() {
  if (!redisClient) {
    throw new BenchmarkError("Redis 클라이언트가 없습니다.");
  }

  if (redisClient.isReady) {
    return;
  }

  if (redisClient.isOpen) {
    redisClient.destroy();
  }

  const timer = setTimeout(() => {
    if (redisClient.isOpen) {
      redisClient.destroy();
    }
  }, 5_000);

  try {
    await redisClient.connect();
  } finally {
    clearTimeout(timer);
  }
}

async function createFixture() {
  const response = await request(app).post("/api/rooms").send({
    name: roomName,
    hostNickname: "측정방장",
  });

  if (response.status !== 201) {
    throw new BenchmarkError("측정용 모임 생성에 실패했습니다.");
  }

  const roomId = response.body.data.room.id;

  const header = response.headers["set-cookie"]?.find((value) =>
    value.startsWith(`eg_session_${roomId}=`),
  );

  if (!header) {
    throw new BenchmarkError("측정용 세션 쿠키가 없습니다.");
  }

  return {
    roomId,
    cookie: header.split(";")[0],
  };
}

async function fetchDetail(fixture) {
  totalGetRequests += 1;

  const started = performance.now();

  const response = await request(app)
    .get(`/api/rooms/${fixture.roomId}`)
    .set("Cookie", fixture.cookie);

  const elapsedMs = performance.now() - started;

  if (
    response.status !== 200 ||
    response.body.data?.room?.id !== fixture.roomId
  ) {
    throw new BenchmarkError("모임 상세 조회에 실패했습니다.");
  }

  return {
    elapsedMs,
    cacheStatus: response.headers["x-cache"],
  };
}

async function measureBlock(mode, fixture) {
  if (mode === "BYPASS") {
    if (redisClient?.isOpen) {
      redisClient.destroy();
    }
  } else {
    await connectCache();
  }

  const warmup = await fetchDetail(fixture);

  if (
    mode === "BYPASS"
      ? warmup.cacheStatus !== "BYPASS"
      : !["MISS", "HIT"].includes(warmup.cacheStatus)
  ) {
    throw new BenchmarkError("측정 모드와 실제 캐시 상태가 일치하지 않습니다.");
  }

  let collected = 0;
  let attempts = 0;

  while (collected < SAMPLES_PER_BLOCK && attempts < SAMPLES_PER_BLOCK * 4) {
    attempts += 1;

    const result = await fetchDetail(fixture);

    if (mode === "HIT" && result.cacheStatus === "MISS") {
      skippedMisses += 1;
      continue;
    }

    if (result.cacheStatus !== mode) {
      throw new BenchmarkError(
        "측정 도중 예상하지 못한 캐시 상태가 발생했습니다.",
      );
    }

    timings[mode].push(result.elapsedMs);
    collected += 1;
  }

  if (collected !== SAMPLES_PER_BLOCK) {
    throw new BenchmarkError("충분한 측정값을 수집하지 못했습니다.");
  }
}

async function cleanupFixture() {
  const rooms = await prisma.room.findMany({
    where: { name: roomName },
    select: { id: true },
  });

  if (rooms.length === 0) {
    return;
  }

  if (redisClient?.isReady) {
    try {
      await redisClient
        .withCommandOptions({ timeout: 1_000 })
        .del(rooms.map((room) => `eodigallae:test:cache:room:v1:${room.id}`));
    } catch {
      console.warn(
        "측정용 캐시 정리에 실패했습니다. 해당 키는 TTL로 만료됩니다.",
      );
    }
  }

  await prisma.room.deleteMany({
    where: {
      name: roomName,
      id: { in: rooms.map((room) => room.id) },
    },
  });
}

async function main() {
  let databaseVerified = false;
  let report;

  try {
    const result = await prisma.$queryRaw`
    SELECT current_database() AS database_name`;

    if (result[0]?.database_name !== "eodigallae_test") {
      throw new BenchmarkError("테스트 DB가 아닙니다.");
    }

    databaseVerified = true;

    const fixture = await createFixture();

    for (let index = 0; index < ROUNDS; index += 1) {
      const order = index % 2 === 0 ? ["BYPASS", "HIT"] : ["HIT", "BYPASS"];

      for (const mode of order) {
        console.log(`${index + 1}/${ROUNDS} 라운드 · ${mode} 측정`);

        await measureBlock(mode, fixture);
      }
    }

    const bypass = summarize(timings.BYPASS);
    const hit = summarize(timings.HIT);

    report = {
      measuredAt: new Date().toISOString(),
      nodeVersion: process.version,
      method: "Sequential API requests through Supertest",
      api: "GET /api/rooms/:roomId",
      authenticationIncluded: true,
      cacheTtlSeconds: 15,
      rounds: ROUNDS,
      samplesPerBlock: SAMPLES_PER_BLOCK,
      totalGetRequests,
      skippedMisses,
      results: {
        BYPASS: bypass,
        HIT: hit,
      },
      meanResponseTimeReductionPercent: round(
        ((bypass.meanMs - hit.meanMs) / bypass.meanMs) * 100,
      ),
      rawTimingsMs: timings,
    };
  } finally {
    try {
      if (databaseVerified) {
        await cleanupFixture();
      }
    } finally {
      stopRedisCache();
      await prisma.$disconnect();
    }
  }

  mkdirSync("reports", { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

  const outputPath = join("reports", `cache-benchmark-${timestamp}.json`);

  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  console.table(report.results);

  console.log(
    `평균 응답 시간 감소율: ${report.meanResponseTimeReductionPercent}%`,
  );

  console.log(`측정 결과 저장: ${outputPath}`);
}

main().catch((error) => {
  if (error instanceof BenchmarkError) {
    console.error(error.message);
  } else {
    console.error("성능 측정에 실패했습니다.", {
      name: error instanceof Error ? error.name : "UnknownError",
      code: typeof error?.code === "string" ? error.code : undefined,
    });
  }

  process.exitCode = 1;
});
