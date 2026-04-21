/**
 * Strip common LLM reasoning/thinking wrappers from text output.
 *
 * Handles:
 *fully-paired tags:            <thinking>...</thinking>
 *tags with XML attributes:     <thinking priority="high">...</thinking>
 *unclosed trailing tags:       <thinking>... (drops everything after open)
 *redacted tags:                <redacted_thinking>...</redacted_thinking>
 */
export const DEFAULT_LLM_REASONING_TAGS = [
  "redacted_thinking",
  "thinking",
  "think",
  "reasoning",
] as const;

function buildPairedRegex(tag: string): RegExp {
  return new RegExp(
    "<" + tag + "(\\s+[^>]*)?>[\\s\\S]*?<\\/" + tag + "\\s*>",
    "gi",
  );
}

function buildUnclosedRegex(tag: string): RegExp {
  return new RegExp("<" + tag + "(\\s+[^>]*)?>[\\s\\S]*$", "i");
}

export function stripLlmReasoningTags(
  text: string,
  tags: readonly string[] = DEFAULT_LLM_REASONING_TAGS,
): string {
  let out = text;

  for (const tag of tags) {
    out = out.replace(buildPairedRegex(tag), "");
  }

  for (const tag of tags) {
    const closeRegex = new RegExp("<\\/" + tag + "\\s*>", "i");
    if (!closeRegex.test(out)) {
      out = out.replace(buildUnclosedRegex(tag), "");
    }
  }

  return out.replace(/\n{3,}/g, "\n\n").trim();
}

