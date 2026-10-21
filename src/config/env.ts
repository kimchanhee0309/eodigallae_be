import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),

  DATABASE_URL: z
    .string()
    .url()
    .refine(
      (value) =>
        value.startsWith("postgresql://") || value.startsWith("postgres://"),
      "PostgreSQL 연결 URL이어야 합니다.",
    ),

  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),

  FRONTEND_ORIGIN: z.string().url().default("http://localhost:3000"),
});

const result = envSchema.safeParse(process.env);

if (!result.success) {
  const invalidFields = [
    ...new Set(result.error.issues.map((issue) => issue.path.join("."))),
  ];

  throw new Error(`환경변수 설정을 확인해주세요: ${invalidFields.join(", ")}`);
}

export const env = {
  port: result.data.PORT,
  databaseUrl: result.data.DATABASE_URL,
  nodeEnv: result.data.NODE_ENV,
  frontendOrigin: new URL(result.data.FRONTEND_ORIGIN).origin,
};
