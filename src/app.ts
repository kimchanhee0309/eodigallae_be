import express from "express";
import healthRouter from "./routes/health.routes.js";

const app = express();

app.disable("x-powered-by");

app.use("/api/health", healthRouter);

app.use((_req, res) => {
  res.status(404).json({
    error: {
      code: "NOT_FOUND",
      message: "요청한 경로를 찾을 수 없습니다.",
    },
  });
});

export default app;
