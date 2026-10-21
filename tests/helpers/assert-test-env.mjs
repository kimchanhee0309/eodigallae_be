function assertTestEnvironment() {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("통합 테스트는 NODE_ENV=test에서만 실행합니다.");
  }

  let databaseUrl;

  try {
    databaseUrl = new URL(process.env.DATABASE_URL ?? "");
  } catch {
    throw new Error("테스트용 DATABASE_URL 설정을 확인해주세요.");
  }

  if (
    !["postgresql:", "postgres:"].includes(databaseUrl.protocol) ||
    databaseUrl.pathname !== "/eodigallae_test"
  ) {
    throw new Error("통합 테스트는 eodigallae_test DB에서만 실행합니다.");
  }
}

assertTestEnvironment();
