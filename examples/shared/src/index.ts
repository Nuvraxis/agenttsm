import { timingSafeEqual } from "node:crypto";
import type { LLM } from "@nuvraxis-org/agenttsm";
import type { FakeAnswer } from "@nuvraxis-org/agenttsm/testing";
import { FakeLLM } from "@nuvraxis-org/agenttsm/testing";

const MODEL = "claude-opus-5-5";
const USD_PER_INPUT_TOKEN = 4 / 1_000_000;
const USD_PER_OUTPUT_TOKEN = 20 / 1_000_000;

export async function anthropicLLM(): Promise<LLM> {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic();
  return {
    async complete({ prompt, system, signal }) {
      const response = await client.beta.messages.create(
        {
          model: MODEL,
          max_tokens: 16000,
          output_config: { effort: "medium" },
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
          ...(system ? { system } : {}),
          messages: [{ role: "user", content: prompt }],
        },
        signal ? { signal } : {},
      );
      if (response.stop_reason === "refusal") {
        throw new Error(
          `Claude declined the request (${response.stop_details?.category ?? "unknown"})`,
        );
      }
      const text = response.content
        .flatMap((block) => (block.type === "text" ? [block.text] : []))
        .join("");
      const { input_tokens, output_tokens } = response.usage;
      return {
        text,
        tokens: input_tokens + output_tokens,
        // Priced at Claude Opus 5.5 rates; a refusal fallback may have served part of the turn.
        costUsd: input_tokens * USD_PER_INPUT_TOKEN + output_tokens * USD_PER_OUTPUT_TOKEN,
      };
    },
  };
}

export function pickLLM(script: readonly FakeAnswer[]): Promise<LLM> {
  return process.env.LLM === "anthropic" ? anthropicLLM() : Promise.resolve(new FakeLLM(script));
}

export function bearerToken(request: Request): string | undefined {
  const [scheme, token] = request.headers.get("authorization")?.split(" ") ?? [];
  return scheme?.toLowerCase() === "bearer" && token ? token : undefined;
}

export function sameSecret(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
