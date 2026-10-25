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

const prefix = `cand-${randomUUID().slice(0, 8)}-`;

const validInput = {
  name: "주말 카페",
  address: "서울특별시 마포구 테스트로 10",
  mapUrl: "https://map.naver.com/",
  memo: "대화하기 좋아 보여요.",
};

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

async function createRoom(suffix) {
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
    inviteToken: new URL(inviteUrl).searchParams.get("invite"),
    cookie: getCookie(response, room.id),
  };
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

function postCandidate(room, changes = {}, cookie = room.cookie) {
  const pending = request(app)
    .post(`/api/rooms/${room.roomId}/candidates`)
    .set("Origin", env.frontendOrigin);

  if (cookie) {
    pending.set("Cookie", cookie);
  }

  return pending.send({
    ...validInput,
    ...changes,
  });
}

function getCandidates(room, cookie = room.cookie) {
  const pending = request(app).get(`/api/rooms/${room.roomId}/candidates`);

  if (cookie) {
    pending.set("Cookie", cookie);
  }

  return pending;
}

function countCandidates(roomId) {
  return prisma.placeCandidate.count({
    where: { roomId },
  });
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

  // 이 테스트에서 만든 모임의 데이터만 삭제합니다.
  const rooms = await prisma.room.findMany({
    where: {
      name: {
        startsWith: prefix,
      },
    },
    select: {
      id: true,
    },
  });

  const roomIds = rooms.map((room) => room.id);

  if (roomIds.length === 0) {
    return;
  }

  await prisma.$transaction(async (tx) => {
    // 등록자 관계의 Restrict 제약을 고려해 후보부터 삭제합니다.
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
  await prisma.$disconnect();
});

describe("장소 후보 등록 및 조회", () => {
  it("방장이 후보를 등록하고 DB에 저장한다", async () => {
    const room = await createRoom("host");

    const response = await postCandidate(room);

    expect(response.status).toBe(201);
    expect(response.headers["cache-control"]).toBe("no-store");

    const candidate = response.body.data.candidate;

    expect(candidate).toMatchObject({
      ...validInput,
      createdBy: {
        id: room.hostId,
        nickname: "테스트방장",
      },
    });

    const saved = await prisma.placeCandidate.findUnique({
      where: {
        id: candidate.id,
      },
    });

    expect(saved).toMatchObject({
      ...validInput,
      roomId: room.roomId,
      createdById: room.hostId,
    });

    expect(Object.keys(candidate).sort()).toEqual([
      "address",
      "createdAt",
      "createdBy",
      "id",
      "mapUrl",
      "memo",
      "name",
      "updatedAt",
    ]);

    expect(Object.keys(candidate.createdBy).sort()).toEqual(["id", "nickname"]);
  });

  it("일반 참여자도 자신의 이름으로 등록하고 조회한다", async () => {
    const room = await createRoom("member");
    const member = await joinMember(room);

    const created = await postCandidate(room, {}, member.cookie);

    expect(created.status).toBe(201);
    expect(created.body.data.candidate.createdBy.id).toBe(member.id);

    const response = await getCandidates(room, member.cookie);

    expect(response.status).toBe(200);
    expect(response.body.data.candidates).toHaveLength(1);
    expect(response.body.data.candidates[0].id).toBe(
      created.body.data.candidate.id,
    );
  });

  it("후보가 없으면 빈 배열을 반환한다", async () => {
    const room = await createRoom("empty");

    const response = await getCandidates(room);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      data: {
        candidates: [],
      },
    });
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("다른 모임의 후보는 목록에 포함하지 않는다", async () => {
    const first = await createRoom("first");
    const second = await createRoom("second");

    const firstCreated = await postCandidate(first);
    const secondCreated = await postCandidate(second, {
      name: "다른 모임 장소",
    });

    expect(firstCreated.status).toBe(201);
    expect(secondCreated.status).toBe(201);

    const response = await getCandidates(first);

    expect(response.status).toBe(200);

    expect(
      response.body.data.candidates.map((candidate) => candidate.id),
    ).toEqual([firstCreated.body.data.candidate.id]);
  });

  it("생성 시간이 같으면 ID 순서로 조회한다", async () => {
    const room = await createRoom("order");

    const earlierId = "00000000-0000-4000-8000-000000000001";
    const laterId = "00000000-0000-4000-8000-000000000002";

    // 실행마다 다른 ID를 사용하면서 사전순 정렬도 검증합니다.
    const ids = [randomUUID(), randomUUID()].sort();
    const createdAt = new Date("2026-01-01T00:00:00.000Z");

    await prisma.placeCandidate.createMany({
      data: [
        {
          id: ids[1],
          roomId: room.roomId,
          createdById: room.hostId,
          name: "두 번째",
          address: "서울",
          createdAt,
        },
        {
          id: ids[0],
          roomId: room.roomId,
          createdById: room.hostId,
          name: "첫 번째",
          address: "서울",
          createdAt,
        },
      ],
    });

    const response = await getCandidates(room);

    expect(response.status).toBe(200);
    expect(
      response.body.data.candidates.map((candidate) => candidate.id),
    ).toEqual(ids);
  });

  it("쿠키가 없으면 등록과 조회를 거절한다", async () => {
    const room = await createRoom("no-cookie");

    const created = await postCandidate(room, {}, null);
    const listed = await getCandidates(room, null);

    expect(created.status).toBe(401);
    expect(listed.status).toBe(401);
    expect(await countCandidates(room.roomId)).toBe(0);
  });

  it("다른 모임의 토큰은 쿠키 이름을 바꿔도 사용할 수 없다", async () => {
    const first = await createRoom("cookie-first");
    const second = await createRoom("cookie-second");

    const token = first.cookie.slice(first.cookie.indexOf("=") + 1);

    const forgedCookie = `eg_session_${second.roomId}=${token}`;

    const created = await postCandidate(second, {}, forgedCookie);

    const listed = await getCandidates(second, forgedCookie);

    expect(created.status).toBe(401);
    expect(listed.status).toBe(401);
    expect(await countCandidates(second.roomId)).toBe(0);
  });

  it("만료된 세션으로 등록하거나 조회할 수 없다", async () => {
    const room = await createRoom("expired");

    await prisma.participantSession.updateMany({
      where: {
        participantId: room.hostId,
      },
      data: {
        expiresAt: new Date(Date.now() - 1000),
      },
    });

    const created = await postCandidate(room);
    const listed = await getCandidates(room);

    expect(created.status).toBe(401);
    expect(listed.status).toBe(401);
    expect(await countCandidates(room.roomId)).toBe(0);
  });

  it.each([
    ["빈 장소명", { name: "   " }],
    ["실행 가능한 URL", { mapUrl: "javascript:alert(1)" }],
    ["잘못된 URL", { mapUrl: "지도 링크" }],
    ["등록자 조작", { createdById: randomUUID() }],
    ["모임 조작", { roomId: randomUUID() }],
  ])("%s 요청은 저장하지 않는다", async (_label, changes) => {
    const room = await createRoom("invalid");

    const response = await postCandidate(room, changes);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
    expect(await countCandidates(room.roomId)).toBe(0);
  });

  it("Origin이 없으면 등록을 거절한다", async () => {
    const room = await createRoom("origin");

    const response = await request(app)
      .post(`/api/rooms/${room.roomId}/candidates`)
      .set("Cookie", room.cookie)
      .send(validInput);

    expect(response.status).toBe(403);
    expect(await countCandidates(room.roomId)).toBe(0);
  });

  it("JSON이 아닌 등록 요청은 415를 반환한다", async () => {
    const room = await createRoom("content-type");

    const response = await request(app)
      .post(`/api/rooms/${room.roomId}/candidates`)
      .set("Origin", env.frontendOrigin)
      .set("Cookie", room.cookie)
      .type("form")
      .send(validInput);

    expect(response.status).toBe(415);
    expect(await countCandidates(room.roomId)).toBe(0);
  });

  it("확정된 모임은 등록을 막고 기존 목록 조회는 허용한다", async () => {
    const room = await createRoom("closed");

    const first = await postCandidate(room);

    expect(first.status).toBe(201);

    await prisma.room.update({
      where: {
        id: room.roomId,
      },
      data: {
        status: "FINALIZED",
      },
    });

    const created = await postCandidate(room);
    const listed = await getCandidates(room);

    expect(created.status).toBe(409);
    expect(created.body.error.code).toBe("ROOM_CLOSED");

    expect(listed.status).toBe(200);
    expect(listed.body.data.candidates).toHaveLength(1);
    expect(await countCandidates(room.roomId)).toBe(1);
  });

  it("후보가 49개일 때 동시 등록해도 50개를 넘지 않는다", async () => {
    const room = await createRoom("limit");

    await prisma.placeCandidate.createMany({
      data: Array.from({ length: 49 }, (_, index) => ({
        roomId: room.roomId,
        createdById: room.hostId,
        name: `기존 후보 ${index + 1}`,
        address: "서울특별시 마포구",
      })),
    });

    const responses = await Promise.all([
      postCandidate(room, { name: "동시 후보 A" }),
      postCandidate(room, { name: "동시 후보 B" }),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([
      201, 409,
    ]);

    const rejected = responses.find((response) => response.status === 409);

    expect(rejected.body.error.code).toBe("CANDIDATE_LIMIT_REACHED");

    expect(await countCandidates(room.roomId)).toBe(50);

    const listed = await getCandidates(room);

    expect(listed.status).toBe(200);
    expect(listed.body.data.candidates).toHaveLength(50);
  });
});
