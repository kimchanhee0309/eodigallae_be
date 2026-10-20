import "dotenv/config";

const port = Number(process.env.PORT ?? "4000");

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT는 1~65535 사이의 정수여야 합니다.");
}

export const env = {
  port,
};
