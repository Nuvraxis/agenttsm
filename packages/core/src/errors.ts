export type ErrorCode = "definition" | "route" | "conflict" | "not_found" | "invalid_output";

export class AgentTsmError extends Error {
  override readonly name: string = "AgentTsmError";
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.code = code;
  }
}
