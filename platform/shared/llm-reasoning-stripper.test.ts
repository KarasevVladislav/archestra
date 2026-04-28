import { describe, expect, test } from "vitest";
import {
  DEFAULT_LLM_REASONING_TAGS,
  stripLlmReasoningTags,
} from "./llm-reasoning-stripper";

describe("stripLlmReasoningTags", () => {
  test("removes paired tags (default tag set)", () => {
    const input = `<thinking>a</thinking><reasoning>b</reasoning>Done.`;
    expect(stripLlmReasoningTags(input)).toBe("Done.");
  });

  test("removes tags with XML attributes", () => {
    const input = `<thinking priority="high" depth="2">internal</thinking>Final answer.`;
    expect(stripLlmReasoningTags(input)).toBe("Final answer.");
  });

  test("strips an unclosed trailing tag by dropping everything after the open", () => {
    const input = `Final prompt.\n<thinking>unfinished LLM rambling`;
    expect(stripLlmReasoningTags(input)).toBe("Final prompt.");
  });

  test("does not strip unclosed pattern when a valid close exists further down", () => {
    const input = `<thinking>a</thinking>Keep this.<thinking>oops`;
    expect(stripLlmReasoningTags(input)).toBe("Keep this.");
  });

  test("supports custom tag list", () => {
    const input = `<reasoning>internal</reasoning>Final prompt.`;
    expect(stripLlmReasoningTags(input, ["thinking"])).toBe(
      `<reasoning>internal</reasoning>Final prompt.`,
    );
  });

  test("exports non-empty default tag list", () => {
    expect(DEFAULT_LLM_REASONING_TAGS.length).toBeGreaterThan(0);
  });
});
