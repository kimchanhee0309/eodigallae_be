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
import { setVote } from "../../dist/services/vote.service.js";

const prefix = `vote-${randomUUID().slice(0, 8)}-`;

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

function postVote(room, candidateId, cookie = room.cookie) {
  const pending = request(app)
    .post(`/api/rooms/${room.roomId}/votes`)
    .set("Origin", env.frontendOrigin);

  if (cookie) {
    pending.set("Cookie", cookie);
  }

  return pending.send({ candidateId });
}

function getVotes(room, cookie = room.cookie) {
  const pending = request(app).get(`/api/rooms/${room.roomId}/votes`);

  if (cookie) {
    pending.set("Cookie", cookie);
  }

  return pending;
}

function readSavedVotes(roomId) {
  return prisma.placeVote.findMany({
    where: { roomId },
    orderBy: { participantId: "asc" },
  });
}

function expectCounts(data, room, a, b) {
  expect(data.totalVotes).toBe(a + b);

  const counts = Object.fromEntries(
    data.candidates.map((candidate) => [
      candidate.candidateId,
      candidate.voteCount,
    ]),
  );

  expect(counts).toEqual({
    [room.a]: a,
    [room.b]: b,
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

describe("장소 후보 투표", () => {
  it("후보가 없으면 빈 결과를 반환한다", async () => {
    const room = await createFixture("empty", false);

    const response = await getVotes(room);

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({
      myCandidateId: null,
      totalVotes: 0,
      candidates: [],
    });
  });

  it("투표하지 않은 후보도 0표로 반환한다", async () => {
    const room = await createFixture("zero");

    const response = await getVotes(room);

    expect(response.status).toBe(200);
    expect(response.body.data.myCandidateId).toBeNull();

    expectCounts(response.body.data, room, 0, 0);
  });

  it("방장의 투표를 저장하고 필요한 결과만 반환한다", async () => {
    const room = await createFixture("host");

    const response = await postVote(room, room.a);

    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body.data.myCandidateId).toBe(room.a);

    expectCounts(response.body.data, room, 1, 0);

    const saved = await readSavedVotes(room.roomId);

    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      roomId: room.roomId,
      participantId: room.hostId,
      candidateId: room.a,
    });

    expect(Object.keys(response.body.data).sort()).toEqual([
      "candidates",
      "myCandidateId",
      "totalVotes",
    ]);

    for (const candidate of response.body.data.candidates) {
      expect(Object.keys(candidate).sort()).toEqual([
        "candidateId",
        "voteCount",
      ]);
    }
  });

  it("같은 후보에 반복 요청해도 1표만 유지한다", async () => {
    const room = await createFixture("repeat");

    const first = await postVote(room, room.a);
    const second = await postVote(room, room.a);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body.data.myCandidateId).toBe(room.a);

    expectCounts(second.body.data, room, 1, 0);
    expect(await readSavedVotes(room.roomId)).toHaveLength(1);
  });

  it("다른 후보를 선택하면 기존 표를 이동한다", async () => {
    const room = await createFixture("change");

    expect((await postVote(room, room.a)).status).toBe(200);

    const response = await postVote(room, room.b);

    expect(response.status).toBe(200);
    expect(response.body.data.myCandidateId).toBe(room.b);

    expectCounts(response.body.data, room, 0, 1);

    const saved = await readSavedVotes(room.roomId);

    expect(saved).toHaveLength(1);
    expect(saved[0].candidateId).toBe(room.b);
  });

  it("취소를 반복해도 0표 상태를 유지한다", async () => {
    const room = await createFixture("cancel");

    expect((await postVote(room, room.a)).status).toBe(200);

    const first = await postVote(room, null);
    const second = await postVote(room, null);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body.data.myCandidateId).toBeNull();

    expectCounts(second.body.data, room, 0, 0);
    expect(await readSavedVotes(room.roomId)).toHaveLength(0);
  });

  it("일반 참여자의 표를 합산하고 내 선택은 별도로 반환한다", async () => {
    const room = await createFixture("member");
    const member = await joinMember(room);

    expect((await postVote(room, room.a)).status).toBe(200);

    const voted = await postVote(room, room.b, member.cookie);

    expect(voted.status).toBe(200);
    expect(voted.body.data.myCandidateId).toBe(room.b);
    expectCounts(voted.body.data, room, 1, 1);

    const hostView = await getVotes(room);
    const memberView = await getVotes(room, member.cookie);

    expect(hostView.status).toBe(200);
    expect(memberView.status).toBe(200);

    expect(hostView.body.data.myCandidateId).toBe(room.a);
    expect(memberView.body.data.myCandidateId).toBe(room.b);

    expectCounts(hostView.body.data, room, 1, 1);
    expectCounts(memberView.body.data, room, 1, 1);

    expect(hostView.headers["cache-control"]).toBe("no-store");
  });

  it("동시에 다른 후보를 선택해도 참여자당 1표만 남는다", async () => {
    const room = await createFixture("concurrent");

    const responses = await Promise.all([
      postVote(room, room.a),
      postVote(room, room.b),
    ]);

    expect(responses.map((response) => response.status)).toEqual([200, 200]);

    const saved = await readSavedVotes(room.roomId);

    expect(saved).toHaveLength(1);
    expect([room.a, room.b]).toContain(saved[0].candidateId);

    const response = await getVotes(room);

    expect(response.status).toBe(200);
    expect(response.body.data.totalVotes).toBe(1);
    expect(response.body.data.myCandidateId).toBe(saved[0].candidateId);

    const selected = response.body.data.candidates.find(
      (candidate) => candidate.candidateId === saved[0].candidateId,
    );

    expect(selected.voteCount).toBe(1);
  });

  it("다른 모임 후보에 투표해도 기존 표는 유지된다", async () => {
    const first = await createFixture("first");
    const second = await createFixture("second");

    expect((await postVote(first, first.a)).status).toBe(200);

    const before = await readSavedVotes(first.roomId);

    const response = await postVote(first, second.a);

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("CANDIDATE_NOT_FOUND");

    expect(await readSavedVotes(first.roomId)).toEqual(before);
    expect(await readSavedVotes(second.roomId)).toHaveLength(0);

    const listed = await getVotes(first);

    expect(listed.status).toBe(200);
    expectCounts(listed.body.data, first, 1, 0);
  });

  it("존재하지 않는 후보는 거절한다", async () => {
    const room = await createFixture("missing");

    const response = await postVote(room, randomUUID());

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("CANDIDATE_NOT_FOUND");
    expect(await readSavedVotes(room.roomId)).toHaveLength(0);
  });

  it("쿠키가 없으면 투표와 조회를 거절한다", async () => {
    const room = await createFixture("no-cookie");

    const voted = await postVote(room, room.a, null);
    const listed = await getVotes(room, null);

    expect(voted.status).toBe(401);
    expect(listed.status).toBe(401);
    expect(await readSavedVotes(room.roomId)).toHaveLength(0);
  });

  it("다른 모임의 토큰을 쿠키 이름만 바꿔 보내도 거절한다", async () => {
    const first = await createFixture("cookie-first");
    const second = await createFixture("cookie-second");

    const token = first.cookie.slice(first.cookie.indexOf("=") + 1);

    const cookie = `eg_session_${second.roomId}=${token}`;

    const voted = await postVote(second, second.a, cookie);
    const listed = await getVotes(second, cookie);

    expect(voted.status).toBe(401);
    expect(listed.status).toBe(401);
    expect(await readSavedVotes(second.roomId)).toHaveLength(0);
  });

  it("만료된 세션으로는 투표하거나 조회할 수 없다", async () => {
    const room = await createFixture("expired");

    await prisma.participantSession.updateMany({
      where: {
        participantId: room.hostId,
      },
      data: {
        expiresAt: new Date(Date.now() - 1000),
      },
    });

    expect((await postVote(room, room.a)).status).toBe(401);
    expect((await getVotes(room)).status).toBe(401);

    expect(await readSavedVotes(room.roomId)).toHaveLength(0);
  });

  it.each([
    ["등록", false, "a"],
    ["변경", true, "b"],
    ["취소", true, null],
  ])("확정된 모임에서는 투표 %s을 막는다", async (_label, hasVote, target) => {
    const room = await createFixture("closed");

    if (hasVote) {
      expect((await postVote(room, room.a)).status).toBe(200);
    }

    await prisma.room.update({
      where: { id: room.roomId },
      data: { status: "FINALIZED" },
    });

    const before = await readSavedVotes(room.roomId);
    const candidateId = target === null ? null : room[target];

    const response = await postVote(room, candidateId);

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("ROOM_CLOSED");
    expect(await readSavedVotes(room.roomId)).toEqual(before);

    const listed = await getVotes(room);

    expect(listed.status).toBe(200);
    expect(listed.body.data.myCandidateId).toBe(hasVote ? room.a : null);
    expectCounts(listed.body.data, room, hasVote ? 1 : 0, 0);
  });

  it.each([
    ["필드 생략", {}],
    ["잘못된 UUID", { candidateId: "wrong-id" }],
    [
      "참여자 조작",
      {
        candidateId: null,
        participantId: randomUUID(),
      },
    ],
    [
      "모임 조작",
      {
        candidateId: null,
        roomId: randomUUID(),
      },
    ],
  ])("%s 요청으로 기존 표를 변경할 수 없다", async (_label, body) => {
    const room = await createFixture("invalid");

    expect((await postVote(room, room.a)).status).toBe(200);
    const before = await readSavedVotes(room.roomId);

    const response = await request(app)
      .post(`/api/rooms/${room.roomId}/votes`)
      .set("Origin", env.frontendOrigin)
      .set("Cookie", room.cookie)
      .send(body);

    expect(response.status).toBe(400);
    expect(await readSavedVotes(room.roomId)).toEqual(before);
  });

  it.each([
    ["Origin 없음", null],
    ["다른 Origin", "https://untrusted.example"],
  ])("%s 요청은 거절한다", async (_label, origin) => {
    const room = await createFixture("origin");

    const pending = request(app)
      .post(`/api/rooms/${room.roomId}/votes`)
      .set("Cookie", room.cookie);

    if (origin) {
      pending.set("Origin", origin);
    }

    const response = await pending.send({
      candidateId: room.a,
    });

    expect(response.status).toBe(403);
    expect(await readSavedVotes(room.roomId)).toHaveLength(0);
  });

  it("JSON이 아닌 요청은 415를 반환한다", async () => {
    const room = await createFixture("content-type");

    const response = await request(app)
      .post(`/api/rooms/${room.roomId}/votes`)
      .set("Origin", env.frontendOrigin)
      .set("Cookie", room.cookie)
      .type("form")
      .send({ candidateId: room.a });

    expect(response.status).toBe(415);
    expect(await readSavedVotes(room.roomId)).toHaveLength(0);
  });

  it("서비스에서도 다른 모임 참여자의 투표를 거절한다", async () => {
    const first = await createFixture("service-first");
    const second = await createFixture("service-second");

    await expect(
      setVote(second.roomId, first.hostId, {
        candidateId: second.a,
      }),
    ).rejects.toMatchObject({
      statusCode: 403,
      code: "FORBIDDEN",
    });

    expect(await readSavedVotes(second.roomId)).toHaveLength(0);
  });

  it("DB가 동일 참여자의 두 번째 투표 행을 막는다", async () => {
    const room = await createFixture("db-unique");

    expect((await postVote(room, room.a)).status).toBe(200);

    await expect(
      prisma.placeVote.createMany({
        data: [
          {
            roomId: room.roomId,
            participantId: room.hostId,
            candidateId: room.b,
          },
        ],
      }),
    ).rejects.toMatchObject({
      code: "P2002",
    });

    const saved = await readSavedVotes(room.roomId);

    expect(saved).toHaveLength(1);
    expect(saved[0].candidateId).toBe(room.a);
  });

  it.each(["candidate", "participant"])(
    "DB가 다른 모임의 %s 연결을 막는다",
    async (target) => {
      const first = await createFixture("fk-first");
      const second = await createFixture("fk-second");

      await expect(
        prisma.placeVote.createMany({
          data: [
            {
              roomId: first.roomId,
              participantId:
                target === "participant" ? second.hostId : first.hostId,
              candidateId: target === "candidate" ? second.a : first.a,
            },
          ],
        }),
      ).rejects.toMatchObject({
        code: "P2003",
      });

      expect(await readSavedVotes(first.roomId)).toHaveLength(0);
      expect(await readSavedVotes(second.roomId)).toHaveLength(0);
    },
  );
});
