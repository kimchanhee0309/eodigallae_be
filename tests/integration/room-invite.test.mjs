import { createHash, randomUUID } from "node:crypto";

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

const prefix = `invite-${randomUUID().slice(0, 8)}-`;

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

function getInviteToken(inviteUrl) {
  const token = new URL(inviteUrl).searchParams.get("invite");

  if (!token) {
    throw new Error("초대 토큰이 없습니다.");
  }

  return token;
}

function digest(token) {
  return createHash("sha256").update(token).digest("hex");
}

async function createRoomFixture(suffix) {
  const response = await request(app)
    .post("/api/rooms")
    .send({
      name: `${prefix}${suffix}`,
      hostNickname: "테스트방장",
    });

  expect(response.status).toBe(201);

  const { room, participant, inviteUrl } = response.body.data;

  return {
    roomId: room.id,
    hostId: participant.id,
    inviteToken: getInviteToken(inviteUrl),
    cookie: getCookie(response, room.id),
  };
}

function rotate(room, cookie = room.cookie, body = {}) {
  const pending = request(app)
    .post(`/api/rooms/${room.roomId}/invite/rotate`)
    .set("Origin", env.frontendOrigin)
    .send(body);

  if (cookie) {
    pending.set("Cookie", cookie);
  }

  return pending;
}

function join(room, inviteToken = room.inviteToken) {
  return request(app)
    .post(`/api/rooms/${room.roomId}/join`)
    .set("Origin", env.frontendOrigin)
    .send({
      nickname: "일반참여자",
      inviteToken,
    });
}

async function readInviteHash(roomId) {
  const room = await prisma.room.findUniqueOrThrow({
    where: { id: roomId },
    select: { inviteTokenHash: true },
  });

  return room.inviteTokenHash;
}

beforeAll(async () => {
  const result = await prisma.$queryRaw`
    SELECT current_database() AS database_name
  `;

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

describe("초대 링크 재발급", () => {
  it("방장이 재발급하면 이전 링크는 거절하고 새 링크는 허용한다", async () => {
    const room = await createRoomFixture("rotate");

    const response = await rotate(room);

    expect(response.status).toBe(200);

    expect(Object.keys(response.body.data)).toEqual(["inviteUrl"]);

    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["set-cookie"]).toBeUndefined();

    const newToken = getInviteToken(response.body.data.inviteUrl);

    expect(newToken).not.toBe(room.inviteToken);

    expect(await readInviteHash(room.roomId)).toBe(digest(newToken));

    const oldJoin = await join(room);

    expect(oldJoin.status).toBe(404);
    expect(oldJoin.body.error.code).toBe("INVITE_INVALID");

    const newJoin = await join(room, newToken);

    expect(newJoin.status).toBe(201);
    expect(newJoin.body.data.participant.role).toBe("MEMBER");
  });

  it("일반 참여자는 재발급할 수 없다", async () => {
    const room = await createRoomFixture("member");

    const joined = await join(room);

    expect(joined.status).toBe(201);

    const memberCookie = getCookie(joined, room.roomId);
    const before = await readInviteHash(room.roomId);

    const response = await rotate(room, memberCookie);

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("FORBIDDEN");

    expect(await readInviteHash(room.roomId)).toBe(before);
  });

  it("인증 쿠키가 없으면 거절한다", async () => {
    const room = await createRoomFixture("no-cookie");
    const before = await readInviteHash(room.roomId);

    const response = await rotate(room, null);

    expect(response.status).toBe(401);

    expect(await readInviteHash(room.roomId)).toBe(before);
  });

  it("만료된 방장 세션은 거절한다", async () => {
    const room = await createRoomFixture("expired");

    await prisma.participantSession.updateMany({
      where: {
        participantId: room.hostId,
      },
      data: {
        expiresAt: new Date(Date.now() - 1000),
      },
    });

    const before = await readInviteHash(room.roomId);

    const response = await rotate(room);

    expect(response.status).toBe(401);

    expect(await readInviteHash(room.roomId)).toBe(before);
  });

  it("참여가 닫힌 방에서는 재발급할 수 없다", async () => {
    const room = await createRoomFixture("closed");

    await prisma.room.update({
      where: { id: room.roomId },
      data: { status: "FINALIZED" },
    });

    const before = await readInviteHash(room.roomId);

    const response = await rotate(room);

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("ROOM_CLOSED");

    expect(await readInviteHash(room.roomId)).toBe(before);
  });

  it("Origin이 없는 재발급 요청을 거절한다", async () => {
    const room = await createRoomFixture("origin");
    const before = await readInviteHash(room.roomId);

    const response = await request(app)
      .post(`/api/rooms/${room.roomId}/invite/rotate`)
      .set("Cookie", room.cookie)
      .send({});

    expect(response.status).toBe(403);

    expect(await readInviteHash(room.roomId)).toBe(before);
  });

  it("재발급해도 기존 참여자의 세션은 유지한다", async () => {
    const room = await createRoomFixture("keep-session");

    const joined = await join(room);

    expect(joined.status).toBe(201);

    const memberCookie = getCookie(joined, room.roomId);

    const response = await rotate(room);

    expect(response.status).toBe(200);

    const detail = await request(app)
      .get(`/api/rooms/${room.roomId}`)
      .set("Cookie", memberCookie);

    expect(detail.status).toBe(200);

    expect(detail.body.data.me.id).toBe(joined.body.data.participant.id);
  });

  it("동시에 재발급하면 최종 링크 하나만 유효하다", async () => {
    const room = await createRoomFixture("concurrent");

    const responses = await Promise.all([rotate(room), rotate(room)]);

    expect(responses.map((response) => response.status)).toEqual([200, 200]);

    const tokens = responses.map((response) =>
      getInviteToken(response.body.data.inviteUrl),
    );

    expect(new Set(tokens).size).toBe(2);

    const storedHash = await readInviteHash(room.roomId);

    expect(tokens.map(digest)).toContain(storedHash);

    const joins = [];

    for (const token of tokens) {
      joins.push(await join(room, token));
    }

    expect(joins.map((response) => response.status).sort()).toEqual([201, 404]);
  });

  it("요청 본문으로 권한 정보를 지정하면 거절한다", async () => {
    const room = await createRoomFixture("body");
    const before = await readInviteHash(room.roomId);

    const response = await rotate(room, room.cookie, { role: "HOST" });

    expect(response.status).toBe(400);

    expect(await readInviteHash(room.roomId)).toBe(before);
  });
});
