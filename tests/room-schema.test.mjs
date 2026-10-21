import { describe, expect, it } from "@jest/globals";
import { createRoomSchema } from "../dist/validators/room.schema.js";

const validInput = {
  name: "주말 모임",
  hostNickname: "모임대장",
  description: "이번에는 카페에 가요.",
};

describe("방 생성 입력 검증", () => {
  it("입력 앞뒤 공백을 제거한다.", () => {
    const result = createRoomSchema.parse({
      name: " 주말 모임 ",
      hostNickname: " 모임대장  ",
      description: "  카페에 가요.  ",
    });

    expect(result).toEqual({
      name: "주말 모임",
      hostNickname: "모임대장",
      description: "카페에 가요.",
    });
  });

  it("설명을 생략하면 빈 문자열로 처리한다", () => {
    const result = createRoomSchema.parse({
      name: "주말 모임",
      hostNickname: "모임대장",
    });

    expect(result.description).toBe("");
  });

  it.each([
    ["공백뿐인 모임 이름", { name: "  " }],
    ["40자를 넘는 모임 이름", { name: "가".repeat(41) }],
    ["한 글자 닉네임", { hostNickname: "김" }],
    ["12자를 넘는 닉네임", { hostNickname: "가".repeat(13) }],
    ["300자를 넘는 설명", { description: "가".repeat(301) }],
    ["클라이언트가 추가한 역할", { role: "HOST" }],
  ])("$s을 거절한다", (_label, changes) => {
    const result = createRoomSchema.safeParse({
      ...validInput,
      ...changes,
    });

    expect(result.success).toBe(false);
  });
});
