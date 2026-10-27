import { randomUUID } from "node:crypto";

import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";

import request from "supertest";

import app from "../../dist/app.js";
import { prisma } from "../../dist/config/db.js";
import { env } from "../../dist/config/env.js";

import { redisClient, stopRedisCache } from "../../dist/config/redis.js";

import { invalidateRoomDetailCache } from "../../dist/cache/room-cache.js";

if (!redisClient) {
  throw new Error("캐시 테스트용 Redis 클라이언트가 없습니다.");
}

const commands = redisClient.withCommandOptions({
  timeout: 1_000,
});

const prefix = `cache-${randomUUID().slice(0, 8)}-`;

let databaseVerified = false;

function cacheKey(room) {
  return `eodigallae:test:cache:room:v1:${room.roomId}`;
}

async function connectCache() {
  if (redisClient.isReady) {
    return;
  }

  if (redisClient.isOpen) {
    redisClient.destroy();
  }

  const timer = setTimeout(() => {
    if (redisClient.isOpen) {
      redisClient.destroy();
    }
  }, 5_000);

  try {
    await redisClient.connect();
    expect(await commands.ping()).toBe("PONG");
  } finally {
    clearTimeout(timer);
  }
}

function getCookie(response, roomId) {
  const header = response.headers["set-cookie"]?.find((value) =>
    value.startsWith(`eg_session_${roomId}=`),
  );

  if (!header) {
    throw new Error("세션 쿠키가 없습니다.");
  }

  return header.split(";")[0];
}

async function createFixture(suffix) {
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
    cookie: getCookie(response, room.id),
    inviteToken: new URL(inviteUrl).searchParams.get("invite"),
  };
}

function getDetail(room, cookie = room.cookie) {
  const pending = request(app).get(`/api/rooms/${room.roomId}`);

  if (cookie) {
    pending.set("Cookie", cookie);
  }

  return pending;
}

async function joinMember(room) {
  const response = await request(app)
    .post(`/api/rooms/${room.roomId}/join`)
    .set("Origin", env.frontendOrigin)
    .send({
      nickname: "일반참여자",
      inviteToken: room.inviteToken,
    });

  expect(response.status).toBe(201);

  return {
    id: response.body.data.participant.id,
    cookie: getCookie(response, room.roomId),
  };
}

async function warmCache(room) {
  const first = await getDetail(room);

  expect(first.status).toBe(200);
  expect(first.headers["x-cache"]).toBe("MISS");

  const second = await getDetail(room);

  expect(second.status).toBe(200);
  expect(second.headers["x-cache"]).toBe("HIT");

  return second;
}

beforeAll(async () => {
  const result = await prisma.$queryRaw`
    SELECT current_database() AS database_name
  `;

  if (result[0]?.database_name !== "eodigallae_test") {
    throw new Error("테스트 DB가 아닙니다.");
  }

  databaseVerified = true;

  await connectCache();
});

afterEach(async () => {
  if (!databaseVerified) {
    return;
  }

  const rooms = await prisma.room.findMany({
    where: {
      name: { startsWith: prefix },
    },
    select: { id: true },
  });

  const roomIds = rooms.map((room) => room.id);

  if (roomIds.length === 0) {
    return;
  }

  if (redisClient.isReady) {
    for (const roomId of roomIds) {
      await invalidateRoomDetailCache(roomId);
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.room.updateMany({
      where: {
        id: { in: roomIds },
      },
      data: {
        finalizedCandidateId: null,
        finalizedAt: null,
      },
    });

    await tx.placeVote.deleteMany({
      where: {
        roomId: { in: roomIds },
      },
    });

    await tx.placeCandidate.deleteMany({
      where: {
        roomId: { in: roomIds },
      },
    });

    await tx.room.deleteMany({
      where: {
        id: { in: roomIds },
      },
    });
  });
});

afterAll(async () => {
  stopRedisCache();
  await prisma.$disconnect();
});

