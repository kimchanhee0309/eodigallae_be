import { z } from "zod";

export const roomCacheSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string(),
  status: z.enum(["OPEN", "FINALIZED"]),
  createdAt: z.string().datetime(),
  participantCount: z.number().int().nonnegative(),
  finalizedAt: z.string().datetime().nullable(),

  finalizedCandidate: z
    .object({
      id: z.string().uuid(),
      name: z.string(),
      address: z.string(),

      mapUrl: z.url({ protocol: /^https?$/ }).nullable(),

      memo: z.string(),
    })
    .nullable(),
});

export type RoomCacheData = z.infer<typeof roomCacheSchema>;
