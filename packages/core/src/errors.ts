export type ErrorCode = "definition" | "route" | "conflict" | "not_found";

export class AgentTsmError extends Error {
  override readonly name: string = "AgentTsmError";
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}
