import { describe } from "@jest/globals";
import request from "supertest";
import app from "../dist/app.js";

describe("API 기본 동작", () => {
  it("상태 확인 API가 정상 응답한다.", async () => {
    const response = await request(app).get("/api/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      data: {
        status: "ok",
        service: "eodigallae-api",
      },
    });

    expect(response.headers["x-powered-by"]).toBeUndefined();
  });

  it("등록되지 않은 경로는 404를 반환한다", async () => {
    const response = await request(app).get("/api/unknown");

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      error: {
        code: "NOT_FOUND",
        message: "요청한 경로를 찾을 수 없습니다.",
      },
    });
  });

  it("잘못된 JSON은 400을 반환한다", async () => {
    const response = await request(app)
      .post("/api/unknown")
      .set("Content-Type", "application/json")
      .send('{"name":');

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("INVALID_JSON");
  });

  it("요청 본문이 제한 크기를 넘으면 431을 반환한다", async () => {
    const response = await request(app)
      .post("/api/unknown")
      .send({ description: "a".repeat(11 * 1024) });

    expect(response.status).toBe(413);
    expect(response.body.error.code).toBe("PAYLOAD_TOO_LARGE");
  });
});
