import { describe, expect, it } from "@jest/globals";
import request from "supertest";

import app from "../dist/app.js";
import { env } from "../dist/config/env.js";

describe("브라우저 출처 설정", () => {
  it("허용한 출처의 preflight 요청에 응답한다", async () => {
    const response = await request(app)
      .options("/api/rooms")
      .set("Origin", env.frontendOrigin)
      .set("Access-Control-Request-Method", "POST")
      .set("Access-Control-Request-Headers", "Content-Type");

    expect(response.status).toBe(204);

    expect(response.headers["access-control-allow-origin"]).toBe(
      env.frontendOrigin,
    );

    expect(response.headers["access-control-allow-credentials"]).toBe("true");
  });

  it("허용하지 않은 출처의 preflight 요청을 거절한다", async () => {
    const response = await request(app)
      .options("/api/rooms")
      .set("Origin", "https://untrusted.example")
      .set("Access-Control-Request-Method", "POST");

    expect(response.status).toBe(403);

    expect(response.body.error.code).toBe("ORIGIN_NOT_ALLOWED");
  });

  it("허용하지 않은 출처의 실제 POST 요청도 거절한다", async () => {
    const response = await request(app)
      .post("/api/rooms")
      .set("Origin", "https://untrusted.example")
      .send({
        name: "차단할 모임",
        hostNickname: "테스트방장",
      });

    expect(response.status).toBe(403);

    expect(response.headers["set-cookie"]).toBeUndefined();
  });

  it("허용한 출처에 Retry-After 응답 헤더를 공개한다", async () => {
    const response = await request(app)
      .get("/api/rooms/not-a-uuid")
      .set("Origin", env.frontendOrigin);

    expect(response.headers["access-control-allow-origin"]).toBe(
      env.frontendOrigin,
    );

    const exposedHeaders = (
      response.headers["access-control-expose-headers"] ?? ""
    )
      .split(",")
      .map((header) => header.trim().toLowerCase());

    expect(exposedHeaders).toContain("retry-after");
  });
});
