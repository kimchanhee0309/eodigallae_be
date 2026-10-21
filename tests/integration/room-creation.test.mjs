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
import { createRoom } from "../../dist/services/room.service.js";
import { startsWith } from "zod";

const prefix = `it-${randomUUID().slice(0, 8)}-`;

let databaseVerified = false;

function makeInput(suffix) {
  return {
    name: `${prefix}${suffix}`,
    hostNickname: "테스트방장",
    description: "방 생성 통합 테스트",
  };
}

async function postRoom(suffix) {
  const response = await request(app)
    .post("/api/rooms")
    .send(makeInput(suffix));

  expect(response.status).toBe(201);

  return response;
}

async function readCounts() {
  const [rooms, participants, sessions] = await Promise.all([
    prisma.room.count(),
    prisma.participant.count(),
    prisma.participantSession.count(),
  ]);

  return { rooms, participants, sessions };
}

beforeAll(async () => {
  const result = await prisma.$queryRaw`
  SELECT current_database() AS database_name`;

  if (result[0]?.database_name !== "eodigallae_test") {
    throw new Error("실제 접속 DB가 테스트 DB와 다릅니다.");
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

describe("방 생성 API 통합 테스트", () => {
  it("방·방장·세션을 함께 저장한다", async () => {
    const response = await postRoom("create");

    const savedRoom = await prisma.room.findUnique({
      where: {
        id: response.body.data.room.id,
      },
      include: {
        participants: {
          include: {
            sessions: true,
          },
        },
      },
    });

    expect(savedRoom).not.toBeNull();
    expect(savedRoom.name).toBe(`${prefix}create`);
    expect(savedRoom.status).toBe("OPEN");

    expect(savedRoom.participants).toHaveLength(1);

    const host = savedRoom.participants[0];

    expect(host.id).toBe(response.body.data.participant.id);
    expect(host.nickname).toBe("테스트방장");
    expect(host.role).toBe("HOST");
    expect(host.sessions).toHaveLength(1);

    expect(host.sessions[0].expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("토큰 원문 대신 해시를 저장하고 응답을 제한한다.", async () => {
    const response = await postRoom("tokens");

    const { room, participant, inviteUrl } = response.body.data;

    const cookieName = `eg_session_${room.id}`;

    const cookie = response.headers["set-cookie"]?.find((value) =>
      value.startsWith(`${cookieName}=`),
    );

    expect(cookie).toBeDefined();

    if (!cookie) {
      throw new Error("세션 쿠키가 없습니다.");
    }

    const sessionToken = decodeURIComponent(
      cookie.split(";")[0].slice(cookieName.length + 1),
    );
    const inviteToken = new URL(inviteUrl).searchParams.get("invite");

    expect(sessionToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(inviteToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(sessionToken).not.toBe(inviteToken);

    expect(cookie).toMatch(/;\s*HttpOnly/i);
    expect(cookie).toMatch(/;\s*SameSite=Lax/i);
    expect(cookie).toContain(`Path=/api/rooms/${room.id}`);

    const savedSession = await prisma.participantSession.findFirstOrThrow({
      where: {
        participantId: participant.id,
      },
    });

    const savedRoom = await prisma.room.findUniqueOrThrow({
      where: {
        id: room.id,
      },
    });

    const expectedSessionHash = createHash("sha256")
      .update(sessionToken)
      .digest("hex");

    const expectedInviteHash = createHash("sha256")
      .update(inviteToken)
      .digest("hex");

    expect(savedSession.tokenHash).toBe(expectedSessionHash);
    expect(savedRoom.inviteTokenHash).toBe(expectedInviteHash);

    expect(savedSession.tokenHash).not.toBe(sessionToken);
    expect(savedRoom.inviteTokenHash).not.toBe(inviteToken);

    expect(Object.keys(response.body.data).sort()).toEqual([
      "inviteUrl",
      "participant",
      "room",
    ]);

    expect(response.text).not.toContain(sessionToken);
    expect(response.text).not.toContain('"tokenHash"');
    expect(response.text).not.toContain('"inviteTokenHash"');
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("잘못된 입력은 저장하지 않는다.", async () => {
    const before = await readCounts();

    const response = await request(app)
      .post("/api/rooms")
      .send({
        ...makeInput("invalid"),
        hostNickname: "김",
      });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
    expect(response.headers["set-cookie"]).toBeUndefined();

    expect(await readCounts()).toEqual(before);
  });

  it("클라이언트가 역할을 지정한 요청을 거절한다", async () => {
    const before = await readCounts();

    const response = await request(app)
      .post("/api/rooms")
      .send({
        ...makeInput("role"),
        role: "HOSt",
      });

    expect(response.status).toBe(400);
    expect(response.headers["set-cookie"]).toBeUndefined();

    expect(await readCounts()).toEqual(before);
  });

  it("JSON이 아닌 요청은 415로 거절한다", async () => {
    const before = await readCounts();

    const response = await request(app)
      .post("/api/rooms")
      .set("Content-Type", "text/plain")
      .send("create room");

    expect(response.status).toBe(415);

    expect(response.body.error.code).toBe("UNSUPPORTED_MEDIA_TYPE");

    expect(await readCounts()).toEqual(before);
  });

  it("방장 저장이 실패하면 앞서 만든 방도 롤백한다", async () => {
    const before = await readCounts();

    await expect(
      createRoom({
        ...makeInput("rollback"),
        hostNickname: "x".repeat(13),
      }),
    ).rejects.toThrow();

    expect(await readCounts()).toEqual(before);

    expect(
      await prisma.room.findFirst({
        where: {
          name: `${prefix}rollback`,
        },
      }),
    ).toBeNull();
  });

  it("DB가 같은 방의 두 번째 방장 생성을 막는다", async () => {
    const response = await postRoom("duplicate-host");

    const roomId = response.body.data.room.id;

    await expect(
      prisma.participant.create({
        data: {
          roomId,
          nickname: "두번째방장",
          role: "HOST",
        },
      }),
    ).rejects.toThrow();

    expect(
      await prisma.participant.count({
        where: {
          roomId,
          role: "HOST",
        },
      }),
    ).toBe(1);
  });
});
