import { z } from "zod";

const Uuid = z.uuidv4();

export const CreateScheduleTriggerFromConversationBodySchema = z.object({
  conversationId: Uuid,
  cronExpression: z.string().min(1),
  timezone: z.string().min(1),
  name: z.string().min(1).optional(),
  messageTemplate: z.string().min(1).optional(),
  agentId: Uuid.optional(),
  enabled: z.boolean().optional(),
  replyInSameConversation: z.boolean().optional(),
});

export type CreateScheduleTriggerFromConversationBody = z.infer<
  typeof CreateScheduleTriggerFromConversationBodySchema
>;
