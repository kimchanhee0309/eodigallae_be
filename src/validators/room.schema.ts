import { z } from "zod";

export const createRoomSchema = z.strictObject({
  name: z
    .string()
    .trim()
    .min(2, "모임 이름은 2자 이상이어야 합니다.")
    .max(40, "모임 이름은 40자 이하여야 합니다."),

  hostNickname: z
    .string()
    .trim()
    .min(2, "닉네임은 2자 이상이어야 합니다.")
    .max(12, "닉네임은 12자 이하여야 합니다."),

  description: z
    .string()
    .trim()
    .max(300, "설명은 300자 이하여야 합니다.")
    .default(""),
});

export type CreateRoomInput = z.infer<typeof createRoomSchema>;

export const roomParamSchema = z.object({
  roomId: z.string().uuid("올바른 모임 ID가 아닙니다."),
});
