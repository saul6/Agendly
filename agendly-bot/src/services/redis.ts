import { Redis } from '@upstash/redis';
import type { FlowState, ConversationContext } from '../types/index.js';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_URL!,
  token: process.env.UPSTASH_REDIS_TOKEN!,
});

const TTL_SECONDS = 24 * 60 * 60; // 24h — igual que el TTL de conversaciones abandonadas

interface CachedConversation {
  state: FlowState;
  context: ConversationContext;
}

function convKey(businessId: string, customerPhone: string): string {
  return `agendly:conv:${businessId}:${customerPhone}`;
}

export async function getConversationFromRedis(
  businessId: string,
  customerPhone: string
): Promise<CachedConversation | null> {
  try {
    return await redis.get<CachedConversation>(convKey(businessId, customerPhone));
  } catch (err) {
    console.warn('[redis] Error leyendo conversación, usando Supabase como fallback:', err);
    return null;
  }
}

export async function setConversationInRedis(
  businessId: string,
  customerPhone: string,
  state: FlowState,
  context: ConversationContext
): Promise<void> {
  try {
    await redis.set(
      convKey(businessId, customerPhone),
      { state, context } satisfies CachedConversation,
      { ex: TTL_SECONDS }
    );
  } catch (err) {
    // No crítico: Supabase es la fuente de verdad
    console.warn('[redis] Error escribiendo conversación en caché:', err);
  }
}

export async function deleteConversationFromRedis(
  businessId: string,
  customerPhone: string
): Promise<void> {
  try {
    await redis.del(convKey(businessId, customerPhone));
  } catch {
    // Ignorar — expiración TTL limpiará automáticamente
  }
}
