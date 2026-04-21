export type ConversationMessageLike = {
  role?: string | null;
  parts?: Array<{ type?: string | null; text?: string | null }> | null;
};
