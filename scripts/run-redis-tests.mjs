import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

import { parse } from "dotenv";

let settings;

try {
  settings = parse(readFileSync(".env.test"));

  const url = new URL(settings.REDIS_TEST_URL ?? "");

  if (
    settings.NODE_ENV !== "test" ||
    url.protocol !== "redis:" ||
    !["127.0.0.1", "localhost"].includes(url.hostname) ||
    url.pathname !== "/15"
  ) {
    throw new Error();
  }
} catch {
  console.error(
    ".env.test의 NODE_ENV=test와 로컬 Redis 15번 DB 설정을 확인해주세요.",
  );

  process.exit(1);
}

const result = spawnSync(
  process.execPath,
  [
    "--experimental-vm-modules",
    "node_modules/jest/bin/jest.js",
    "--config",
    "jest.redis.config.mjs",
    "--runInBand",
  ],
  {
    env: {
      ...process.env,
      ...settings,
      NODE_ENV: "test",
    },
    stdio: "inherit",
    shell: false,
  },
);

if (result.error) {
  console.error("Redis 테스트 프로세스를 시작하지 못했습니다.");
  process.exit(1);
}

process.exitCode = result.status ?? 1;
