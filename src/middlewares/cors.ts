import cors from "cors";
import { env } from "../config/env.js";
import { AppError } from "../errors/AppError.js";

export const corsMiddleware = cors({
  origin(origin, callback) {
    if (!origin) {
      callback(null, false);
      return;
    }

    if (origin === env.frontendOrigin) {
      callback(null, true);
      return;
    }

    callback(
      new AppError(
        403,
        "ORIGIN_NOT_ALLOWED",
        "허용되지 않은 출처의 요청입니다.",
      ),
    );
  },

  credentials: true,
  methods: ["GET", "POST", "OPTIONS"],

  allowedHeaders: ["Content-Type"],
});
