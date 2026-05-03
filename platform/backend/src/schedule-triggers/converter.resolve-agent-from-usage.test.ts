import ConversationModel from "@/models/conversation";
import InteractionModel from "@/models/interaction";
import MessageModel from "@/models/message";
import { describe, expect, test } from "@/test";
import { scheduleTriggerConverterService } from "./converter";

describe("scheduleTriggerConverterService resolveAgent from interaction usage", () => {
  test("picks the most recently used internal agent when current conversation agent is not an internal agent", async ({
    makeUser,
    makeOrganization,
    makeInternalAgent,
    makeAgent,
  }) => {
    const user = await makeUser();
    const org = await makeOrganization();
    const profileAgent = await makeAgent({
      organizationId: org.id,
      agentType: "profile",
      scope: "org",
      name: "Profile on chat",
    });
    const agentOlder = await makeInternalAgent({
      organizationId: org.id,
      name: "Older usage agent",
    });
    const agentRecent = await makeInternalAgent({
      organizationId: org.id,
      name: "Recent usage agent",
    });

    const conversation = await ConversationModel.create({
      userId: user.id,
      organizationId: org.id,
      agentId: profileAgent.id,
      title: "Profile-bound chat",
    });

    await MessageModel.create({
      conversationId: conversation.id,
      role: "user",
      content: {
        id: "msg-u1",
        role: "user",
        parts: [{ type: "text", text: "Hello" }],
      },
    });

    const baseRequest = { model: "gpt-4", messages: [] };
    const baseResponse = {
      id: "r",
      object: "chat.completion" as const,
      created: Date.now(),
      model: "gpt-4",
      choices: [
        {
          index: 0,
          message: { role: "assistant" as const, content: "ok" },
          finish_reason: "stop" as const,
        },
      ],
    };

    await InteractionModel.create({
      profileId: agentOlder.id,
      userId: user.id,
      sessionId: conversation.id,
      request: baseRequest,
      response: baseResponse,
      type: "openai:chatCompletions",
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    await InteractionModel.create({
      profileId: agentRecent.id,
      userId: user.id,
      sessionId: conversation.id,
      request: baseRequest,
      response: baseResponse,
      type: "openai:chatCompletions",
    });

    const trigger =
      await scheduleTriggerConverterService.createFromConversation({
        conversationId: conversation.id,
        userId: user.id,
        organizationId: org.id,
        cronExpression: "0 9 * * 1",
        timezone: "UTC",
        messageTemplate: "Run the scheduled check",
      });

    expect(trigger.agentId).toBe(agentRecent.id);
  });
});
