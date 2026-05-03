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
import { scheduleTriggerConverterService } from "./converter";
import { configureScheduleConversionBuiltInForTests } from "./testing/configure-schedule-conversion-built-in";

describe("scheduleTriggerConverterService suggestForConversation summary template", () => {
  beforeEach(() => {
    mockCreateDirectLLMModel.mockClear();
    mockGenerateText.mockClear();
  });

  test("suggestedMessageTemplate uses LLM summary when transcript exists", async ({
    makeUser,
    makeOrganization,
    makeInternalAgent,
    makeSecret,
    makeLlmProviderApiKey,
  }) => {
    const user = await makeUser();
    const org = await makeOrganization();
    const modelId = `sched-suggest-openai-${crypto.randomUUID().slice(0, 8)}`;
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
      title: "Suggest summary",
      selectedModel: modelId,
    });
    await MessageModel.create({
      conversationId: conversation.id,
      role: "user",
      content: {
        id: "msg-1",
        role: "user",
        parts: [{ type: "text", text: "First user line for fallback" }],
      },
    });
    vi.spyOn(
      LimitValidationService,
      "checkLimitsBeforeRequest",
    ).mockResolvedValue(null);

    const suggestion =
      await scheduleTriggerConverterService.suggestForConversation({
        conversationId: conversation.id,
        userId: user.id,
        organizationId: org.id,
      });

    expect(suggestion.suggestedMessageTemplatePreview).toBe(
      "First user line for fallback",
    );
    expect(suggestion.suggestedMessageTemplate).toBe(
      "Standalone scheduled prompt from LLM",
    );
    expect(mockGenerateText).toHaveBeenCalled();
  });

  test("suggestedMessageTemplate falls back to first user message when LLM throws", async ({
    makeUser,
    makeOrganization,
    makeInternalAgent,
    makeSecret,
    makeLlmProviderApiKey,
  }) => {
    mockGenerateText.mockRejectedValueOnce(new Error("LLM unavailable"));
    const user = await makeUser();
    const org = await makeOrganization();
    const modelId = `sched-suggest-fail-${crypto.randomUUID().slice(0, 8)}`;
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
      title: "Suggest fallback",
      selectedModel: modelId,
    });
    await MessageModel.create({
      conversationId: conversation.id,
      role: "user",
      content: {
        id: "msg-2",
        role: "user",
        parts: [{ type: "text", text: "Fallback prompt body" }],
      },
    });
    vi.spyOn(
      LimitValidationService,
      "checkLimitsBeforeRequest",
    ).mockResolvedValue(null);

    const suggestion =
      await scheduleTriggerConverterService.suggestForConversation({
        conversationId: conversation.id,
        userId: user.id,
        organizationId: org.id,
      });

    expect(suggestion.suggestedMessageTemplate).toBe("Fallback prompt body");
    expect(suggestion.suggestedMessageTemplatePreview).toBe(
      "Fallback prompt body",
    );
  });
});
