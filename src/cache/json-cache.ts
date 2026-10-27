import type { z } from "zod";

export type CacheSnapshot = {
  version: string;
  payload: string | null;
};

export interface CacheStore {
  read(key: string): Promise<CacheSnapshot>;

  writeIfCurrent(
    key: string,
    version: string,
    payload: string,
    ttlSeconds: number,
  ): Promise<boolean>;

  invalidate(key: string): Promise<void>;
}

type CacheOptions<T> = {
  key: string;
  schema: z.ZodType<T>;
  ttlSeconds: number;
  load: () => Promise<T>;
};

type CacheResult<T> = {
  data: T;
  cacheStatus: "HIT" | "MISS" | "BYPASS";
};

export class JsonCache {
  constructor(private readonly store: CacheStore | null) {}

  async getOrLoad<T>({
    key,
    schema,
    ttlSeconds,
    load,
  }: CacheOptions<T>): Promise<CacheResult<T>> {
    if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds <= 0) {
      throw new RangeError("캐시 TTL은 양의 정수여야 합니다.");
    }

    if (!this.store) {
      return {
        data: await load(),
        cacheStatus: "BYPASS",
      };
    }

    let snapshot: CacheSnapshot | null = null;

    try {
      snapshot = await this.store.read(key);

      if (snapshot.payload !== null) {
        const parsed = schema.safeParse(JSON.parse(snapshot.payload));

        if (parsed.success) {
          return {
            data: parsed.data,
            cacheStatus: "HIT",
          };
        }
      }
    } catch {
      // 캐시 조회나 JSON 해석 실패 시 원본 저장소를 조회합니다.
    }

    // DB 조회 실패까지 캐시 오류로 처리하지 않도록 try 밖에서 실행합니다.
    const data = await load();

    if (snapshot) {
      try {
        const payload = JSON.stringify(data);

        if (typeof payload === "string") {
          await this.store.writeIfCurrent(
            key,
            snapshot.version,
            payload,
            ttlSeconds,
          );
        }
      } catch {
        // 캐시 저장 실패는 성공한 DB 조회 결과에 영향을 주지 않습니다.
      }
    }

    return {
      data,
      cacheStatus: snapshot ? "MISS" : "BYPASS",
    };
  }

  async invalidate(key: string): Promise<boolean> {
    if (!this.store) {
      return true;
    }

    try {
      await this.store.invalidate(key);
      return true;
    } catch {
      return false;
    }
  }
}
