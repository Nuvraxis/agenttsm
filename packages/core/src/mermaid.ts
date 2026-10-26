interface Shape {
  initial: string;
  states: Record<string, { to?: readonly string[]; final?: boolean }>;
}

export function toMermaid({ initial, states }: Shape): string {
  const lines = ["stateDiagram-v2", `  [*] --> ${initial}`];
  for (const [name, state] of Object.entries(states)) {
    for (const to of state.to ?? []) lines.push(`  ${name} --> ${to}`);
    if (state.final || !state.to?.length) lines.push(`  ${name} --> [*]`);
  }
  return lines.join("\n");
}
