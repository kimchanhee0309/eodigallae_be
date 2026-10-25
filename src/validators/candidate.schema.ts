import { z } from "zod";

const mapUrlSchema = z
  .preprocess(
    (value) => {
      if (typeof value === "string" && value.trim() === "") {
        return null;
      }

      return value;
    },
    z
      .string()
      .trim()
      .max(2000, "지도 링크는 2,000자 이하여야 합니다.")
      .pipe(
        z.url({
          protocol: /^https?$/,
          error: "http 또는 https 주소를 입력해주세요.",
        }),
      )
      .refine((value) => {
        try {
          const url = new URL(value);

          return url.username === "" && url.password === "";
        } catch {
          return false;
        }
      }, "사용자 정보가 포함되지 않은 올바른 주소를 입력해주세요.")
      .nullable(),
  )
  .optional()
  .transform((value) => value ?? null);

export const createCandidateSchema = z.strictObject({
  name: z
    .string()
    .trim()
    .min(1, "장소명을 입력해주세요.")
    .max(100, "장소명은 100자 이하여야 합니다."),

  address: z
    .string()
    .trim()
    .min(1, "주소를 입력해주세요.")
    .max(200, "주소는 200자 이하여야 합니다."),

  mapUrl: mapUrlSchema,

  memo: z
    .string()
    .trim()
    .max(300, "추천 이유는 300자 이하여야 합니다.")
    .default(""),
});

export type CreateCandidateInput = z.infer<typeof createCandidateSchema>;
