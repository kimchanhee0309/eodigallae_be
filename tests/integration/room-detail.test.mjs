import { randomUUID } from "node:crypto";

import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
} from "@jest/globals";

import request from "supertest";

import app from "../../dist/app.js";
import { prisma } from "../../dist/config/db.js";
import { generateToken, hashToken } from "../../dist/utils/token.js";
import { create } from "node:domain";

const prefix = `detail-${randomUUID().slice(0, 8)}-`;

let databaseVerified = false;

async function createTestRoom(suffix) {
  const response = await request(app)
    .post("/api/rooms")
    .send({
      name: `${prefix}${suffix}`,
      hostNickname: "테스트방장",
      description: "상세 조회 테스트",
    });

  expect(response.status).toBe(201);

  const roomId = response.body.data.room.id;
  const cookieName = `eg_session_${roomId}`;

  const header = response.headers["set-cookie"]?.find((value) =>
    value.startsWith(`${cookieName}=`),
  );

  if (!header) {
    throw new Error("방 생성 응답에 세션 쿠키가 없습니다.");
  }

  const cookie = header.split(";")[0];

  const token = decodeURIComponent(cookie.slice(cookieName.length + 1));

  return {
    roomId,
    cookie,
    token,
  };
}

beforeAll(async () => {
  const result = await prisma.$queryRaw`
  SELECT current_database() AS database_name`;

  if (result[0]?.database_name !== "eodigallae_test") {
    throw new Error("테스트 DB가 아닙니다.");
  }

  databaseVerified = true;
});

afterEach(async () => {
  if (!databaseVerified) {
    return;
  }

  await prisma.room.deleteMany({
    where: {
      name: {
        startsWith: prefix,
      },
    },
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("방 상세 조회", () => {
  it("방장이 자신의 세션으로 조회할 수 있다.", async () => {
    const created = await createTestRoom("host");

    const response = await request(app)
      .get(`/api/rooms/${created.roomId}`)
      .set("Cookie", created.cookie);

    expect(response.status).toBe(200);
    expect(response.body.data.room.id).toBe(created.roomId);
    expect(response.body.data.room.participantCount).toBe(1);
    expect(response.body.data.me.role).toBe("HOST");

    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("해당 방의 일반 참여자도 조회할 수 있다", async () => {
    const created = await createTestRoom("member");

    const token = generateToken();

    const member = await prisma.participant.create({
      data: {
        roomId: created.roomId,
        nickname: "일반참여자",
        role: "MEMBER",

        sessions: {
          create: {
            tokenHash: hashToken(token),
            expiresAt: new Date(Date.now() + 60 * 60 * 1000),
          },
        },
      },
    });

    const response = await request(app)
      .get(`/api/rooms/${created.roomId}`)
      .set("Cookie", `eg_session_${created.roomId}=${token}`);

    expect(response.status).toBe(200);
    expect(response.body.data.me.id).toBe(member.id);
    expect(response.body.data.me.role).toBe("MEMBER");
    expect(response.body.data.room.participantCount).toBe(2);
  });

  it("쿠키가 없으면 거절한다", async () => {
    const created = await createTestRoom("no-cookie");

    const response = await request(app).get(`/api/rooms/${created.roomId}`);

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("UNAUTHORIZED");
  });

  it("변조된 토큰을 거절한다", async () => {
    const created = await createTestRoom("tampered");

    const response = await request(app)
      .get(`/api/rooms/${created.roomId}`)
      .set("Cookie", `eg_session_${created.roomId}=${generateToken()}`);

    expect(response.status).toBe(401);
  });

  it("만료된 세션을 거절한다", async () => {
    const created = await createTestRoom("expired");

    await prisma.participantSession.update({
      where: {
        tokenHash: hashToken(created.token),
      },
      data: {
        expiresAt: new Date(Date.now() - 1000),
      },
    });

    const response = await request(app)
      .get(`/api/rooms/${created.roomId}`)
      .set("Cookie", created.cookie);

    expect(response.status).toBe(401);
  });

  it("DB에서 삭제한 세션을 거절한다", async () => {
    const created = await createTestRoom("revoked");

    await prisma.participantSession.delete({
      where: {
        tokenHash: hashToken(created.token),
      },
    });

    const response = await request(app)
      .get(`/api/rooms/${created.roomId}`)
      .set("Cookie", created.cookie);

    expect(response.status).toBe(401);
  });

  it("다른 방의 토큰을 쿠키 이름만 바꿔 보내도 거절한다", async () => {
    const first = await createTestRoom("first");
    const second = await createTestRoom("second");

    const response = await request(app)
      .get(`/api/rooms/${second.roomId}`)
      .set("Cookie", `eg_session_${second.roomId}=${first.token}`);

    expect(response.status).toBe(401);
  });

  it("잘못된 형식의 방 ID를 거절한다", async () => {
    const response = await request(app).get("/api/rooms/not-a-uuid");

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("응답에 토큰과 내부 필드를 포함하지 않는다", async () => {
    const created = await createTestRoom("response");

    const response = await request(app)
      .get(`/api/rooms/${created.roomId}`)
      .set("Cookie", created.cookie);

    expect(response.status).toBe(200);

    expect(Object.keys(response.body.data).sort()).toEqual(["me", "room"]);

    expect(Object.keys(response.body.data.room).sort()).toEqual([
      "createdAt",
      "description",
      "finalizedAt",
      "finalizedCandidate",
      "id",
      "name",
      "participantCount",
      "status",
    ]);

    expect(response.body.data.room.finalizedAt).toBeNull();
    expect(response.body.data.room.finalizedCandidate).toBeNull();

    expect(Object.keys(response.body.data.me).sort()).toEqual([
      "id",
      "nickname",
      "role",
    ]);

    expect(response.text).not.toContain(created.token);
  });
});
