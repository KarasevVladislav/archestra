import { executeA2AMessage } from "@/agents/a2a-executor";
import { hasAnyAgentTypeAdminPermission } from "@/auth";
import logger from "@/logging";
import {
  AgentModel,
  AgentTeamModel,
  ScheduleTriggerModel,
  ScheduleTriggerRunModel,
  UserModel,
} from "@/models";
import { metrics } from "@/observability";
import { appendLinkedScheduleRunMessagesToConversation } from "@/schedule-triggers/append-linked-run-messages";
import { scheduleTriggerConverterService } from "@/schedule-triggers/converter";
import { resolvePlaceholders } from "@/schedule-triggers/resolve-placeholders";
import websocketService from "@/websocket";

const LINKED_CONVERSATION_AUTO_HEAL_WARNING =
  "Linked chat agent changed; task was unlinked from the chat and will continue as standalone runs.";

export async function handleScheduleTriggerRunExecution(
  payload: Record<string, unknown>,
): Promise<void> {
  const runId = typeof payload.runId === "string" ? payload.runId : null;
  if (!runId) {
    throw new Error("Missing runId in schedule trigger execution payload");
  }

  const triggerId =
    typeof payload.triggerId === "string" ? payload.triggerId : null;

  logger.info({ runId, triggerId }, "Schedule trigger run picked up");

  const run = await ScheduleTriggerRunModel.findById(runId);
  if (!run || run.status !== "running") {
    logger.warn(
      { runId, found: !!run, status: run?.status ?? null },
      "Schedule trigger run skipped, not in running state",
    );
    return;
  }

  const trigger = await ScheduleTriggerModel.findById(run.triggerId);
  if (!trigger) {
    logger.warn(
      { runId: run.id, triggerId: run.triggerId },
      "Schedule trigger run failed, trigger no longer exists",
    );
    await ScheduleTriggerRunModel.markCompleted({
      runId: run.id,
      status: "failed",
      error: "Trigger no longer exists",
    });
    metrics.scheduleTrigger.reportScheduleTriggerRun("unknown", "failed");
    return;
  }

  const triggerAgent = await AgentModel.findById(trigger.agentId);
  const agentName = triggerAgent?.name ?? "unknown";

  let status: "success" | "failed" = "success";
  let errorMessage: string | null = null;

  try {
    const actor = await UserModel.getById(trigger.actorUserId);
    if (!actor) {
      throw new Error("Scheduled trigger actor no longer exists");
    }

    const userIsAgentAdmin = await hasAnyAgentTypeAdminPermission({
      userId: actor.id,
      organizationId: trigger.organizationId,
    });

    const hasAgentAccess = await AgentTeamModel.userHasAgentAccess(
      actor.id,
      trigger.agentId,
      userIsAgentAdmin,
    );
    if (!hasAgentAccess) {
      throw new Error(
        "Scheduled trigger actor no longer has access to the target agent",
      );
    }

    if (!triggerAgent) {
      throw new Error("Scheduled trigger target agent no longer exists");
    }

    if (triggerAgent.agentType !== "agent") {
      throw new Error("Scheduled trigger target must be an internal agent");
    }

    const linkedConversationId = trigger.linkedConversationId;
    const sessionId =
      linkedConversationId ?? `scheduled-${run.id}`;

    const resolvedMessage = resolvePlaceholders(
      trigger.messageTemplate,
      trigger.timezone,
    );

    const result = await executeA2AMessage({
      agentId: trigger.agentId,
      message: resolvedMessage,
      organizationId: trigger.organizationId,
      userId: actor.id,
      sessionId,
      conversationId: linkedConversationId ?? undefined,
      source: "schedule-trigger",
      scheduleTriggerRunId: run.id,
    });

    if (linkedConversationId) {
      const linkedAgentValid =
        await scheduleTriggerConverterService.isAgentValidForLinkedConversation(
          {
            linkedConversationId,
            agentId: trigger.agentId,
            actorUserId: actor.id,
            organizationId: trigger.organizationId,
          },
        );

      if (!linkedAgentValid) {
        logger.warn(
          {
            runId: run.id,
            triggerId: run.triggerId,
            linkedConversationId,
            agentId: trigger.agentId,
          },
          "Schedule trigger linked conversation no longer accepts the trigger agent; auto-healing by clearing linkedConversationId",
        );

        try {
          await ScheduleTriggerModel.update(trigger.id, {
            linkedConversationId: null,
          });
        } catch (healError) {
          logger.error(
            {
              runId: run.id,
              triggerId: run.triggerId,
              error:
                healError instanceof Error
                  ? healError.message
                  : String(healError),
            },
            "Failed to auto-heal schedule trigger linked conversation binding",
          );
        }

        errorMessage = LINKED_CONVERSATION_AUTO_HEAL_WARNING;
      } else {
        try {
          await appendLinkedScheduleRunMessagesToConversation({
            conversationId: linkedConversationId,
            messageTemplate: resolvedMessage,
            assistantText: result.text,
          });
          await ScheduleTriggerRunModel.setChatConversationId(
            run.id,
            linkedConversationId,
          );
          await websocketService.notifyConversationMessagesUpdated({
            conversationId: linkedConversationId,
          });
        } catch (syncError) {
          logger.error(
            {
              runId: run.id,
              triggerId: run.triggerId,
              linkedConversationId,
              error:
                syncError instanceof Error
                  ? syncError.message
                  : String(syncError),
            },
            "Schedule trigger run succeeded but failed to sync messages to linked conversation",
          );
        }
      }
    }
  } catch (error) {
    status = "failed";
    errorMessage = formatScheduleTriggerExecutionError(
      error instanceof Error ? error.message : String(error),
    );
    logger.warn(
      { runId: run.id, triggerId: run.triggerId, error: errorMessage },
      "Scheduled trigger run failed",
    );
  }

  await ScheduleTriggerRunModel.markCompleted({
    runId: run.id,
    status,
    error: errorMessage,
  });

  websocketService.notifyScheduleTriggerRunUpdated({
    organizationId: trigger.organizationId,
    triggerId: run.triggerId,
    runId: run.id,
    notifyUserId: trigger.actorUserId,
  });

  metrics.scheduleTrigger.reportScheduleTriggerRun(agentName, status);

  logger.info(
    { runId: run.id, triggerId: run.triggerId, status, error: errorMessage },
    "Schedule trigger run completed",
  );
}

function formatScheduleTriggerExecutionError(errorMessage: string): string {
  if (!errorMessage.includes("only supports Interactions API")) {
    return errorMessage;
  }

  return `${errorMessage} Scheduled triggers need a different chat-capable model for this agent. Pick a model that supports standard text and tool execution for scheduled runs, then try again.`;
}
