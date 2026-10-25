import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { parse } from "dotenv";

let settings;

try {
  settings = parse(readFileSync(".env.test"));

  if (settings.NODE_ENV !== "test") {
    throw new Error();
  }

  const url = new URL(settings.DATABASE_URL ?? "");

  if (
    !["postgresql:", "postgres:"].includes(url.protocol) ||
    url.pathname !== "/eodigallae_test"
  ) {
    throw new Error();
  }
} catch {
  console.error(
    ".env.test를 확인해주세요. NODE_ENV=test와 eodigallae_test DB 연결이 필요합니다.",
  );

  process.exit(1);
}

const testEnv = {
  ...process.env,
  ...settings,
  NODE_ENV: "test",
};

function run(args) {
  const result = spawnSync(process.execPath, args, {
    env: testEnv,
    stdio: "inherit",
    shell: false,
  });

  if (result.error) {
    console.error("테스트 실행에 필요한 프로세스를 시작하지 못했습니다.");
    process.exit(1);
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

run(["node_modules/prisma/build/index.js", "migrate", "deploy"]);

run([
  "--experimental-vm-modules",
  "node_modules/jest/bin/jest.js",
  "--config",
  "jest.integration.config.mjs",
  "--runInBand",
]);
