"use client";

import { Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ScheduleTriggerFormDialog,
  type ScheduleTriggerAgentOption,
} from "@/components/scheduled-tasks/schedule-trigger-form-dialog";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useProfiles } from "@/lib/agent.query";
import {
  useConversationScheduleTriggerSuggestion,
  useCreateScheduleTriggerFromConversation,
} from "@/lib/schedule-trigger.query";

const DEFAULT_CRON_EXPRESSION = "0 9 * * 1-5";

const REPLY_IN_SAME_HELP_TEXT =
  "Pick any agent that has already participated in this chat.";
const REPLY_IN_SAME_NO_HISTORY_TEXT =
  "This chat has no agent history yet, so replies can't be posted here. Send at least one message first.";

export function ConvertToScheduledTaskDialog({
  conversationId,
  open,
  onOpenChange,
}: {
  conversationId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const { data: suggestion } = useConversationScheduleTriggerSuggestion(
    open ? conversationId : null,
  );
  const { data: agents = [], isLoading: agentsLoading } = useProfiles({
    enabled: open,
    filters: { agentType: "agent" },
  });
  const createMutation = useCreateScheduleTriggerFromConversation();

  const [name, setName] = useState("");
  const [agentId, setAgentId] = useState("");
  const [cronExpression, setCronExpression] = useState(DEFAULT_CRON_EXPRESSION);
  const [timezone, setTimezone] = useState(
    Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  );
  const [useAiSummary, setUseAiSummary] = useState(true);
  const [messageTemplate, setMessageTemplate] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [replyInSameConversation, setReplyInSameConversation] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  const createMutationResetRef = useRef(createMutation.reset);
  createMutationResetRef.current = createMutation.reset;
  const previousOpenRef = useRef(open);
  const previousConversationIdRef = useRef(conversationId);

  // Re-hydrate when the dialog is reused for a different conversation.
  useEffect(() => {
    if (previousConversationIdRef.current !== conversationId) {
      previousConversationIdRef.current = conversationId;
      setHydrated(false);
    }
  }, [conversationId]);

  useEffect(() => {
    if (!open) {
      setHydrated(false);
      return;
    }
    if (hydrated || !suggestion) return;
    setName(suggestion.suggestedName ?? "");
    if (suggestion.suggestedAgentId) {
      setAgentId(suggestion.suggestedAgentId);
    }
    setHydrated(true);
  }, [open, suggestion, hydrated]);

  const linkedAllowedAgentIds = useMemo(() => {
    const ids = new Set<string>();
    for (const candidate of suggestion?.candidates ?? []) {
      ids.add(candidate.agent.id);
    }
    if (suggestion?.suggestedAgentId) {
      ids.add(suggestion.suggestedAgentId);
    }
    return ids;
  }, [suggestion?.candidates, suggestion?.suggestedAgentId]);

  useEffect(() => {
    if (!replyInSameConversation || linkedAllowedAgentIds.size === 0) return;
    if (agentId && linkedAllowedAgentIds.has(agentId)) return;
    const fallback =
      suggestion?.suggestedAgentId ??
      suggestion?.candidates[0]?.agent.id ??
      "";
    if (fallback) {
      setAgentId(fallback);
    }
  }, [
    replyInSameConversation,
    linkedAllowedAgentIds,
    agentId,
    suggestion?.suggestedAgentId,
    suggestion?.candidates,
  ]);

  useEffect(() => {
    const wasOpen = previousOpenRef.current;
    previousOpenRef.current = open;

    if (!wasOpen || open) return;

    setName("");
    setAgentId("");
    setCronExpression(DEFAULT_CRON_EXPRESSION);
    setTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
    setUseAiSummary(true);
    setMessageTemplate("");
    setEnabled(true);
    setReplyInSameConversation(false);
    createMutationResetRef.current();
  }, [open]);

  const trimmedName = name.trim();
  const trimmedTimezone = timezone.trim();
  const trimmedTemplate = messageTemplate.trim();
  const isTemplateReady = useAiSummary || trimmedTemplate.length > 0;
  const isFormValid =
    !!trimmedName &&
    !!agentId &&
    !!cronExpression.trim() &&
    !!trimmedTimezone &&
    isTemplateReady;

  const linkedAgentOptions = useMemo<ScheduleTriggerAgentOption[]>(() => {
    const seen = new Set<string>();
    const options: ScheduleTriggerAgentOption[] = [];

    for (const candidate of suggestion?.candidates ?? []) {
      if (seen.has(candidate.agent.id)) continue;
      seen.add(candidate.agent.id);
      const agentDetails = agents.find((a) => a.id === candidate.agent.id);
      options.push({
        value: candidate.agent.id,
        label: candidate.agent.name || "Untitled agent",
        description: agentDetails?.description ?? undefined,
      });
    }

    if (suggestion?.suggestedAgentId && !seen.has(suggestion.suggestedAgentId)) {
      const fallback = agents.find(
        (a) => a.id === suggestion.suggestedAgentId,
      );
      if (fallback) {
        options.unshift({
          value: fallback.id,
          label: fallback.name || "Untitled agent",
          description: fallback.description ?? undefined,
        });
      }
    }

    return options;
  }, [suggestion?.candidates, suggestion?.suggestedAgentId, agents]);

  const fullAgentOptions = useMemo<ScheduleTriggerAgentOption[]>(
    () =>
      agents.map((agent) => ({
        value: agent.id,
        label: agent.name || "Untitled agent",
        description: agent.description ?? undefined,
      })),
    [agents],
  );

  const agentOptions = replyInSameConversation
    ? linkedAgentOptions
    : fullAgentOptions;
  const hasAgents = agentOptions.length > 0;
  const linkedSelectorDisabled =
    replyInSameConversation && linkedAgentOptions.length === 0;

  const values = useMemo(
    () => ({
      name,
      agentId,
      cronExpression,
      timezone,
      messageTemplate,
      enabled,
    }),
    [name, agentId, cronExpression, timezone, messageTemplate, enabled],
  );

  const handleSubmit = async () => {
    if (!isFormValid) return;

    const created = await createMutation.mutateAsync({
      conversationId,
      name: trimmedName,
      agentId,
      cronExpression: cronExpression.trim(),
      timezone: trimmedTimezone,
      enabled,
      ...(replyInSameConversation ? { replyInSameConversation: true } : {}),
      ...(useAiSummary ? {} : { messageTemplate: trimmedTemplate }),
    });

    if (created) {
      onOpenChange(false);
      router.push(`/scheduled-tasks?triggerId=${created.id}`);
    }
  };

  return (
    <ScheduleTriggerFormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Convert to scheduled task"
      values={values}
      agentOptions={agentOptions}
      agentsLoading={agentsLoading}
      hasAgents={hasAgents}
      isSaving={createMutation.isPending}
      isFormValid={isFormValid}
      permissions={{ scheduledTask: ["create"] }}
      submitLabel="Create scheduled task"
      onSubmit={() => {
        void handleSubmit();
      }}
      onNameChange={setName}
      onAgentChange={setAgentId}
      onCronExpressionChange={setCronExpression}
      onTimezoneChange={setTimezone}
      onEnabledChange={setEnabled}
      onMessageTemplateChange={setMessageTemplate}
      showTimezone
      showEnabled
      agentSelectDisabled={linkedSelectorDisabled}
      agentSelectHelpText={
        replyInSameConversation
          ? linkedSelectorDisabled
            ? REPLY_IN_SAME_NO_HISTORY_TEXT
            : REPLY_IN_SAME_HELP_TEXT
          : undefined
      }
      postEnabledSection={
        <div className="flex items-center justify-between rounded-md border p-3">
          <div>
            <Label htmlFor="dialog-reply-in-same-conversation">
              Post scheduled replies in this conversation
            </Label>
            <p className="text-xs text-muted-foreground">
              Replies will be posted to this chat.
            </p>
          </div>
          <Switch
            id="dialog-reply-in-same-conversation"
            checked={replyInSameConversation}
            onCheckedChange={setReplyInSameConversation}
          />
        </div>
      }
      promptHeaderExtra={
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <Sparkles className="h-3 w-3" />
            AI summary
            <Switch checked={useAiSummary} onCheckedChange={setUseAiSummary} />
          </label>
        </div>
      }
      promptBody={
        useAiSummary ? (
          <div className="rounded-md border border-dashed bg-muted/30 p-3 text-xs text-muted-foreground space-y-1">
            <p>
              On save we'll summarize this conversation into a standalone prompt via
              LLM.
            </p>
            {suggestion?.suggestedMessageTemplatePreview && (
              <p className="line-clamp-3">
                <span className="font-medium text-foreground">Preview: </span>
                {suggestion.suggestedMessageTemplatePreview}
              </p>
            )}
          </div>
        ) : (
          <Textarea
            id="dialog-prompt"
            value={messageTemplate}
            onChange={(event) => setMessageTemplate(event.target.value)}
            placeholder={
              suggestion?.suggestedMessageTemplatePreview ||
              "Write the exact prompt to send on every run."
            }
            className="min-h-[100px] resize-y"
          />
        )
      }
    />
  );
}
