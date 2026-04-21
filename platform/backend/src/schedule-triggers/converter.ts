import { stripLlmReasoningTags, type SupportedProvider } from "@shared";
import { generateText } from "ai";
import { hasAnyAgentTypeAdminPermission } from "@/auth/agent-type-permissions";
import {
  createDirectLLMModel,
  isApiKeyRequired,
} from "@/clients/llm-client";
import config, { getProviderEnvApiKey } from "@/config";
import logger from "@/logging";
import {
  AgentModel,
  AgentTeamModel,
  ConversationModel,
  InteractionModel,
  LimitModel,
  LimitValidationService,
  LlmProviderApiKeyModel,
  LlmProviderApiKeyModelLinkModel,
  MemberModel,
  ModelModel,
  OrganizationModel,
  ScheduleTriggerModel,
} from "@/models";
import { getSecretValueForLlmProviderApiKey } from "@/secrets-manager";
import type { Agent, ScheduleTrigger } from "@/types";
import { ApiError, ScheduleTriggerConfigurationSchema } from "@/types";
import { resolveProviderApiKey } from "@/utils/llm-api-key-resolution";
import { resolveSmartDefaultLlm } from "@/utils/llm-resolution";

import {
  MAX_MESSAGE_TEXT_CHARS,
  MAX_SUMMARY_MESSAGES,
  SUMMARY_SYSTEM_PROMPT,
} from "./consts/summary";
import type { ConversationMessageLike } from "./types/conversation-message";
import type {
  AgentSuggestionReason,
  ScheduleTriggerSuggestion,
  ScheduleTriggerSuggestionCandidate,
} from "./types/suggestion";

class ScheduleTriggerConverterService {
  private extractTextFromMessage(message: ConversationMessageLike): string {
    if (!message.parts) return "";
    return message.parts
      .filter((part) => part?.type === "text" && typeof part.text === "string")
      .map((part) => (part.text ?? "").trim())
      .filter(Boolean)
      .join("\n")
      .slice(0, MAX_MESSAGE_TEXT_CHARS);
  }

  private findFirstUserMessageText(
    messages: ConversationMessageLike[],
  ): string {
    for (const message of messages) {
      if (message.role !== "user") continue;
      const text = this.extractTextFromMessage(message);
      if (text) return text;
    }
    return "";
  }

  private buildSuggestedName(
    conversationTitle: string | null,
    fallbackPrompt: string,
  ): string {
    const trimmedTitle = conversationTitle?.trim();
    if (trimmedTitle) {
      return trimmedTitle.length > 80
        ? `${trimmedTitle.slice(0, 77).trimEnd()}...`
        : trimmedTitle;
    }

    const normalizedPrompt = fallbackPrompt.trim().replace(/\s+/g, " ");
    if (!normalizedPrompt) {
      return "Scheduled task";
    }
    return normalizedPrompt.length > 60
      ? `${normalizedPrompt.slice(0, 57).trimEnd()}...`
      : normalizedPrompt;
  }

  private extractConversationContext(conversation: {
    title?: string | null;
    messages?: unknown[] | null;
  }): {
    messages: ConversationMessageLike[];
    fallbackPrompt: string;
    suggestedName: string;
  } {
    const messages = (conversation.messages ?? []) as ConversationMessageLike[];
    const fallbackPrompt = this.findFirstUserMessageText(messages);
    const suggestedName = this.buildSuggestedName(
      conversation.title ?? null,
      fallbackPrompt,
    );
    return { messages, fallbackPrompt, suggestedName };
  }

