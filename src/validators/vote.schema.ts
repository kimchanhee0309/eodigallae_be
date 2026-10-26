import { z } from "zod";

export const setVoteSchema = z.strictObject({
  candidateId: z
    .string()
    .uuid("올바른 장소 후보 ID가 아닙니다.")
    .transform((value) => value.toLowerCase())
    .nullable(),
});

export type SetVoteInput = z.infer<typeof setVoteSchema>;
