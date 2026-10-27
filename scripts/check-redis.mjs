import "dotenv/config";

import { createClient } from "redis";
import { z } from "zod";

async function main() {
  const result = z
    .url({ protocol: /^rediss?$/ })
    .safeParse(process.env.REDIS_URL);

  if (!result.success) {
    throw new Error("REDIS_URL 설정이 올바르지 않습니다.");
  }

  const client = createClient({
    url: result.data,

    disableOfflineQueue: true,

    socket: {
      connectTimeout: 5_000,
      reconnectStrategy: false,
    },
  });

  client.on("error", () => {
    console.error("Redis 연결 중 오류가 발생했습니다.");
  });

  const timer = setTimeout(() => {
    if (client.isOpen) {
      client.destroy();
    }
  }, 10_000);

  try {
    await client.connect();

    const response = await client.ping();

    if (response !== "PONG") {
      throw new Error("예상하지 못한 Redis 응답입니다.");
    }

    console.log("Redis 연결 성공! PONG");
  } finally {
    clearTimeout(timer);

    if (client.isOpen) {
      client.destroy();
    }
  }
}

main().catch(() => {
  console.error(
    "Redis 연결 확인에 실패했습니다. Docker 실행 상태와 REDIS_URL을 확인해주세요.",
  );

  process.exitCode = 1;
});