  async suggestForConversation(params: {
    conversationId: string;
    userId: string;
    organizationId: string;
  }): Promise<ScheduleTriggerSuggestion> {
    const { conversationId, userId, organizationId } = params;

    const conversation = await ConversationModel.findById({
      id: conversationId,
      userId,
      organizationId,
    });

    if (!conversation) {
      throw new ApiError(404, "Conversation not found");
    }

    const { fallbackPrompt: firstUserText, suggestedName } =
      this.extractConversationContext(conversation);

    const isAgentAdmin = await this.isAgentAdmin(userId, organizationId);

    const usageRows = await InteractionModel.listAgentUsageForSession({
      sessionId: conversationId,
      userId,
      organizationId,
    });

    const agentIdToUsage = new Map(
      usageRows.map((row) => [row.agentId, row] as const),
    );

    const candidateAgentIds = Array.from(agentIdToUsage.keys());
    const agentSummaries = new Map<
      string,
      { id: string; name: string; icon: string | null }
    >();

    const agentResults = await Promise.all(
      candidateAgentIds.map((id) =>
        AgentModel.findById(id, userId, isAgentAdmin),
      ),
    );
    for (const [i, agent] of agentResults.entries()) {
      const agentId = candidateAgentIds[i];
      if (
        !agent ||
        agent.organizationId !== organizationId ||
        agent.agentType !== "agent"
      )
        continue;
      agentSummaries.set(agentId, {
        id: agent.id,
        name: agent.name,
        icon: agent.icon ?? null,
      });
    }

    const candidates: ScheduleTriggerSuggestionCandidate[] = [];
    for (const agentId of candidateAgentIds) {
      const summary = agentSummaries.get(agentId);
      if (!summary) continue;
      const usage = agentIdToUsage.get(agentId);
      if (!usage) continue;
      candidates.push({
        agent: summary,
        interactionCount: usage.count,
        lastUsedAt: usage.lastUsedAt,
      });
    }

    let suggestedAgentId: string | null = null;
    let reason: AgentSuggestionReason = "none";

    if (conversation.agentId) {
      const current = await AgentModel.findById(
        conversation.agentId,
        userId,
        isAgentAdmin,
      );
      if (current && this.isValidInternalAgent(current, organizationId)) {
        suggestedAgentId = current.id;
        reason = "current-conversation-agent";
        if (!agentSummaries.has(current.id)) {
          candidates.unshift({
            agent: {
              id: current.id,
              name: current.name,
              icon: current.icon ?? null,
            },
            interactionCount: 0,
            lastUsedAt: new Date(),
          });
        }
      }
    }

    if (!suggestedAgentId && candidates.length > 0) {
      suggestedAgentId = candidates[0].agent.id;
      reason = "last-interaction";
    }

    if (!suggestedAgentId) {
      const fallback = await this.resolveDefaultAgent({
        conversationAgentId: conversation.agentId,
        userId,
        organizationId,
        isAgentAdmin,
      });
      if (fallback) {
        suggestedAgentId = fallback.agent.id;
        reason = fallback.reason;
      }
    }

    return {
      suggestedAgentId,
      candidates,
      reason,
      suggestedName,
      suggestedMessageTemplatePreview: firstUserText,
    };
  }

  async computeAllowedLinkedAgentIds(params: {
    conversationId: string;
    actorUserId: string;
    organizationId: string;
  }): Promise<{
    allowedAgentIds: Set<string>;
    conversationAgentId: string | null;
  }> {
    const conversation = await ConversationModel.findById({
      id: params.conversationId,
      userId: params.actorUserId,
      organizationId: params.organizationId,
    });
    if (!conversation) {
      throw new ApiError(404, "Linked conversation not found");
    }

    const allowedAgentIds = new Set<string>();
    if (conversation.agentId) {
      allowedAgentIds.add(conversation.agentId);
    }

    const usageRows = await InteractionModel.listAgentUsageForSession({
      sessionId: params.conversationId,
      userId: params.actorUserId,
      organizationId: params.organizationId,
    });
    for (const row of usageRows) {
      allowedAgentIds.add(row.agentId);
    }

    return {
      allowedAgentIds,
      conversationAgentId: conversation.agentId ?? null,
    };
  }

  async assertValidLinkedConversationBinding(params: {
    linkedConversationId: string;
    agentId: string;
    actorUserId: string;
    organizationId: string;
  }): Promise<void> {
    const { allowedAgentIds, conversationAgentId } =
      await this.computeAllowedLinkedAgentIds({
        conversationId: params.linkedConversationId,
        actorUserId: params.actorUserId,
        organizationId: params.organizationId,
      });

    if (!conversationAgentId && allowedAgentIds.size === 0) {
      throw new ApiError(
        400,
        "This conversation has no agent history; scheduled replies cannot be posted here.",
      );
    }

    if (!allowedAgentIds.has(params.agentId)) {
      throw new ApiError(
        400,
        "The scheduled task agent must be the current chat agent or one that has previously participated in this conversation.",
      );
    }
  }

