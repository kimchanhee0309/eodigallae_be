import { randomUUID } from "node:crypto";

import { describe, expect, it } from "@jest/globals";

import { setVoteSchema } from "../dist/validators/vote.schema.js";

describe("투표 입력 검증", () => {
  it("후보 UUID를 허용한다", () => {
    const candidateId = randomUUID();

    expect(setVoteSchema.parse({ candidateId })).toEqual({ candidateId });
  });

  it("null을 투표 취소로 허용한다", () => {
    expect(setVoteSchema.parse({ candidateId: null })).toEqual({
      candidateId: null,
    });
  });

  it("대문자 UUID를 소문자로 정규화한다", () => {
    const candidateId = randomUUID();

    expect(
      setVoteSchema.parse({
        candidateId: candidateId.toUpperCase(),
      }),
    ).toEqual({ candidateId });
  });

  it.each([
    ["후보 ID 생략", {}],
    ["빈 문자열", { candidateId: "" }],
    ["잘못된 UUID", { candidateId: "wrong-id" }],
    ["숫자", { candidateId: 123 }],
    ["배열", { candidateId: [] }],
    [
      "참여자 조작",
      {
        candidateId: randomUUID(),
        participantId: randomUUID(),
      },
    ],
    [
      "모임 조작",
      {
        candidateId: randomUUID(),
        roomId: randomUUID(),
      },
    ],
    [
      "득표수 조작",
      {
        candidateId: randomUUID(),
        voteCount: 100,
      },
    ],
  ])("%s을 거절한다", (_label, input) => {
    expect(setVoteSchema.safeParse(input).success).toBe(false);
  });
});
