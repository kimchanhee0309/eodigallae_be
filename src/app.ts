import express from "express";

import { AppError } from "./errors/AppError.js";
import { errorHandler } from "./middlewares/error-handler.js";
import healthRouter from "./routes/health.routes.js";
import roomRouter from "./routes/room.routes.js";

const app = express();

app.disable("x-powered-by");

app.use(express.json({ limit: "10kb" }));
app.use("/api/health", healthRouter);
app.use("/api/rooms", roomRouter);

app.use((_req, _res, next) => {
  next(new AppError(404, "NOT_FOUND", "요청한 경로를 찾을 수 없습니다."));
});

app.use(errorHandler);

export default app;
