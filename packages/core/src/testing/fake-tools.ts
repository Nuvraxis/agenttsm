export interface ToolScript {
  value?: unknown;
  error?: string;
  delayMs?: number;
}

export type FakeTool = ((...args: unknown[]) => Promise<unknown>) & { calls: unknown[][] };

export function fakeTools<K extends string>(
  script: Readonly<Record<K, readonly ToolScript[]>>,
): Record<K, FakeTool> {
  const tools = {} as Record<K, FakeTool>;
  for (const name of Object.keys(script) as K[]) {
    const queue = [...script[name]];
    const calls: unknown[][] = [];
    const tool = async (...args: unknown[]): Promise<unknown> => {
      calls.push(args);
      const next = queue.shift();
      if (!next)
        throw new Error(`fake tool "${name}" has no scripted result for call ${calls.length}`);
      if (next.delayMs) await new Promise((resolve) => setTimeout(resolve, next.delayMs));
      if (next.error !== undefined) throw new Error(next.error);
      return next.value;
    };
    tools[name] = Object.assign(tool, { calls });
  }
  return tools;
}