  async isAgentValidForLinkedConversation(params: {
    linkedConversationId: string;
    agentId: string;
    actorUserId: string;
    organizationId: string;
  }): Promise<boolean> {
    try {
      const { allowedAgentIds } = await this.computeAllowedLinkedAgentIds({
        conversationId: params.linkedConversationId,
        actorUserId: params.actorUserId,
        organizationId: params.organizationId,
      });
      return allowedAgentIds.has(params.agentId);
    } catch {
      return false;
    }
  }

  async createFromConversation(params: {
    conversationId: string;
    userId: string;
    organizationId: string;
    cronExpression: string;
    timezone: string;
    name?: string;
    messageTemplate?: string;
    agentId?: string;
    enabled?: boolean;
    replyInSameConversation?: boolean;
  }): Promise<ScheduleTrigger> {
    const {
      conversationId,
      userId,
      organizationId,
      cronExpression,
      timezone,
      name,
      messageTemplate,
      agentId,
      enabled,
      replyInSameConversation,
    } = params;

    const conversation = await ConversationModel.findById({
      id: conversationId,
      userId,
      organizationId,
    });

    if (!conversation) {
      throw new ApiError(404, "Conversation not found");
    }

    const isAgentAdmin = await this.isAgentAdmin(userId, organizationId);

    const resolvedAgent = await this.resolveAgent({
      conversationId,
      conversation,
      userId,
      organizationId,
      isAgentAdmin,
      explicitAgentId: agentId,
    });

    if (!resolvedAgent) {
      throw new ApiError(
        400,
        "Could not determine a suitable agent for the scheduled task. Please specify agentId explicitly.",
      );
    }

    const linkedConversationId =
      replyInSameConversation === true ? conversationId : null;

    if (linkedConversationId) {
      await this.assertValidLinkedConversationBinding({
        linkedConversationId,
        agentId: resolvedAgent.id,
        actorUserId: userId,
        organizationId,
      });
    }

    const { messages, fallbackPrompt, suggestedName } =
      this.extractConversationContext(conversation);

    const effectiveMessageTemplate = await this.deriveMessageTemplate({
      messages,
      explicitMessageTemplate: messageTemplate,
      fallbackPrompt,
      agent: resolvedAgent,
      organizationId,
      userId,
    });

    if (!effectiveMessageTemplate.trim()) {
      throw new ApiError(
        400,
        "The conversation does not contain enough context to derive a prompt. Provide messageTemplate explicitly.",
      );
    }

    const effectiveName = name?.trim() || suggestedName;
    const effectiveEnabled = enabled ?? true;

    const validation = ScheduleTriggerConfigurationSchema.safeParse({
      cronExpression,
      timezone,
      messageTemplate: effectiveMessageTemplate,
    });

    if (!validation.success) {
      const firstIssue = validation.error.issues[0];
      throw new ApiError(
        400,
        firstIssue?.message ?? "Invalid schedule trigger configuration",
      );
    }

    return ScheduleTriggerModel.create({
      organizationId,
      name: effectiveName,
      agentId: resolvedAgent.id,
      messageTemplate: effectiveMessageTemplate,
      cronExpression,
      timezone,
      enabled: effectiveEnabled,
      actorUserId: userId,
      linkedConversationId,
    });
  }

  private async isAgentAdmin(
    userId: string,
    organizationId: string,
  ): Promise<boolean> {
    // Mirror the behavior of other endpoints: honour any agent-type admin.
    return hasAnyAgentTypeAdminPermission({ userId, organizationId });
  }

  private isValidInternalAgent(agent: Agent, organizationId: string): boolean {
    return (
      agent.organizationId === organizationId && agent.agentType === "agent"
    );
  }

  private async resolveDefaultAgent(params: {
    conversationAgentId: string | null;
    userId: string;
    organizationId: string;
    isAgentAdmin: boolean;
  }): Promise<{
    agent: Agent;
    reason: "current-conversation-agent" | "member-default" | "org-default";
  } | null> {
    const { conversationAgentId, userId, organizationId, isAgentAdmin } =
      params;

    if (conversationAgentId) {
      const current = await AgentModel.findById(
        conversationAgentId,
        userId,
        isAgentAdmin,
      );
      if (current && this.isValidInternalAgent(current, organizationId)) {
        return { agent: current, reason: "current-conversation-agent" };
      }
    }

    const memberDefaultAgentId = await MemberModel.getDefaultAgentId(
      userId,
      organizationId,
    );
    if (memberDefaultAgentId) {
      const memberDefault = await AgentModel.findById(
        memberDefaultAgentId,
        userId,
        isAgentAdmin,
      );
      if (
        memberDefault &&
        this.isValidInternalAgent(memberDefault, organizationId)
      ) {
        return { agent: memberDefault, reason: "member-default" };
      }
    }

    const org = await OrganizationModel.getById(organizationId);
    if (org?.defaultAgentId) {
      const orgDefault = await AgentModel.findById(
        org.defaultAgentId,
        userId,
        isAgentAdmin,
      );
      if (orgDefault && this.isValidInternalAgent(orgDefault, organizationId)) {
        return { agent: orgDefault, reason: "org-default" };
      }
    }

    return null;
  }

