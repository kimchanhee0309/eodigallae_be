import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { parse } from "dotenv";

let settings;

try {
  settings = parse(readFileSync(".env.test"));

  const databaseUrl = new URL(settings.DATABASE_URL ?? "");
  const redisUrl = new URL(settings.REDIS_TEST_URL ?? "");

  if (
    settings.NODE_ENV !== "test" ||
    !["postgresql:", "postgres:"].includes(databaseUrl.protocol) ||
    databaseUrl.pathname !== "/eodigallae_test" ||
    redisUrl.protocol !== "redis:" ||
    !["127.0.0.1", "localhost"].includes(redisUrl.hostname) ||
    redisUrl.pathname !== "/15"
  ) {
    throw new Error();
  }
} catch {
  console.error(
    ".env.test의 테스트 DB와 로컬 Redis 15번 DB 설정을 확인해주세요.",
  );

  process.exit(1);
}

const testEnv = {
  ...process.env,
  ...settings,
  NODE_ENV: "test",
  CACHE_ENABLED: "true",
  REDIS_URL: settings.REDIS_TEST_URL,
};

function run(args) {
  const result = spawnSync(process.execPath, args, {
    env: testEnv,
    stdio: "inherit",
    shell: false,
  });

  if (result.error) {
    console.error("캐시 테스트 프로세스를 시작하지 못했습니다.");
    process.exit(1);
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

run(["node_modules/prisma/build/index.js", "migrate", "deploy"]);

if (process.argv[2] === "benchmark") {
  run(["scripts/benchmark-room-cache.mjs"]);
} else {
  run([
    "--experimental-vm-modules",
    "node_modules/jest/bin/jest.js",
    "--config",
    "jest.cache.config.mjs",
    "--runInBand",
  ]);
}
