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
import { verifyPassword } from "../../dist/utils/password.js";

// 테스트에서 생성한 회원을 구분하기 위한 12자 닉네임입니다.
const marker = `su${randomUUID().replaceAll("-", "").slice(0, 10)}`;

const password = "this is a signup test password";

let databaseVerified = false;

function newLoginId() {
  return `su_${randomUUID().replaceAll("-", "").slice(0, 20)}`;
}

function validInput() {
  return {
    loginId: newLoginId(),
    password,
    nickname: marker,
  };
}

function postSignup(input) {
  return request(app)
    .post("/api/auth/signup")
    .set("Origin", env.frontendOrigin)
    .send(input);
}

async function readCounts() {
  const [users, credentials, sessions] = await Promise.all([
    prisma.user.count({
      where: {
        nickname: marker,
      },
    }),

    prisma.localCredential.count({
      where: {
        user: {
          nickname: marker,
        },
      },
    }),

    prisma.userSession.count({
      where: {
        user: {
          nickname: marker,
        },
      },
    }),
  ]);

  return { users, credentials, sessions };
}

beforeAll(async () => {
  if (env.nodeEnv !== "test" || env.rateLimitEnabled) {
    throw new Error(
      "NODE_ENV=test, RATE_LIMIT_ENABLED=false 설정이 필요합니다.",
    );
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

  // 이 파일에서 생성한 회원만 삭제합니다.
  // 연결된 로그인 정보와 세션은 Cascade로 정리됩니다.
  await prisma.user.deleteMany({
    where: {
      nickname: marker,
    },
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("직접 회원가입 API", () => {
  it("아이디를 정규화하고 비밀번호 해시만 저장한다", async () => {
    const input = validInput();

    const response = await postSignup({
      ...input,
      loginId: `  ${input.loginId.toUpperCase()}  `,
    });

    expect(response.status).toBe(201);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["set-cookie"]).toBeUndefined();

    const user = response.body.data.user;

    expect(Object.keys(response.body)).toEqual(["data"]);
    expect(Object.keys(response.body.data)).toEqual(["user"]);

    expect(Object.keys(user).sort()).toEqual(["createdAt", "id", "nickname"]);

    expect(user.nickname).toBe(marker);

    const credential = await prisma.localCredential.findUnique({
      where: {
        loginId: input.loginId,
      },
    });

    expect(credential).not.toBeNull();
    expect(credential.userId).toBe(user.id);
    expect(credential.passwordHash).toMatch(/^\$argon2id\$/);
    expect(credential.passwordHash).not.toBe(input.password);

    expect(await verifyPassword(input.password, credential.passwordHash)).toBe(
      true,
    );

    expect(response.text).not.toContain(input.password);
    expect(response.text).not.toContain(credential.passwordHash);

    expect(await readCounts()).toEqual({
      users: 1,
      credentials: 1,
      sessions: 0,
    });
  });

  it("동시에 같은 아이디로 가입해도 한 계정만 저장한다", async () => {
    const input = validInput();

    const responses = await Promise.all([
      postSignup(input),

      postSignup({
        ...input,
        loginId: ` ${input.loginId.toUpperCase()} `,
      }),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([
      201, 409,
    ]);

    const rejected = responses.find((response) => response.status === 409);

    expect(rejected.body.error.code).toBe("LOGIN_ID_TAKEN");
    expect(rejected.text).not.toContain(input.password);

    // 로그인 정보 저장에 실패한 회원이 따로 남으면 안 됩니다.
    expect(await readCounts()).toEqual({
      users: 1,
      credentials: 1,
      sessions: 0,
    });
  });

  it.each([
    ["짧은 비밀번호", { password: "short-password" }],
    ["잘못된 아이디", { loginId: "invalid-id" }],
    ["권한 직접 지정", { role: "ADMIN" }],
  ])("%s 요청은 저장하지 않는다", async (_label, changes) => {
    const response = await postSignup({
      ...validInput(),
      ...changes,
    });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");

    expect(await readCounts()).toEqual({
      users: 0,
      credentials: 0,
      sessions: 0,
    });
  });

  it.each([null, "https://untrusted.example"])(
    "허용되지 않은 Origin %p를 거절한다",
    async (origin) => {
      const pending = request(app).post("/api/auth/signup");

      if (origin !== null) {
        pending.set("Origin", origin);
      }

      const response = await pending.send(validInput());

      expect(response.status).toBe(403);

      expect(await readCounts()).toEqual({
        users: 0,
        credentials: 0,
        sessions: 0,
      });
    },
  );

  it("JSON이 아닌 가입 요청을 거절한다", async () => {
    const response = await request(app)
      .post("/api/auth/signup")
      .set("Origin", env.frontendOrigin)
      .type("form")
      .send(validInput());

    expect(response.status).toBe(415);
    expect(response.body.error.code).toBe("UNSUPPORTED_MEDIA_TYPE");

    expect(await readCounts()).toEqual({
      users: 0,
      credentials: 0,
      sessions: 0,
    });
  });
});
