export const SUMMARY_SYSTEM_PROMPT = `You are compressing a chat transcript into a single standalone prompt that can be used to re-execute the same task on a recurring schedule.

Rules:
- Output only the prompt text. No preamble, no trailing commentary, no markdown headings.
- Keep it concise but specific. Preserve concrete filters, identifiers, dates and entities mentioned by the user.
- If the user referenced relative time phrases like "today", "yesterday", "last week", replace them with placeholders such as {{today}}, {{yesterday}}, {{last_week}} so they resolve at run time.
- Describe the deliverable explicitly (e.g. "produce a markdown summary", "create a Linear issue", etc.).
- Do not reference the fact that this came from a prior conversation.
- Do not use XML tags, angle-bracket blocks, or hidden reasoning — only the final prompt text.`;

export const MAX_SUMMARY_MESSAGES = 30;

export const MAX_MESSAGE_TEXT_CHARS = 4000;
