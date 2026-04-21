import { asc, eq } from "drizzle-orm";
import db, { schema } from "@/database";
import { describe, expect, test } from "@/test";
import { appendLinkedScheduleRunMessagesToConversation } from "./append-linked-run-messages";

describe("appendLinkedScheduleRunMessagesToConversation", () => {
  test("inserts user before assistant using monotonic createdAt", async ({
    makeUser,
    makeOrganization,
    makeInternalAgent,
    makeConversation,
  }) => {
    const user = await makeUser();
    const org = await makeOrganization();
    const agent = await makeInternalAgent({ organizationId: org.id });
    const conversation = await makeConversation(agent.id, {
      userId: user.id,
      organizationId: org.id,
    });

    await appendLinkedScheduleRunMessagesToConversation({
      conversationId: conversation.id,
      messageTemplate: "Run",
      assistantText: "Done",
    });

    const rows = await db
      .select()
      .from(schema.messagesTable)
      .where(eq(schema.messagesTable.conversationId, conversation.id))
      .orderBy(asc(schema.messagesTable.createdAt));

    expect(rows).toHaveLength(2);
    expect(rows[0].role).toBe("user");
    expect(rows[1].role).toBe("assistant");
    expect(rows[1].createdAt.getTime()).toBeGreaterThan(
      rows[0].createdAt.getTime(),
    );
  });

  test("substitutes '(no output)' when assistant text is blank", async ({
    makeUser,
    makeOrganization,
    makeInternalAgent,
    makeConversation,
  }) => {
    const user = await makeUser();
    const org = await makeOrganization();
    const agent = await makeInternalAgent({ organizationId: org.id });
    const conversation = await makeConversation(agent.id, {
      userId: user.id,
      organizationId: org.id,
    });

    await appendLinkedScheduleRunMessagesToConversation({
      conversationId: conversation.id,
      messageTemplate: "Run",
      assistantText: "   ",
    });

    const [, assistantRow] = await db
      .select()
      .from(schema.messagesTable)
      .where(eq(schema.messagesTable.conversationId, conversation.id))
      .orderBy(asc(schema.messagesTable.createdAt));

    const content = assistantRow.content as {
      parts: Array<{ type: string; text: string }>;
    };
    expect(content.parts[0].text).toBe("(no output)");
  });

  test("serializes concurrent appends so message pairs do not interleave", async ({
    makeUser,
    makeOrganization,
    makeInternalAgent,
    makeConversation,
  }) => {
    const user = await makeUser();
    const org = await makeOrganization();
    const agent = await makeInternalAgent({ organizationId: org.id });
    const conversation = await makeConversation(agent.id, {
      userId: user.id,
      organizationId: org.id,
    });

    await Promise.all([
      appendLinkedScheduleRunMessagesToConversation({
        conversationId: conversation.id,
        messageTemplate: "Run 1",
        assistantText: "Reply 1",
      }),
      appendLinkedScheduleRunMessagesToConversation({
        conversationId: conversation.id,
        messageTemplate: "Run 2",
        assistantText: "Reply 2",
      }),
    ]);

    const rows = await db
      .select()
      .from(schema.messagesTable)
      .where(eq(schema.messagesTable.conversationId, conversation.id))
      .orderBy(asc(schema.messagesTable.createdAt));

    expect(rows).toHaveLength(4);
    // Pairs must not interleave: role order must be user, assistant, user, assistant
    expect(rows.map((row) => row.role)).toEqual([
      "user",
      "assistant",
      "user",
      "assistant",
    ]);
    // createdAt strictly monotonic
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].createdAt.getTime()).toBeGreaterThan(
        rows[i - 1].createdAt.getTime(),
      );
    }
  });
});
