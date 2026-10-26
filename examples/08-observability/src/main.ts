import { defineMachine, type RunEvent } from "@nuvraxis-org/agenttsm";
import type { Span } from "@opentelemetry/api";
import { context, SpanStatusCode, trace } from "@opentelemetry/api";
import {
  BasicTracerProvider,
  ConsoleSpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { pickLLM } from "examples-shared";

process.env.OTEL_SERVICE_NAME ??= "agenttsm-example";

const provider = new BasicTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(new ConsoleSpanExporter())],
});
const tracer = provider.getTracer("agenttsm-example");

const machine = defineMachine({
  initial: "classify",
  retry: { baseMs: 20 },
  llm: await pickLLM([new Error("overloaded"), "invoice", "Paid invoice INV-7 for $120."]),
  states: {
    classify: {
      to: ["extract"],
      maxRetries: 2,
      run: async (ctx: { document: string; kind: string; summary: string }, step) => {
        ctx.kind = (await step.llm.complete({ prompt: `Classify: ${ctx.document}` })).text.trim();
        return "extract";
      },
    },
    extract: {
      run: async (ctx, step) => {
        ctx.summary = (
          await step.llm.complete({ prompt: `Summarize the ${ctx.kind}: ${ctx.document}` })
        ).text;
        return { done: true };
      },
    },
  },
});

type RunSpans = { run: Span; state: Span };

const runs = new Map<string, RunSpans>();
let starting: RunSpans | undefined;

const openState = (run: Span, state: string): Span =>
  tracer.startSpan(
    `state ${state}`,
    { attributes: { "agenttsm.state": state } },
    trace.setSpan(context.active(), run),
  );

function spansFor(runId: string): RunSpans | undefined {
  const known = runs.get(runId);
  if (known || !starting) return known;
  starting.run.setAttribute("agenttsm.run_id", runId);
  runs.set(runId, starting);
  const claimed = starting;
  starting = undefined;
  return claimed;
}

machine.on("*", (event: RunEvent) => {
  const level = event.type === "failed" ? "error" : event.type === "retry" ? "warn" : "info";
  console.log(JSON.stringify({ level, msg: `agenttsm.${event.type}`, ...event }));

  const spans = spansFor(event.runId);
  if (!spans) return;
  if (event.type === "retry") spans.state.addEvent("retry", { detail: JSON.stringify(event.data) });
  if (event.type === "transition") {
    spans.state.end();
    spans.state = openState(spans.run, (event.data as { to: string }).to);
  }
  if (event.type === "done" || event.type === "failed") {
    const code = event.type === "done" ? SpanStatusCode.OK : SpanStatusCode.ERROR;
    spans.state.setStatus({ code });
    spans.state.end();
    spans.run.setStatus({ code });
    spans.run.end();
    runs.delete(event.runId);
  }
});

const run = tracer.startSpan("agenttsm run");
starting = { run, state: openState(run, "classify") };
const snapshot = await machine.start({ document: "INV-7: $120, paid", kind: "", summary: "" });
await provider.shutdown();

console.log(`\n${snapshot.status}: ${snapshot.ctx.kind} -> ${snapshot.ctx.summary}`);
if (snapshot.status !== "done") process.exitCode = 1;
