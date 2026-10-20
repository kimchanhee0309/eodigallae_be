import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";
import { AppError } from "../errors/AppError.js";

export const errorHandler: ErrorRequestHandler = (
  error: unknown,
  _req,
  res,
  next,
) => {
  if (res.headersSent) {
    next(error);
    return;
  }

  if (error instanceof ZodError) {
    res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "입력값을 확인해주세요.",
        details: error.issues.map((issue) => ({
          field: issue.path.join("."),
          message: issue.message,
        })),
      },
    });
    return;
  }

  if (
    error instanceof Error &&
    "type" in error &&
    error.type === "entity.parse.failed"
  ) {
    res.status(400).json({
      error: {
        code: "INVALID_JSON",
        message: "올바른 JSON 형식으로 요청해주세요.",
      },
    });

    return;
  }

  if (
    error instanceof Error &&
    "type" in error &&
    error.type === "entity.too.large"
  ) {
    res.status(413).json({
      error: {
        code: "PAYLOAD_TOO_LARGE",
        message: "요청 데이터가 너무 큽니다.",
      },
    });

    return;
  }

  if (error instanceof AppError) {
    res.status(error.statusCode).json({
      error: {
        code: error.code,
        message: error.message,
      },
    });
    return;
  }

  console.error("예상하지 못한 서버 오류", {
    name: error instanceof Error ? error.name : "UnknownError",
  });

  res.status(500).json({
    error: {
      code: "INTERNAL_SERVER_ERROR",
      message: "서버 오류가 발생했습니다. 잠시 후 다시 시도해주세요.",
    },
  });
};
