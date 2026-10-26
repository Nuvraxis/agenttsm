import type { LLM, LLMRequest, LLMResponse } from "../types.ts";

export type FakeAnswer =
  | string
  | LLMResponse
  | Error
  | ((request: LLMRequest) => string | LLMResponse);

export class FakeLLM implements LLM {
  readonly calls: LLMRequest[] = [];
  readonly #answers: FakeAnswer[];

  constructor(answers: readonly FakeAnswer[]) {
    this.#answers = [...answers];
  }

  async complete(request: LLMRequest): Promise<LLMResponse> {
    this.calls.push(request);
    const answer = this.#answers.shift();
    if (answer === undefined)
      throw new Error(`FakeLLM has no scripted answer for call ${this.calls.length}`);
    if (answer instanceof Error) throw answer;
    const response = typeof answer === "function" ? answer(request) : answer;
    return typeof response === "string" ? { text: response } : response;
  }
}
