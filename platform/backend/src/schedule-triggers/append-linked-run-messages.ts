import { eq, max, sql } from "drizzle-orm";
import db, { schema } from "@/database";

/**
 * Append a user prompt + assistant reply pair to a linked conversation on
 * behalf of a scheduled task run.
 *
 * Serializes concurrent appends to the same conversation using a transaction
 * advisory lock + `MAX(createdAt)` lookup. This guarantees:
 *   - user message strictly precedes its assistant reply (+1ms apart);
 *   - parallel runs don't interleave pairs, even when triggered within the
 *     same millisecond.
 */
export async function appendLinkedScheduleRunMessagesToConversation(params: {
  conversationId: string;
  messageTemplate: string;
  assistantText: string;
}): Promise<void> {
  const { conversationId, messageTemplate, assistantText } = params;
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

  await db.transaction(async (tx) => {
    // Serialize appends to the same conversation so createdAt values are
    // assigned monotonically per conversation.
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${conversationId}, 0))`,
    );

    const [row] = await tx
      .select({ maxCreatedAt: max(schema.messagesTable.createdAt) })
      .from(schema.messagesTable)
      .where(eq(schema.messagesTable.conversationId, conversationId));

    const now = Date.now();
    const maxExistingMs = row?.maxCreatedAt
      ? new Date(row.maxCreatedAt).getTime()
      : 0;
    const base = Math.max(now, maxExistingMs + 1);
    const userCreatedAt = new Date(base);
    const assistantCreatedAt = new Date(base + 1);

    await tx.insert(schema.messagesTable).values([
      {
        conversationId,
        role: "user",
        createdAt: userCreatedAt,
        content: {
          id: `scheduled-user-${suffix}`,
          role: "user",
          parts: [{ type: "text", text: messageTemplate }],
        },
      },
      {
        conversationId,
        role: "assistant",
        createdAt: assistantCreatedAt,
        content: {
          id: `scheduled-assistant-${suffix}`,
          role: "assistant",
          parts: [
            {
              type: "text",
              text: assistantText.trim() || "(no output)",
            },
          ],
        },
      },
    ]);

    await tx
      .update(schema.conversationsTable)
      .set({ updatedAt: new Date() })
      .where(eq(schema.conversationsTable.id, conversationId));
  });
}
