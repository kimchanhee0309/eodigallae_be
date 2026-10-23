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
import { env } from "../../dist/config/env.js";
import { generateToken } from "../../dist/utils/token.js";

const prefix = `join-${randomUUID().slice(0, 8)}-`;

let databaseVerified = false;

function getCookie(response, roomId) {
  const header = response.headers["set-cookie"]?.find((value) =>
    value.startsWith(`eg_session_${roomId}=`),
  );

  if (!header) {
    throw new Error("세션 쿠키가 없습니다.");
  }

  return header.split(";")[0];
}

async function createRoomFixture(suffix) {
  const response = await request(app)
    .post("/api/rooms")
    .send({ name: `${prefix}${suffix}`, hostNickname: "테스트방장" });

  expect(response.status).toBe(201);

  const { room, participant, inviteUrl } = response.body.data;

  return {
    roomId: room.id,
    hostId: participant.id,
    inviteToken: new URL(inviteUrl).searchParams.get("invite"),
    cookie: getCookie(response, room.id),
  };
}

function postJoin(room, overrides = {}, cookie) {
  const pending = request(app)
    .post(`/api/rooms/${room.roomId}/join`)
    .set("Origin", env.frontendOrigin)
    .send({
      nickname: "일반참여자",
      inviteToken: room.inviteToken,
      ...overrides,
    });

  if (cookie) {
    pending.set("Cookie", cookie);
  }

  return pending;
}

async function readCounts() {
  const [participants, sessions] = await Promise.all([
    prisma.participant.count(),
    prisma.participantSession.count(),
  ]);

  return { participants, sessions };
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

describe("초대 링크로 모임 참여", () => {
  it("신규 MEMBER와 세션을 만들고 상세 조회를 허용한다", async () => {
    const room = await createRoomFixture("new");

    const response = await postJoin(room);

    expect(response.status).toBe(201);
    expect(response.body.data.participant.role).toBe("MEMBER");

    const participantId = response.body.data.participant.id;

    expect(
      await prisma.participantSession.count({
        where: { participantId },
      }),
    ).toBe(1);

    const cookie = getCookie(response, room.roomId);

    const detail = await request(app)
      .get(`/api/rooms/${room.roomId}`)
      .set("Cookie", cookie);

    expect(detail.status).toBe(200);
    expect(detail.body.data.me.id).toBe(participantId);
    expect(detail.body.data.room.participantCount).toBe(2);

    expect(response.text).not.toContain('"sessionToken"');
    expect(response.text).not.toContain('"tokenHash"');
    expect(response.text).not.toContain('"inviteTokenHash"');
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("틀린 초대 토큰으로는 저장하지 않는다", async () => {
    const room = await createRoomFixture("invalid-token");
    const before = await readCounts();

    const response = await postJoin(room, {
      inviteToken: generateToken(),
    });

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("INVITE_INVALID");
    expect(response.headers["set-cookie"]).toBeUndefined();
    expect(await readCounts()).toEqual(before);
  });

  it("없는 방도 같은 초대 오류로 처리한다", async () => {
    const response = await postJoin({
      roomId: randomUUID(),
      inviteToken: generateToken(),
    });

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("INVITE_INVALID");
  });

  it("올바르지 않은 닉네임을 거절한다", async () => {
    const room = await createRoomFixture("nickname");
    const before = await readCounts();

    const response = await postJoin(room, {
      nickname: "김",
    });

    expect(response.status).toBe(400);
    expect(await readCounts()).toEqual(before);
  });

  it("클라이언트가 역할을 지정하면 거절한다", async () => {
    const room = await createRoomFixture("role");
    const before = await readCounts();

    const response = await postJoin(room, {
      role: "HOST",
    });

    expect(response.status).toBe(400);
    expect(await readCounts()).toEqual(before);
  });

  it("유효한 참여 세션이 있으면 중복 생성하지 않는다", async () => {
    const room = await createRoomFixture("reuse");

    const first = await postJoin(room);

    expect(first.status).toBe(201);

    const cookie = getCookie(first, room.roomId);
    const before = await readCounts();

    const second = await postJoin(room, {}, cookie);

    expect(second.status).toBe(200);

    expect(second.body.data.participant.id).toBe(
      first.body.data.participant.id,
    );

    expect(second.headers["set-cookie"]).toBeUndefined();
    expect(await readCounts()).toEqual(before);
  });

  it("방장이 참여 요청을 보내도 HOST를 유지한다", async () => {
    const room = await createRoomFixture("host");
    const before = await readCounts();

    const response = await postJoin(
      room,
      { nickname: "변경시도" },
      room.cookie,
    );

    expect(response.status).toBe(200);
    expect(response.body.data.participant.id).toBe(room.hostId);
    expect(response.body.data.participant.role).toBe("HOST");

    expect(response.body.data.participant.nickname).toBe("테스트방장");

    expect(await readCounts()).toEqual(before);
  });

  it("참여가 닫힌 방은 거절한다", async () => {
    const room = await createRoomFixture("closed");

    await prisma.room.update({
      where: { id: room.roomId },
      data: { status: "FINALIZED" },
    });

    const before = await readCounts();

    const response = await postJoin(room);

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("ROOM_CLOSED");
    expect(await readCounts()).toEqual(before);
  });

  it("Origin이 없는 참여 요청을 거절한다", async () => {
    const room = await createRoomFixture("origin");
    const before = await readCounts();

    const response = await request(app)
      .post(`/api/rooms/${room.roomId}/join`)
      .send({
        nickname: "일반참여자",
        inviteToken: room.inviteToken,
      });

    expect(response.status).toBe(403);
    expect(await readCounts()).toEqual(before);
  });

  it("만료된 세션은 기존 권한을 복구하지 않고 새로 참여한다", async () => {
    const room = await createRoomFixture("expired");

    const first = await postJoin(room);

    expect(first.status).toBe(201);

    const oldId = first.body.data.participant.id;
    const oldCookie = getCookie(first, room.roomId);

    await prisma.participantSession.updateMany({
      where: { participantId: oldId },
      data: {
        expiresAt: new Date(Date.now() - 1000),
      },
    });

    const second = await postJoin(room, { nickname: "새참여자" }, oldCookie);

    expect(second.status).toBe(201);
    expect(second.body.data.participant.id).not.toBe(oldId);
    expect(second.body.data.participant.role).toBe("MEMBER");

    expect(
      await prisma.participant.count({
        where: { roomId: room.roomId },
      }),
    ).toBe(3);
  });

  it("다른 방의 쿠키를 보내도 그 방의 권한을 가져오지 않는다", async () => {
    const first = await createRoomFixture("first");
    const second = await createRoomFixture("second");

    const firstToken = first.cookie.slice(first.cookie.indexOf("=") + 1);

    const response = await postJoin(
      second,
      {},
      `eg_session_${second.roomId}=${firstToken}`,
    );

    expect(response.status).toBe(201);
    expect(response.body.data.participant.role).toBe("MEMBER");

    expect(response.body.data.participant.id).not.toBe(first.hostId);

    expect(response.body.data.participant.id).not.toBe(second.hostId);
  });
});
