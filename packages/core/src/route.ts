import { AgentTsmError } from "./errors.ts";
import type { EventType, LLM } from "./types.ts";

type Route = <A extends string>(allowed: readonly A[], prompt: string) => Promise<{ to: A }>;

export function createRoute(llm: LLM, emit: (type: EventType, data: unknown) => void): Route {
  return async (allowed, prompt) => {
    const options = allowed.join(", ");
    let ask = `${prompt}\n\nReply with exactly one of: ${options}`;
    for (let attempt = 1; attempt <= 2; attempt++) {
      const { text } = await llm.complete({ prompt: ask });
      const answer = text.trim().replace(/^["'`]+|["'`.!]+$/g, "");
      const to = allowed.find((name) => name.toLowerCase() === answer.toLowerCase());
      emit("route", { answer: text, to: to ?? null, attempt });
      if (to !== undefined) return { to };
      ask = `${prompt}\n\nYour previous answer "${text.trim()}" was not valid. Reply with exactly one of: ${options}`;
    }
    throw new AgentTsmError("route", `LLM did not pick one of: ${options}`);
  };
}
