import { AgentTsmError } from "./errors.ts";

const FENCED = /^```(?:json)?\s*\n([\s\S]*?)\n?```$/i;
const PREVIEW_CHARS = 200;

const reasonOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export function parseJsonOutput<T>(text: string, parse: (value: unknown) => T): T {
  const trimmed = text.trim();
  const body = FENCED.exec(trimmed)?.[1] ?? trimmed;
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
