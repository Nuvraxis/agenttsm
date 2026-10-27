import { AgentTsmError } from "./errors.ts";

const FENCE = "```";
const PREVIEW_CHARS = 200;

const reasonOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

// String checks rather than a regex: the text is model output, and a backtracking pattern over
// it can take quadratic time.
function unfence(text: string): string {
  if (!text.startsWith(FENCE) || !text.endsWith(FENCE)) return text;
  const newline = text.indexOf("\n");
  if (newline === -1 || newline + 1 > text.length - FENCE.length) return text;
  const info = text.slice(FENCE.length, newline).trim().toLowerCase();
  return info === "" || info === "json" ? text.slice(newline + 1, -FENCE.length) : text;
}

export function parseJsonOutput<T>(text: string, parse: (value: unknown) => T): T {
  const trimmed = text.trim();
  const body = unfence(trimmed);
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch (error) {
    const preview =
      trimmed.length > PREVIEW_CHARS ? `${trimmed.slice(0, PREVIEW_CHARS)}…` : trimmed;
    throw new AgentTsmError("invalid_output", `LLM output is not JSON: ${preview}`, {
      cause: error,
    });
  }
  try {
    return parse(value);
  } catch (error) {
    throw new AgentTsmError("invalid_output", `LLM output failed validation: ${reasonOf(error)}`, {
      cause: error,
    });
  }
}
