import { prisma } from "../config/db.js";

async function main() {
  try {
    const result = await prisma.$queryRaw<
      Array<{ connected: number }>
    >`SELECT 1 AS connected`;

    if (result[0]?.connected !== 1) {
      throw new Error("예상하지 못한 DB 응답입니다.");
    }

    console.log("PostgreSQL 연결 성공!");
  } catch {
    console.error(
      "DB 연결 실패: 연결 URL, 계정, 외부 접근 허용, TLS 설정을 확인해주세요.",
    );

    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

void main();