describe("모임 상세 API 캐싱", () => {
  it("캐시 적중 시 모임 상세 DB 조회 호출을 줄인다", async () => {
    const room = await createFixture("hit");

    const readSpy = jest.spyOn(prisma.room, "findUnique");

    try {
      const first = await getDetail(room);

      expect(first.status).toBe(200);
      expect(first.headers["x-cache"]).toBe("MISS");
      expect(readSpy).toHaveBeenCalledTimes(1);

      const second = await getDetail(room);

      expect(second.status).toBe(200);
      expect(second.headers["x-cache"]).toBe("HIT");
      expect(readSpy).toHaveBeenCalledTimes(1);

      expect(second.body).toEqual(first.body);
      expect(second.headers["cache-control"]).toBe("no-store");
    } finally {
      readSpy.mockRestore();
    }
  });

  it("공통 캐시를 사용해도 개인별 참여 정보는 구분한다", async () => {
    const room = await createFixture("personal");
    const member = await joinMember(room);

    const hostView = await getDetail(room);
    const memberView = await getDetail(room, member.cookie);

    expect(hostView.status).toBe(200);
    expect(hostView.headers["x-cache"]).toBe("MISS");

    expect(memberView.status).toBe(200);
    expect(memberView.headers["x-cache"]).toBe("HIT");

    expect(hostView.body.data.me.id).toBe(room.hostId);
    expect(hostView.body.data.me.role).toBe("HOST");

    expect(memberView.body.data.me.id).toBe(member.id);
    expect(memberView.body.data.me.role).toBe("MEMBER");

    expect(memberView.body.data.room).toEqual(hostView.body.data.room);

    const payload = await commands.hGet(cacheKey(room), "payload");

    expect(payload).not.toBeNull();

    const cached = JSON.parse(payload);

    expect(cached.me).toBeUndefined();
    expect(payload).not.toContain(room.hostId);
    expect(payload).not.toContain(member.id);
    expect(payload).not.toContain("tokenHash");
    expect(payload).not.toContain("inviteTokenHash");
  });

  it.each(["missing", "expired", "revoked"])(
    "캐시가 있어도 %s 세션을 거절한다",
    async (mode) => {
      const room = await createFixture("auth");

      await warmCache(room);

      if (mode === "expired") {
        await prisma.participantSession.updateMany({
          where: {
            participantId: room.hostId,
          },
          data: {
            expiresAt: new Date(Date.now() - 1000),
          },
        });
      }

      if (mode === "revoked") {
        await prisma.participantSession.deleteMany({
          where: {
            participantId: room.hostId,
          },
        });
      }

      const response = await getDetail(
        room,
        mode === "missing" ? null : room.cookie,
      );

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe("UNAUTHORIZED");
      expect(response.body.data).toBeUndefined();
      expect(response.headers["x-cache"]).toBeUndefined();

      // 인증이 거절된 시점에도 공통 캐시는 존재합니다.
      expect(await commands.exists(cacheKey(room))).toBe(1);
    },
  );

  it("캐시가 있어도 다른 모임의 토큰으로 접근할 수 없다", async () => {
    const first = await createFixture("first");
    const second = await createFixture("second");

    await warmCache(second);

    const token = first.cookie.slice(first.cookie.indexOf("=") + 1);

    const response = await getDetail(
      second,
      `eg_session_${second.roomId}=${token}`,
    );

    expect(response.status).toBe(401);
    expect(response.body.data).toBeUndefined();
    expect(response.headers["x-cache"]).toBeUndefined();
  });

  it("신규 참여 후 캐시를 삭제하고 인원을 갱신한다", async () => {
    const room = await createFixture("join");

    const before = await warmCache(room);

    expect(before.body.data.room.participantCount).toBe(1);

    await joinMember(room);

    expect(await commands.exists(cacheKey(room))).toBe(0);

    const refreshed = await getDetail(room);

    expect(refreshed.status).toBe(200);
    expect(refreshed.headers["x-cache"]).toBe("MISS");
    expect(refreshed.body.data.room.participantCount).toBe(2);

    const next = await getDetail(room);

    expect(next.headers["x-cache"]).toBe("HIT");
    expect(next.body.data.room.participantCount).toBe(2);
  });

  it("장소 확정 후 캐시를 삭제하고 확정 정보를 갱신한다", async () => {
    const room = await createFixture("finalize");

    const candidate = await prisma.placeCandidate.create({
      data: {
        roomId: room.roomId,
        createdById: room.hostId,
        name: "최종 장소",
        address: "서울특별시 마포구",
      },
    });

    const before = await warmCache(room);

    expect(before.body.data.room.status).toBe("OPEN");
    expect(before.body.data.room.finalizedCandidate).toBeNull();

    const finalized = await request(app)
      .post(`/api/rooms/${room.roomId}/finalize`)
      .set("Origin", env.frontendOrigin)
      .set("Cookie", room.cookie)
      .send({
        candidateId: candidate.id,
      });

    expect(finalized.status).toBe(200);
    expect(await commands.exists(cacheKey(room))).toBe(0);

    const refreshed = await getDetail(room);

    expect(refreshed.status).toBe(200);
    expect(refreshed.headers["x-cache"]).toBe("MISS");
    expect(refreshed.body.data.room.status).toBe("FINALIZED");

    expect(refreshed.body.data.room.finalizedCandidate.id).toBe(candidate.id);

    expect(refreshed.body.data.room.finalizedAt).toBe(
      finalized.body.data.finalizedAt,
    );

    const next = await getDetail(room);

    expect(next.headers["x-cache"]).toBe("HIT");
    expect(next.body).toEqual(refreshed.body);
  });

  it("캐시 내용이 잘못되면 DB에서 복구한다", async () => {
    const room = await createFixture("corrupt");

    const original = await warmCache(room);

    await commands.hSet(
      cacheKey(room),
      "payload",
      JSON.stringify({ id: "invalid-room" }),
    );

    const response = await getDetail(room);

    expect(response.status).toBe(200);
    expect(response.headers["x-cache"]).toBe("MISS");
    expect(response.body).toEqual(original.body);

    const next = await getDetail(room);

    expect(next.headers["x-cache"]).toBe("HIT");
  });

  it("연결 종료 중에는 DB를 사용하고 복구 후 오래된 캐시를 삭제한다", async () => {
    const room = await createFixture("recovery");

    const original = await warmCache(room);

    expect(original.body.data.room.participantCount).toBe(1);

    redisClient.destroy();

    try {
      // DB 저장은 성공하고 캐시 삭제는 실패하는 상황입니다.
      await joinMember(room);

      const bypassed = await getDetail(room);

      expect(bypassed.status).toBe(200);
      expect(bypassed.headers["x-cache"]).toBe("BYPASS");
      expect(bypassed.body.data.room.participantCount).toBe(2);

      await connectCache();

      // 삭제 실패를 기억하고 있어 이전 1명 캐시를 사용하지 않아야 합니다.
      const recovered = await getDetail(room);

      expect(recovered.status).toBe(200);
      expect(recovered.headers["x-cache"]).toBe("MISS");
      expect(recovered.body.data.room.participantCount).toBe(2);

      const next = await getDetail(room);

      expect(next.headers["x-cache"]).toBe("HIT");
      expect(next.body.data.room.participantCount).toBe(2);
    } finally {
      await connectCache();
    }
  });
});
