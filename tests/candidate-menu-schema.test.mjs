import { describe, expect, it } from "@jest/globals";

import { createCandidateSchema } from "../dist/validators/candidate.schema.js";

const candidate = {
  name: "주말 카페",
  address: "서울특별시 마포구",
};

const menu = {
  name: "아메리카노",
  price: 5000,
  priceBasis: "1잔",
};

describe("장소 후보 메뉴 입력 검증", () => {
  it("메뉴명과 가격 기준의 앞뒤 공백을 제거한다", () => {
    const result = createCandidateSchema.parse({
      ...candidate,
      menus: [
        {
          name: " 아메리카노  ",
          price: 5000,
          priceBasis: " 1잔 ",
        },
      ],
    });

    expect(result.menus).toEqual([menu]);
  });

  it("가격을 생략하면 미확인 상태인 null로 처리한다", () => {
    const result = createCandidateSchema.parse({
      ...candidate,
      menus: [
        {
          name: "시즌 케이크",
          priceBasis: "1조각",
        },
      ],
    });

    expect(result.menus[0].price).toBeNull();
  });

  it.each([0, 10_000_000, null])("가격 경계값 %p를 허용한다", (price) => {
    const result = createCandidateSchema.safeParse({
      ...candidate,
      menus: [{ ...menu, price }],
    });

    expect(result.success).toBe(true);
  });

  it("메뉴 3개를 허용한다", () => {
    const result = createCandidateSchema.safeParse({
      ...candidate,
      menus: Array.from({ length: 3 }, (_, index) => ({
        ...menu,
        name: `메쥬 ${index + 1}`,
      })),
    });

    expect(result.success).toBe(true);
  });

  it("메뉴 4개를 거절한다", () => {
    const result = createCandidateSchema.safeParse({
      ...candidate,
      menus: Array.from({ length: 4 }, () => ({ ...menu })),
    });

    expect(result.success).toBe(false);
  });

  it.each([
    ["빈 메뉴명", { name: "   " }],
    ["긴 메뉴명", { name: "가".repeat(101) }],
    ["음수 가격", { price: -1 }],
    ["소수 가격", { price: 1500.5 }],
    ["상한 초과 가격", { price: 10_000_001 }],
    ["문자열 가격", { price: "5000" }],
    ["빈 문자열 가격", { price: "" }],
    ["빈 가격 기준", { priceBasis: "   " }],
    ["긴 가격 기준", { priceBasis: "가".repeat(31) }],
    ["메뉴 ID 조작", { id: "client-supplied-id" }],
    ["후보 ID 조작", { candidateId: "another-candidate" }],
    ["표시 순서 조작", { position: 2 }],
  ])("%s을 거절한다", (_label, changes) => {
    const result = createCandidateSchema.safeParse({
      ...candidate,
      menus: [{ ...menu, ...changes }],
    });

    expect(result.success).toBe(false);
  });
});
