import { describe, expect, it } from "@jest/globals";

import { createCandidateSchema } from "../dist/validators/candidate.schema.js";

const validInput = {
  name: "주말 카페",
  address: "서울특별시 마포구 테스트로 10",
  mapUrl: "https://map.naver.com/",
  memo: "대화하기 좋아 보여요.",
};

describe("장소 후보 입력 검증", () => {
  it("문자열 앞뒤 공백을 제거한다", () => {
    const result = createCandidateSchema.parse({
      name: "  주말 카페  ",
      address: "  서울특별시 마포구  ",
      mapUrl: "  https://map.naver.com/  ",
      memo: "  대화하기 좋아요.  ",
    });

    expect(result).toEqual({
      name: "주말 카페",
      address: "서울특별시 마포구",
      mapUrl: "https://map.naver.com/",
      memo: "대화하기 좋아요.",
    });
  });

  it("선택 항목을 생략하면 기본값을 적용한다", () => {
    const result = createCandidateSchema.parse({
      name: validInput.name,
      address: validInput.address,
    });

    expect(result.mapUrl).toBeNull();
    expect(result.memo).toBe("");
  });

  it.each(["", "   ", null])(
    "비어 있는 지도 링크 %p를 null로 처리한다",
    (mapUrl) => {
      const result = createCandidateSchema.parse({
        ...validInput,
        mapUrl,
      });

      expect(result.mapUrl).toBeNull();
    },
  );

  it("문자열 길이의 최댓값을 허용한다", () => {
    const result = createCandidateSchema.safeParse({
      name: "가".repeat(100),
      address: "가".repeat(200),
      memo: "가".repeat(300),
    });

    expect(result.success).toBe(true);
  });

  it.each([
    ["공백뿐인 장소명", { name: "   " }],
    ["100자를 넘는 장소명", { name: "가".repeat(101) }],
    ["공백뿐인 주소", { address: "   " }],
    ["200자를 넘는 주소", { address: "가".repeat(201) }],
    ["300자를 넘는 추천 이유", { memo: "가".repeat(301) }],
    ["숫자 장소명", { name: 123 }],
    ["잘못된 URL", { mapUrl: "지도 링크" }],
    ["실행 가능한 URL", { mapUrl: "javascript:alert(1)" }],
    ["파일 URL", { mapUrl: "file:///etc/passwd" }],
    [
      "사용자 정보가 포함된 URL",
      { mapUrl: "https://user:password@example.com/" },
    ],
    [
      "2,000자를 넘는 URL",
      { mapUrl: `https://example.com/${"a".repeat(2000)}` },
    ],
    ["등록자 직접 지정", { createdById: "another-user" }],
    ["모임 직접 지정", { roomId: "another-room" }],
    ["역할 직접 지정", { role: "HOST" }],
  ])("%s을 거절한다", (_label, changes) => {
    const result = createCandidateSchema.safeParse({
      ...validInput,
      ...changes,
    });

    expect(result.success).toBe(false);
  });
});
