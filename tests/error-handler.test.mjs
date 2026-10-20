import { describe, expect, it, jest } from "@jest/globals";
import express from "express";
import request from "supertest";
import { z } from "zod";

import { errorHandler } from "../dist/middlewares/error-handler.js";

function createTestApp() {
  const app = express();

  app.use(express.json());

  const bodySchema = z.object({
    name: z.string().trim().min(2, "모임 이름은 2자 이상이어야 합니다."),
  });

  app.post("/validation", (req, res) => {
    const input = bodySchema.parse(req.body);

    res.status(200).json({
      data: input,
    });
  });

  app.get("/unexpected-error", () => {
    throw new Error("DB_PASSWORD=must-not-be-exposed");
  });

  app.use(errorHandler);

  return app;
}

describe("공통 오류 처리", () => {
  it("검증 오류를 필드 정보와 함께 반환한다", async () => {
    const app = createTestApp();

    const response = await request(app).post("/validation").send({ name: " " });

    expect(response.status).toBe(400);

    expect(response.body).toEqual({
      error: {
        code: "VALIDATION_ERROR",
        message: "입력값을 확인해주세요.",
        details: [
          {
            field: "name",
            message: "모임 이름은 2자 이상이어야 합니다.",
          },
        ],
      },
    });
  });

  it("정상 입력은 검증 후 다음 처리로 전달한다", async () => {
    const app = createTestApp();

    const response = await request(app)
      .post("/validation")
      .send({ name: "  주말 모임  " });

    expect(response.status).toBe(200);

    expect(response.body).toEqual({
      data: {
        name: "주말 모임",
      },
    });
  });

  it("예상하지 못한 오류의 내부 정보를 노출하지 않는다", async () => {
    const consoleSpy = jest
      .spyOn(console, "error")
      .mockImplementation(() => {});

    try {
      const app = createTestApp();

      const response = await request(app).get("/unexpected-error");

      expect(response.status).toBe(500);

      expect(response.body).toEqual({
        error: {
          code: "INTERNAL_SERVER_ERROR",
          message: "서버 오류가 발생했습니다. 잠시 후 다시 시도해주세요.",
        },
      });

      expect(response.text).not.toContain("DB_PASSWORD");
      expect(response.text).not.toContain("must-not-be-exposed");
    } finally {
      consoleSpy.mockRestore();
    }
  });
});