  private async resolveAgent(params: {
    conversationId: string;
    conversation: { agentId: string | null };
    userId: string;
    organizationId: string;
    isAgentAdmin: boolean;
    explicitAgentId?: string;
  }): Promise<Agent | null> {
    const {
      conversationId,
      conversation,
      userId,
      organizationId,
      isAgentAdmin,
      explicitAgentId,
    } = params;

    if (explicitAgentId) {
      const agent = await AgentModel.findById(
        explicitAgentId,
        userId,
        isAgentAdmin,
      );
      if (!agent) {
        throw new ApiError(403, "You do not have access to the selected agent");
      }
      if (!this.isValidInternalAgent(agent, organizationId)) {
        throw new ApiError(400, "Scheduled triggers require an internal agent");
      }
      return agent;
    }

    // Prefer the conversation's current agent over interaction history so that
    // swap_agent / swap_to_default_agent mutations win.
    if (conversation.agentId) {
      const current = await AgentModel.findById(
        conversation.agentId,
        userId,
        isAgentAdmin,
      );
      if (current && this.isValidInternalAgent(current, organizationId)) {
        return current;
      }
    }

    const usageRows = await InteractionModel.listAgentUsageForSession({
      sessionId: conversationId,
      userId,
      organizationId,
    });

    for (const row of usageRows) {
      const hasAccess = await AgentTeamModel.userHasAgentAccess(
        userId,
        row.agentId,
        isAgentAdmin,
      );
      if (!hasAccess) continue;
      const candidate = await AgentModel.findById(
        row.agentId,
        userId,
        isAgentAdmin,
      );
      if (candidate && this.isValidInternalAgent(candidate, organizationId)) {
        return candidate;
      }
    }

    const fallback = await this.resolveDefaultAgent({
      conversationAgentId: conversation.agentId,
      userId,
      organizationId,
      isAgentAdmin,
    });

    return fallback?.agent ?? null;
  }

  private async deriveMessageTemplate(params: {
    messages: ConversationMessageLike[];
    explicitMessageTemplate: string | undefined;
    fallbackPrompt: string;
    agent: Agent;
    organizationId: string;
    userId: string;
  }): Promise<string> {
    const {
      messages,
      explicitMessageTemplate,
      fallbackPrompt,
      agent,
      organizationId,
      userId,
    } = params;

    const trimmedExplicit = explicitMessageTemplate?.trim();
    if (trimmedExplicit) {
      return trimmedExplicit;
    }

    try {
      const summary = await this.summarizeConversationToPrompt({
        messages,
        agent,
        organizationId,
        userId,
      });
      if (summary) {
        return summary;
      }
    } catch (error) {
      logger.warn(
        { error, agentId: agent.id },
        "[scheduleTriggerConverter] LLM summarization failed, falling back to first user message",
      );
    }

    return fallbackPrompt;
  }

