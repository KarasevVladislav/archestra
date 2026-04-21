import type { ScheduleTriggerSuggestion } from "@/types";

export type AgentSuggestionReason = ScheduleTriggerSuggestion["reason"];
export type ScheduleTriggerSuggestionCandidate =
  ScheduleTriggerSuggestion["candidates"][number];
export type { ScheduleTriggerSuggestion };
