function assertCacheEnvironment() {
  if (process.env.NODE_ENV !== "test" || process.env.CACHE_ENABLED !== "true") {
    throw new Error("캐시 API 테스트 환경이 아닙니다.");
  }

  if (
    !process.env.REDIS_URL ||
    process.env.REDIS_URL !== process.env.REDIS_TEST_URL
  ) {
    throw new Error("테스트용 Redis 연결 설정이 필요합니다.");
  }

  const url = new URL(process.env.REDIS_URL);

  if (
    url.protocol !== "redis:" ||
    !["127.0.0.1", "localhost"].includes(url.hostname) ||
    url.pathname !== "/15"
  ) {
    throw new Error("로컬 Redis 15번 테스트 DB가 아닙니다.");
  }
}

assertCacheEnvironment();