  private async resolveAgentLlm(params: {
    agent: Agent;
    organizationId: string;
    userId?: string;
  }): Promise<{
    provider: SupportedProvider;
    apiKey: string | undefined;
    modelName: string;
    baseUrl: string | null;
  }> {
    const { agent, organizationId, userId } = params;

    if (agent.llmApiKeyId) {
      const apiKey = await LlmProviderApiKeyModel.findById(agent.llmApiKeyId);
      if (apiKey) {
        const bestModel = await LlmProviderApiKeyModelLinkModel.getBestModel(
          apiKey.id,
        );
        const secretValue = apiKey.secretId
          ? await getSecretValueForLlmProviderApiKey(apiKey.secretId)
          : undefined;

        return {
          provider: apiKey.provider,
          apiKey: secretValue,
          modelName:
            agent.llmModel ?? bestModel?.modelId ?? config.chat.defaultModel,
          baseUrl: apiKey.baseUrl,
        };
      }
    }

    if (agent.llmModel) {
      const providers = await ModelModel.findProvidersByModelId(agent.llmModel);

      for (const provider of providers) {
        const resolvedApiKey = await resolveProviderApiKey({
          organizationId,
          userId,
          provider,
        });
        if (
          resolvedApiKey.apiKey ||
          !isApiKeyRequired(provider, resolvedApiKey.apiKey)
        ) {
          return {
            provider,
            apiKey: resolvedApiKey.apiKey,
            modelName: agent.llmModel,
            baseUrl: resolvedApiKey.baseUrl,
          };
        }
      }

      const fallbackProvider = config.chat.defaultProvider;
      const fallbackResolved = await resolveProviderApiKey({
        organizationId,
        userId,
        provider: fallbackProvider,
      });

      return {
        provider: fallbackProvider,
        apiKey:
          fallbackResolved.apiKey ??
          getProviderEnvApiKey(fallbackProvider),
        modelName: agent.llmModel,
        baseUrl: fallbackResolved.baseUrl,
      };
    }

    const smartDefault = await resolveSmartDefaultLlm({
      organizationId,
      userId,
    });
    if (smartDefault) {
      return smartDefault;
    }

    return {
      provider: config.chat.defaultProvider,
      apiKey: getProviderEnvApiKey(config.chat.defaultProvider),
      modelName: config.chat.defaultModel,
      baseUrl: null,
    };
  }

  private async summarizeConversationToPrompt(params: {
    messages: ConversationMessageLike[];
    agent: Agent;
    organizationId: string;
    userId: string;
  }): Promise<string> {
    const { messages, agent, organizationId, userId } = params;

    const normalized = messages
      .filter(
        (message) => message.role === "user" || message.role === "assistant",
      )
      .map((message) => ({
        role: message.role as "user" | "assistant",
        text: this.extractTextFromMessage(message),
      }))
      .filter((entry) => entry.text.length > 0);

    if (normalized.length === 0) {
      return "";
    }

    // Keep the most recent slice so we don't blow the context window on
    // long-running research chats. Always preserve the first user message so
    // the LLM has the original intent.
    const trimmed =
      normalized.length <= MAX_SUMMARY_MESSAGES
        ? normalized
        : [normalized[0], ...normalized.slice(-(MAX_SUMMARY_MESSAGES - 1))];

    const transcript = trimmed
      .map((entry) => `${entry.role.toUpperCase()}: ${entry.text}`)
      .join("\n\n");

    const resolved = await this.resolveAgentLlm({
      agent,
      organizationId,
      userId,
    });

    const model = createDirectLLMModel({
      provider: resolved.provider,
      apiKey: resolved.apiKey,
      modelName: resolved.modelName,
      baseUrl: resolved.baseUrl,
    });

    const limitViolation =
      await LimitValidationService.checkLimitsBeforeRequest(agent.id);
    if (limitViolation) {
      const [, contentMessage] = limitViolation;
      throw new Error(
        `Token cost limit exceeded for agent ${agent.id}: ${contentMessage}`,
      );
    }

    const result = await generateText({
      model,
      system: SUMMARY_SYSTEM_PROMPT,
      prompt: `Conversation transcript:\n\n${transcript}\n\nRewrite the above as a single standalone prompt for a scheduled task.`,
      temperature: 0,
    });

    const inputTokens = result.usage?.inputTokens ?? 0;
    const outputTokens = result.usage?.outputTokens ?? 0;
    if (inputTokens > 0 || outputTokens > 0) {
      await LimitModel.updateTokenLimitUsage(
        "agent",
        agent.id,
        resolved.modelName,
        inputTokens,
        outputTokens,
      ).catch((error) => {
        logger.warn(
          { error, agentId: agent.id },
          "[scheduleTriggerConverter] Failed to update token limit usage after summarization",
        );
      });
    }

    return stripLlmReasoningTags(result.text);
  }
}

export const scheduleTriggerConverterService =
  new ScheduleTriggerConverterService();
export type { ScheduleTriggerConverterService };
export type {
  AgentSuggestionReason,
  ScheduleTriggerSuggestion,
  ScheduleTriggerSuggestionCandidate,
};
