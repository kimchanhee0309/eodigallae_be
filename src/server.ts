import app from "./app.js";
import { env } from "./config/env.js";

const server = app.listen(env.port, () => {
  console.log(`어디갈래 API 서버 실행: http://localhost:${env.port}`);
});

server.on("error", (error) => {
  console.error("서버를 시작하지 못했습니다.", error);
  process.exit(1);
});
