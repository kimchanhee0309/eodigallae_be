import { randomUUID } from "node:crypto";

import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
} from "@jest/globals";

import { prisma } from "../../dist/config/db.js";
import { generateToken, hashToken } from "../../dist/utils/token.js";

const createdUserIds = [];
const createdRoomIds = [];

let databaseVerified = false;

// DB 제약조건 확인용 값입니다.
// 실제 비밀번호 해싱·검증은 회원가입 API 단계에서 구현합니다.
const testPasswordHash = "$test-only$not-a-real-password-hash";

function newLoginId() {
  return `t_${randomUUID().replaceAll("-", "").slice(0, 20)}`;
}

async function createUser() {
  const id = randomUUID();

  createdUserIds.push(id);

  return prisma.user.create({
    data: {
      id,
      nickname: "테스트회원",
    },
  });
}

async function createRoom(meetingDate = null) {
  const id = randomUUID();

  createdRoomIds.push(id);

  return prisma.room.create({
    data: {
      id,
      name: "회원 구조 테스트",
      inviteTokenHash: hashToken(generateToken()),
      meetingDate,
    },
  });
}

beforeAll(async () => {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("테스트 환경이 아닙니다.");
  }

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

  // 이 파일에서 생성한 모임과 회원만 정리합니다.
  if (createdRoomIds.length > 0) {
    await prisma.room.deleteMany({
      where: {
        id: {
          in: [...createdRoomIds],
        },
      },
    });
  }

  if (createdUserIds.length > 0) {
    await prisma.user.deleteMany({
      where: {
        id: {
          in: [...createdUserIds],
        },
      },
    });
  }

  createdRoomIds.length = 0;
  createdUserIds.length = 0;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("회원 DB 구조와 제약조건", () => {
  it("동일한 로그인 아이디를 두 회원이 사용할 수 없다", async () => {
    const first = await createUser();
    const second = await createUser();
    const loginId = newLoginId();

    await prisma.localCredential.create({
      data: {
        userId: first.id,
        loginId,
        passwordHash: testPasswordHash,
      },
    });

    await expect(
      prisma.localCredential.create({
        data: {
          userId: second.id,
          loginId,
          passwordHash: testPasswordHash,
        },
      }),
    ).rejects.toMatchObject({
      code: "P2002",
    });
  });

  it("한 회원에게 직접 로그인 정보를 중복 생성할 수 없다", async () => {
    const user = await createUser();

    await prisma.localCredential.create({
      data: {
        userId: user.id,
        loginId: newLoginId(),
        passwordHash: testPasswordHash,
      },
    });

    await expect(
      prisma.localCredential.create({
        data: {
          userId: user.id,
          loginId: newLoginId(),
          passwordHash: testPasswordHash,
        },
      }),
    ).rejects.toMatchObject({
      code: "P2002",
    });
  });

  it("같은 소셜 계정을 서로 다른 회원에게 연결할 수 없다", async () => {
    const first = await createUser();
    const second = await createUser();
    const providerAccountId = randomUUID();

    await prisma.oAuthAccount.create({
      data: {
        provider: "GOOGLE",
        providerAccountId,
        userId: first.id,
      },
    });

    await expect(
      prisma.oAuthAccount.create({
        data: {
          provider: "GOOGLE",
          providerAccountId,
          userId: second.id,
        },
      }),
    ).rejects.toMatchObject({
      code: "P2002",
    });
  });

  it("한 회원에게 같은 제공자의 계정을 여러 개 연결할 수 없다", async () => {
    const user = await createUser();

    await prisma.oAuthAccount.create({
      data: {
        provider: "KAKAO",
        providerAccountId: randomUUID(),
        userId: user.id,
      },
    });

    await expect(
      prisma.oAuthAccount.create({
        data: {
          provider: "KAKAO",
          providerAccountId: randomUUID(),
          userId: user.id,
        },
      }),
    ).rejects.toMatchObject({
      code: "P2002",
    });
  });

  it("제공자가 다르면 식별자 문자열이 같아도 구분한다", async () => {
    const user = await createUser();
    const providerAccountId = randomUUID();

    await prisma.oAuthAccount.createMany({
      data: ["GOOGLE", "NAVER", "KAKAO"].map((provider) => ({
        provider,
        providerAccountId,
        userId: user.id,
      })),
    });

    const accounts = await prisma.oAuthAccount.findMany({
      where: {
        userId: user.id,
      },
    });

    expect(accounts).toHaveLength(3);

    expect(accounts.map((account) => account.provider).sort()).toEqual([
      "GOOGLE",
      "KAKAO",
      "NAVER",
    ]);
  });

  it("동일한 로그인 세션 토큰 해시를 중복 저장할 수 없다", async () => {
    const first = await createUser();
    const second = await createUser();

    const tokenHash = hashToken(generateToken());
    const expiresAt = new Date(Date.now() + 60_000);

    await prisma.userSession.create({
      data: {
        userId: first.id,
        tokenHash,
        expiresAt,
      },
    });

    await expect(
      prisma.userSession.create({
        data: {
          userId: second.id,
          tokenHash,
          expiresAt,
        },
      }),
    ).rejects.toMatchObject({
      code: "P2002",
    });
  });

  it("회원의 같은 모임 중복 참여를 막고 비회원 여러 명은 허용한다", async () => {
    const user = await createUser();
    const room = await createRoom();

    await prisma.participant.create({
      data: {
        roomId: room.id,
        userId: user.id,
        nickname: "회원",
      },
    });

    await expect(
      prisma.participant.create({
        data: {
          roomId: room.id,
          userId: user.id,
          nickname: "중복회원",
        },
      }),
    ).rejects.toMatchObject({
      code: "P2002",
    });

    await prisma.participant.createMany({
      data: [
        {
          roomId: room.id,
          userId: null,
          nickname: "비회원하나",
        },
        {
          roomId: room.id,
          userId: null,
          nickname: "비회원둘",
        },
      ],
    });

    expect(
      await prisma.participant.count({
        where: {
          roomId: room.id,
        },
      }),
    ).toBe(3);

    // 같은 회원이 다른 모임에 참여하는 것은 허용합니다.
    const otherRoom = await createRoom();

    const participation = await prisma.participant.create({
      data: {
        roomId: otherRoom.id,
        userId: user.id,
        nickname: "회원",
      },
    });

    expect(participation.userId).toBe(user.id);
  });

  it("약속 날짜를 저장하고 날짜 미정 모임도 허용한다", async () => {
    const scheduled = await createRoom(new Date("2026-11-14T00:00:00.000Z"));

    const unscheduled = await createRoom();

    const saved = await prisma.room.findUniqueOrThrow({
      where: {
        id: scheduled.id,
      },
    });

    expect(saved.meetingDate.toISOString()).toBe("2026-11-14T00:00:00.000Z");

    expect(saved.finalizedAt).toBeNull();
    expect(unscheduled.meetingDate).toBeNull();
  });
});
