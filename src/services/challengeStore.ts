/**
 * Challenge store for auth nonces.
 * Uses Redis when REDIS_URL is set; otherwise in-memory (single-instance dev).
 */

export type ChallengeEntry = { eoa: string; expiresAt: number };

export interface ChallengeStore {
  set(nonce: string, entry: ChallengeEntry): Promise<void>;
  get(nonce: string): Promise<ChallengeEntry | null>;
  delete(nonce: string): Promise<void>;
  cleanupExpired(): Promise<void>;
}

class MemoryChallengeStore implements ChallengeStore {
  private store = new Map<string, ChallengeEntry>();

  async set(nonce: string, entry: ChallengeEntry): Promise<void> {
    this.store.set(nonce, entry);
  }

  async get(nonce: string): Promise<ChallengeEntry | null> {
    return this.store.get(nonce) ?? null;
  }

  async delete(nonce: string): Promise<void> {
    this.store.delete(nonce);
  }

  async cleanupExpired(): Promise<void> {
    const now = Date.now();
    for (const [nonce, data] of this.store.entries()) {
      if (data.expiresAt < now) this.store.delete(nonce);
    }
  }
}

class RedisChallengeStore implements ChallengeStore {
  private prefix: string;
  private client: import("redis").RedisClientType;

  constructor(client: import("redis").RedisClientType, keyPrefix = "waves-da:challenge:") {
    this.client = client;
    this.prefix = keyPrefix;
  }

  private key(nonce: string): string {
    return `${this.prefix}${nonce}`;
  }

  async set(nonce: string, entry: ChallengeEntry): Promise<void> {
    const ttlMs = Math.max(entry.expiresAt - Date.now(), 1000);
    await this.client.set(this.key(nonce), JSON.stringify(entry), { PX: ttlMs });
  }

  async get(nonce: string): Promise<ChallengeEntry | null> {
    const raw = await this.client.get(this.key(nonce));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as ChallengeEntry;
    } catch {
      return null;
    }
  }

  async delete(nonce: string): Promise<void> {
    await this.client.del(this.key(nonce));
  }

  async cleanupExpired(): Promise<void> {
    // Redis entries expire via PX; no sweep needed
  }
}

let storeInstance: ChallengeStore | null = null;
let redisClient: import("redis").RedisClientType | null = null;

export async function getChallengeStore(redisUrl: string): Promise<ChallengeStore> {
  if (storeInstance) return storeInstance;

  if (redisUrl.trim()) {
    const { createClient } = await import("redis");
    redisClient = createClient({ url: redisUrl.trim() });
    redisClient.on("error", (err) => console.error("Redis challenge store error:", err));
    await redisClient.connect();
    console.log("Challenge store: Redis");
    storeInstance = new RedisChallengeStore(redisClient);
  } else {
    console.log("Challenge store: in-memory (set REDIS_URL for production multi-instance)");
    storeInstance = new MemoryChallengeStore();
    setInterval(() => {
      storeInstance?.cleanupExpired().catch(() => {});
    }, 60_000);
  }

  return storeInstance;
}

export async function closeChallengeStore(): Promise<void> {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
  }
  storeInstance = null;
}
