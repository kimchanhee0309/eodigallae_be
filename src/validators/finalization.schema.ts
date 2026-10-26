import { z } from "zod";

export const finalizeRoomSchema = z.strictObject({
  candidateId: z
    .string()
    .uuid("올바른 장소 후보 ID가 아닙니다.")
    .transform((value) => value.toLowerCase()),
});

export type FinalizeRoomInput = z.infer<typeof finalizeRoomSchema>;
