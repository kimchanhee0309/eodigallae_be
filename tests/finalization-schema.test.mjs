import { randomUUID } from "node:crypto";

import { describe, expect, it } from "@jest/globals";

import { finalizeRoomSchema } from "../dist/validators/finalization.schema.js";

describe("장소 확정 입력 검증", () => {
  it("후보 UUID를 허용하고 소문자로 정규화한다", () => {
    const candidateId = randomUUID();

    expect(
      finalizeRoomSchema.parse({
        candidateId: candidateId.toUpperCase(),
      }),
    ).toEqual({ candidateId });
  });

  it.each([
    ["후보 생략", {}],
    ["null", { candidateId: null }],
    ["잘못된 UUID", { candidateId: "wrong-id" }],
    [
      "방장 정보 조작",
      {
        candidateId: randomUUID(),
        participantId: randomUUID(),
      },
    ],
    [
      "확정 시각 조작",
      {
        candidateId: randomUUID(),
        finalizedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
    [
      "모임 상태 조작",
      {
        candidateId: randomUUID(),
        status: "FINALIZED",
      },
    ],
  ])("%s을 거절한다", (_label, input) => {
    expect(finalizeRoomSchema.safeParse(input).success).toBe(false);
  });
});
