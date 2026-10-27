import app from "./app.js";
import { env } from "./config/env.js";
import { prisma } from "./config/db.js";

import { startRedisCache, stopRedisCache } from "./config/redis.js";

startRedisCache();

const server = app.listen(env.port, () => {
  console.log(`어디갈래 API 서버 실행: http://localhost:${env.port}`);
});

server.on("error", (error) => {
  console.error("서버를 시작하지 못했습니다.", error);

  stopRedisCache();
  process.exit(1);
});

let shuttingDown = false;

function shutdown() {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;

  server.close(() => {
    stopRedisCache();

    void prisma.$disconnect().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  });

  const timer = setTimeout(() => {
    stopRedisCache();
    server.closeAllConnections();

    process.exit(1);
  }, 10_000);

  timer.unref();
}

process.once("SIGNIN", shutdown);
process.once("SIGTERM", shutdown);
