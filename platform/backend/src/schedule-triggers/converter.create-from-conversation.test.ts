import { vi } from "vitest";

const mockCreateDirectLLMModel = vi.hoisted(() => vi.fn(() => "mocked-model"));
const mockGenerateText = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    text: "Standalone scheduled prompt from LLM",
    usage: { inputTokens: 2, outputTokens: 3 },
  }),
);

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return {
    ...actual,
    generateText: mockGenerateText,
  };
});

vi.mock("@/clients/llm-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/clients/llm-client")>();
  return {
    ...actual,
    createDirectLLMModel: mockCreateDirectLLMModel,
  };
});

import ConversationModel from "@/models/conversation";
import { LimitValidationService } from "@/models/limit";
import MessageModel from "@/models/message";
import ModelModel from "@/models/model";
import { beforeEach, describe, expect, test } from "@/test";
import { ApiError } from "@/types";
import { scheduleTriggerConverterService } from "./converter";
import { configureScheduleConversionBuiltInForTests } from "./testing/configure-schedule-conversion-built-in";

describe("scheduleTriggerConverterService createFromConversation cron validation", () => {
  beforeEach(() => {
    mockCreateDirectLLMModel.mockClear();
    mockGenerateText.mockClear();
  });

  test("rejects 6-field cron expression before invoking LLM", async ({
    makeUser,
    makeOrganization,
    makeInternalAgent,
  }) => {
    const user = await makeUser();
    const org = await makeOrganization();
    const agent = await makeInternalAgent({ organizationId: org.id });
    const conversation = await ConversationModel.create({
      userId: user.id,
      organizationId: org.id,
      agentId: agent.id,
      title: "Cron validation",
    });

    await expect(
      scheduleTriggerConverterService.createFromConversation({
        conversationId: conversation.id,
        userId: user.id,
        organizationId: org.id,
        cronExpression: "0 0 9 * * 1",
        timezone: "UTC",
      }),
    ).rejects.toBeInstanceOf(ApiError);

    expect(mockGenerateText).not.toHaveBeenCalled();
  });

  for (const [label, cronExpression] of [
    ["day-of-month list", "0 9 1,15 * *"],
    ["weekday range", "0 9 * * 1-5"],
    ["minute step", "*/15 * * * *"],
  ] as const) {
    test(`rejects non-form-shape cron (${label}) before invoking LLM`, async ({
      makeUser,
      makeOrganization,
      makeInternalAgent,
    }) => {
      const user = await makeUser();
      const org = await makeOrganization();
      const agent = await makeInternalAgent({ organizationId: org.id });
      const conversation = await ConversationModel.create({
        userId: user.id,
        organizationId: org.id,
        agentId: agent.id,
        title: "Cron shape validation",
      });

      await expect(
        scheduleTriggerConverterService.createFromConversation({
          conversationId: conversation.id,
          userId: user.id,
          organizationId: org.id,
          cronExpression,
          timezone: "UTC",
        }),
      ).rejects.toBeInstanceOf(ApiError);

      expect(mockGenerateText).not.toHaveBeenCalled();
    });
  }

  test("rejects invalid timezone before invoking LLM", async ({
    makeUser,
    makeOrganization,
    makeInternalAgent,
  }) => {
    const user = await makeUser();
    const org = await makeOrganization();
    const agent = await makeInternalAgent({ organizationId: org.id });
    const conversation = await ConversationModel.create({
      userId: user.id,
      organizationId: org.id,
      agentId: agent.id,
      title: "Timezone validation",
    });

    await expect(
      scheduleTriggerConverterService.createFromConversation({
        conversationId: conversation.id,
        userId: user.id,
        organizationId: org.id,
        cronExpression: "0 9 * * 1",
        timezone: "Not/A_Real_Zone",
      }),
    ).rejects.toBeInstanceOf(ApiError);

    expect(mockGenerateText).not.toHaveBeenCalled();
  });

  test("accepts valid 5-field cron and proceeds to LLM summary", async ({
    makeUser,
    makeOrganization,
    makeInternalAgent,
    makeSecret,
    makeLlmProviderApiKey,
  }) => {
    const user = await makeUser();
    const org = await makeOrganization();
    const modelId = `sched-create-${crypto.randomUUID().slice(0, 8)}`;
    await ModelModel.create({
      externalId: `openai/${modelId}`,
      provider: "openai",
      modelId,
      inputModalities: ["text"],
      outputModalities: ["text"],
      promptPricePerToken: "0.00001",
      completionPricePerToken: "0.00002",
      lastSyncedAt: new Date(),
    });
    const secret = await makeSecret({ secret: { apiKey: "sk-test-openai" } });
    const openaiKey = await makeLlmProviderApiKey(org.id, secret.id, {
      provider: "openai",
      scope: "org",
    });
    await configureScheduleConversionBuiltInForTests({
      organizationId: org.id,
      llmApiKeyId: openaiKey.id,
      llmModel: modelId,
    });
    const agent = await makeInternalAgent({
      organizationId: org.id,
      llmModel: modelId,
    });
    const conversation = await ConversationModel.create({
      userId: user.id,
      organizationId: org.id,
      agentId: agent.id,
      title: "Valid cron",
      selectedModel: modelId,
    });
    await MessageModel.create({
      conversationId: conversation.id,
      role: "user",
      content: {
        id: "msg-create-1",
        role: "user",
        parts: [{ type: "text", text: "Run me on schedule" }],
      },
    });
    vi.spyOn(
      LimitValidationService,
      "checkLimitsBeforeRequest",
    ).mockResolvedValue(null);

    const trigger =
      await scheduleTriggerConverterService.createFromConversation({
        conversationId: conversation.id,
        userId: user.id,
        organizationId: org.id,
        cronExpression: "0 9 * * 1",
        timezone: "UTC",
      });

    expect(trigger.cronExpression).toBe("0 9 * * 1");
    expect(trigger.timezone).toBe("UTC");
    expect(mockGenerateText).toHaveBeenCalled();
  });
});
