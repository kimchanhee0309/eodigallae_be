import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
});

const result = envSchema.safeParse(process.env);

if (!result.success) {
  const invalidFields = result.error.issues.map((issue) =>
    issue.path.join("."),
  );

  throw new Error(`환경변수 설정을 확인해주세요: ${invalidFields.join(", ")}`);
}

export const env = {
  port: result.data.PORT,
};
