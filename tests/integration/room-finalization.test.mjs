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

const prefix = `final-${randomUUID().slice(0, 8)}-`;

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

async function createFixture(suffix, withCandidates = true) {
  const response = await request(app)
    .post("/api/rooms")
    .send({
      name: `${prefix}${suffix}`,
      hostNickname: "테스트방장",
    });

  expect(response.status).toBe(201);

  const { room, participant, inviteUrl } = response.body.data;

  const fixture = {
    roomId: room.id,
    hostId: participant.id,
    cookie: getCookie(response, room.id),
    inviteToken: new URL(inviteUrl).searchParams.get("invite"),
    a: randomUUID(),
    b: randomUUID(),
  };

  if (withCandidates) {
    await prisma.placeCandidate.createMany({
      data: [
        {
          id: fixture.a,
          roomId: fixture.roomId,
          createdById: fixture.hostId,
          name: "후보 A",
          address: "서울특별시 마포구",
          mapUrl: "https://map.naver.com/",
          memo: "대화하기 좋은 곳",
        },
        {
          id: fixture.b,
          roomId: fixture.roomId,
          createdById: fixture.hostId,
          name: "후보 B",
          address: "서울특별시 성동구",
        },
      ],
    });
  }

  return fixture;
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

function postFinalize(room, candidateId = room.a, cookie = room.cookie) {
  const pending = request(app)
    .post(`/api/rooms/${room.roomId}/finalize`)
    .set("Origin", env.frontendOrigin);

  if (cookie) {
    pending.set("Cookie", cookie);
  }

  return pending.send({ candidateId });
}

function getDetail(room, cookie = room.cookie) {
  return request(app).get(`/api/rooms/${room.roomId}`).set("Cookie", cookie);
}

function readRoom(roomId) {
  return prisma.room.findUniqueOrThrow({
    where: { id: roomId },
    select: {
      id: true,
      status: true,
      finalizedCandidateId: true,
      finalizedAt: true,
      updatedAt: true,
    },
  });
}

beforeAll(async () => {
  const result = await prisma.$queryRaw`
    SELECT current_database() AS database_name
  `;

  if (result[0]?.database_name !== "eodigallae_test") {
    throw new Error("테スト DB가 아닙니다.");
  }

  databaseVerified = true;
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

  await prisma.$transaction(async (tx) => {
    // 후보 삭제 전에 확정 연결을 먼저 해제합니다.
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
  await prisma.$disconnect();
});

describe("최종 장소 확정", () => {
  it("투표가 없어도 방장이 후보를 확정할 수 있다", async () => {
    const room = await createFixture("host");

    const response = await postFinalize(room);

    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");

    expect(response.body.data).toMatchObject({
      roomId: room.roomId,
      status: "FINALIZED",
      finalizedCandidate: {
        id: room.a,
        name: "후보 A",
        address: "서울특별시 마포구",
        mapUrl: "https://map.naver.com/",
        memo: "대화하기 좋은 곳",
      },
    });

    const saved = await readRoom(room.roomId);

    expect(saved.status).toBe("FINALIZED");
    expect(saved.finalizedCandidateId).toBe(room.a);
    expect(saved.finalizedAt).toBeInstanceOf(Date);

    expect(response.body.data.finalizedAt).toBe(
      saved.finalizedAt.toISOString(),
    );

    expect(Object.keys(response.body.data).sort()).toEqual([
      "finalizedAt",
      "finalizedCandidate",
      "roomId",
      "status",
    ]);

    expect(Object.keys(response.body.data.finalizedCandidate).sort()).toEqual([
      "address",
      "id",
      "mapUrl",
      "memo",
      "name",
    ]);
  });

  it("일반 참여자도 상세 조회에서 확정 결과를 확인한다", async () => {
    const room = await createFixture("detail");
    const member = await joinMember(room);

    const finalized = await postFinalize(room);

    expect(finalized.status).toBe(200);

    const response = await getDetail(room, member.cookie);

    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");

    expect(response.body.data.room.status).toBe("FINALIZED");
    expect(response.body.data.room.finalizedAt).toBe(
      finalized.body.data.finalizedAt,
    );

    expect(response.body.data.room.finalizedCandidate).toEqual(
      finalized.body.data.finalizedCandidate,
    );
  });

  it("같은 후보로 재요청해도 확정 시각과 DB 상태를 유지한다", async () => {
    const room = await createFixture("repeat");

    expect((await postFinalize(room)).status).toBe(200);

    // 시간 경과를 기다리지 않고 시각 유지 여부를 검증합니다.
    const fixedTime = new Date("2026-01-01T00:00:00.000Z");

    await prisma.room.update({
      where: { id: room.roomId },
      data: { finalizedAt: fixedTime },
    });

    const before = await readRoom(room.roomId);
    const response = await postFinalize(room);

    expect(response.status).toBe(200);
    expect(response.body.data.finalizedAt).toBe(fixedTime.toISOString());
    expect(await readRoom(room.roomId)).toEqual(before);
  });

  it("다른 후보로 재요청하면 기존 확정 결과를 유지한다", async () => {
    const room = await createFixture("change");

    expect((await postFinalize(room)).status).toBe(200);
    const before = await readRoom(room.roomId);

    const response = await postFinalize(room, room.b);

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("ROOM_ALREADY_FINALIZED");

    expect(await readRoom(room.roomId)).toEqual(before);
  });

  it.each(["same", "different"])(
    "%s 후보를 동시에 확정해도 결과가 하나로 유지된다",
    async (mode) => {
      const room = await createFixture("concurrent");

      const secondCandidate = mode === "same" ? room.a : room.b;

      const responses = await Promise.all([
        postFinalize(room, room.a),
        postFinalize(room, secondCandidate),
      ]);

      const statuses = responses.map((response) => response.status).sort();

      expect(statuses).toEqual(mode === "same" ? [200, 200] : [200, 409]);

      const saved = await readRoom(room.roomId);

      expect(saved.status).toBe("FINALIZED");

      for (const response of responses) {
        if (response.status === 200) {
          expect(response.body.data.finalizedCandidate.id).toBe(
            saved.finalizedCandidateId,
          );

          expect(response.body.data.finalizedAt).toBe(
            saved.finalizedAt.toISOString(),
          );
        } else {
          expect(response.body.error.code).toBe("ROOM_ALREADY_FINALIZED");
        }
      }
    },
  );

  it("일반 참여자는 확정 전과 확정 후 모두 요청할 수 없다", async () => {
    const room = await createFixture("member");
    const member = await joinMember(room);

    const before = await readRoom(room.roomId);

    const denied = await postFinalize(room, room.a, member.cookie);

    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe("FORBIDDEN");
    expect(await readRoom(room.roomId)).toEqual(before);

    expect((await postFinalize(room)).status).toBe(200);
    const finalized = await readRoom(room.roomId);

    const repeated = await postFinalize(room, room.a, member.cookie);

    expect(repeated.status).toBe(403);
    expect(await readRoom(room.roomId)).toEqual(finalized);
  });

  it("다른 모임의 후보는 확정할 수 없다", async () => {
    const first = await createFixture("first");
    const second = await createFixture("second");

    const before = await readRoom(first.roomId);

    const response = await postFinalize(first, second.a);

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("CANDIDATE_NOT_FOUND");
    expect(await readRoom(first.roomId)).toEqual(before);
  });

  it("후보가 없는 모임에서는 확정할 수 없다", async () => {
    const room = await createFixture("empty", false);

    const response = await postFinalize(room, randomUUID());

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("CANDIDATE_NOT_FOUND");

    const saved = await readRoom(room.roomId);

    expect(saved.status).toBe("OPEN");
    expect(saved.finalizedAt).toBeNull();
    expect(saved.finalizedCandidateId).toBeNull();
  });

  it("쿠키가 없으면 거절한다", async () => {
    const room = await createFixture("no-cookie");
    const before = await readRoom(room.roomId);

    const response = await postFinalize(room, room.a, null);

    expect(response.status).toBe(401);
    expect(await readRoom(room.roomId)).toEqual(before);
  });

  it("다른 모임의 토큰은 쿠키 이름을 바꿔도 거절한다", async () => {
    const first = await createFixture("cookie-first");
    const second = await createFixture("cookie-second");

    const token = first.cookie.slice(first.cookie.indexOf("=") + 1);

    const cookie = `eg_session_${second.roomId}=${token}`;
    const before = await readRoom(second.roomId);

    const response = await postFinalize(second, second.a, cookie);

    expect(response.status).toBe(401);
    expect(await readRoom(second.roomId)).toEqual(before);
  });

  it("만료된 방장 세션을 거절한다", async () => {
    const room = await createFixture("expired");

    await prisma.participantSession.updateMany({
      where: {
        participantId: room.hostId,
      },
      data: {
        expiresAt: new Date(Date.now() - 1000),
      },
    });

    const before = await readRoom(room.roomId);
    const response = await postFinalize(room);

    expect(response.status).toBe(401);
    expect(await readRoom(room.roomId)).toEqual(before);
  });

  it.each([
    ["Origin 없음", null],
    ["다른 Origin", "https://untrusted.example"],
  ])("%s 요청을 거절한다", async (_label, origin) => {
    const room = await createFixture("origin");

    const pending = request(app)
      .post(`/api/rooms/${room.roomId}/finalize`)
      .set("Cookie", room.cookie);

    if (origin) {
      pending.set("Origin", origin);
    }

    const before = await readRoom(room.roomId);
    const response = await pending.send({
      candidateId: room.a,
    });

    expect(response.status).toBe(403);
    expect(await readRoom(room.roomId)).toEqual(before);
  });

  it("JSON이 아닌 요청은 415를 반환한다", async () => {
    const room = await createFixture("content-type");
    const before = await readRoom(room.roomId);

    const response = await request(app)
      .post(`/api/rooms/${room.roomId}/finalize`)
      .set("Origin", env.frontendOrigin)
      .set("Cookie", room.cookie)
      .type("form")
      .send({ candidateId: room.a });

    expect(response.status).toBe(415);
    expect(await readRoom(room.roomId)).toEqual(before);
  });

  it.each([
    ["후보 생략", {}],
    ["잘못된 후보 ID", { candidateId: "wrong-id" }],
    ["후보 null", { candidateId: null }],
    [
      "확정 시각 조작",
      {
        candidateId: randomUUID(),
        finalizedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
  ])("%s 요청은 상태를 변경하지 않는다", async (_label, body) => {
    const room = await createFixture("invalid");
    const before = await readRoom(room.roomId);

    const response = await request(app)
      .post(`/api/rooms/${room.roomId}/finalize`)
      .set("Origin", env.frontendOrigin)
      .set("Cookie", room.cookie)
      .send(body);

    expect(response.status).toBe(400);
    expect(await readRoom(room.roomId)).toEqual(before);
  });

  it("확정 후 후보 등록·투표·참여·초대 재발급을 막는다", async () => {
    const room = await createFixture("closed");

    const firstVote = await request(app)
      .post(`/api/rooms/${room.roomId}/votes`)
      .set("Origin", env.frontendOrigin)
      .set("Cookie", room.cookie)
      .send({ candidateId: room.a });

    expect(firstVote.status).toBe(200);
    expect((await postFinalize(room)).status).toBe(200);

    const roomBefore = await readRoom(room.roomId);

    const votesBefore = await prisma.placeVote.findMany({
      where: { roomId: room.roomId },
    });

    const participantsBefore = await prisma.participant.count({
      where: { roomId: room.roomId },
    });

    const requests = [
      ["candidates", { name: "새 후보", address: "서울" }],
      ["votes", { candidateId: room.b }],
      ["votes", { candidateId: null }],
      [
        "join",
        {
          nickname: "새참여자",
          inviteToken: room.inviteToken,
        },
      ],
      ["invite/rotate", {}],
    ];

    for (const [path, body] of requests) {
      const response = await request(app)
        .post(`/api/rooms/${room.roomId}/${path}`)
        .set("Origin", env.frontendOrigin)
        .set("Cookie", room.cookie)
        .send(body);

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe("ROOM_CLOSED");
    }

    expect(await readRoom(room.roomId)).toEqual(roomBefore);

    expect(
      await prisma.placeCandidate.count({
        where: { roomId: room.roomId },
      }),
    ).toBe(2);

    expect(
      await prisma.placeVote.findMany({
        where: { roomId: room.roomId },
      }),
    ).toEqual(votesBefore);

    expect(
      await prisma.participant.count({
        where: { roomId: room.roomId },
      }),
    ).toBe(participantsBefore);
  });

  it("투표와 확정이 동시에 요청돼도 처리 순서에 맞는 결과를 남긴다", async () => {
    const room = await createFixture("vote-race");

    const [finalized, voted] = await Promise.all([
      postFinalize(room),

      request(app)
        .post(`/api/rooms/${room.roomId}/votes`)
        .set("Origin", env.frontendOrigin)
        .set("Cookie", room.cookie)
        .send({ candidateId: room.b }),
    ]);

    expect(finalized.status).toBe(200);
    expect([200, 409]).toContain(voted.status);

    const saved = await readRoom(room.roomId);

    expect(saved.status).toBe("FINALIZED");
    expect(saved.finalizedCandidateId).toBe(room.a);

    const voteCount = await prisma.placeVote.count({
      where: { roomId: room.roomId },
    });

    expect(voteCount).toBe(voted.status === 200 ? 1 : 0);

    if (voted.status === 409) {
      expect(voted.body.error.code).toBe("ROOM_CLOSED");
    }
  });

  it("DB가 다른 모임의 후보를 확정 장소로 연결하는 것을 막는다", async () => {
    const first = await createFixture("fk-first");
    const second = await createFixture("fk-second");

    const before = await readRoom(first.roomId);

    await expect(
      prisma.room.updateMany({
        where: { id: first.roomId },
        data: {
          status: "FINALIZED",
          finalizedCandidateId: second.a,
          finalizedAt: new Date(),
        },
      }),
    ).rejects.toMatchObject({
      code: "P2003",
    });

    expect(await readRoom(first.roomId)).toEqual(before);
  });

  it("DB가 확정된 후보의 직접 삭제를 막는다", async () => {
    const room = await createFixture("delete");

    expect((await postFinalize(room)).status).toBe(200);
    const before = await readRoom(room.roomId);

    await expect(
      prisma.placeCandidate.delete({
        where: { id: room.a },
      }),
    ).rejects.toMatchObject({
      code: "P2003",
    });

    expect(await readRoom(room.roomId)).toEqual(before);

    expect(
      await prisma.placeCandidate.count({
        where: { id: room.a },
      }),
    ).toBe(1);
  });
});
