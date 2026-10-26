# 08 · Observability

`machine.on("*", fn)` turns every run event into a structured JSON log line and an OpenTelemetry
span: one span for the run, a child span per state, and a span event per retry. Spans are printed
by `ConsoleSpanExporter`.

```sh
pnpm --filter 08-observability start
```

```text
{"level":"warn","msg":"agenttsm.retry","type":"retry","runId":"…","state":"classify","at":"…","data":{"attempt":1,"delayMs":14,"error":"overloaded"}}
{"level":"info","msg":"agenttsm.transition","type":"transition","runId":"…","state":"classify","at":"…","data":{"from":"classify","to":"extract"}}
{ name: 'state classify', attributes: { 'agenttsm.state': 'classify' }, events: [ { name: 'retry', … } ], … }
{"level":"info","msg":"agenttsm.done","type":"done","runId":"…","state":"extract","at":"…"}
{ name: 'state extract', … }
{ name: 'agenttsm run', attributes: { 'agenttsm.run_id': '…' }, status: { code: 1 }, … }

done: invoice -> Paid invoice INV-7 for $120.
```

## What it shows

- Events are delivered after the snapshot that contains them has been saved, in the order they
  happened.
- `"*"` subscribes to every event, including custom ones from `step.emit()`. `on()` returns an
  unsubscribe function.
- A listener that throws is logged with `console.error` and doesn't affect the run.
- To send spans to a collector, replace `ConsoleSpanExporter` with an OTLP exporter. The event
  handling stays the same.

## Real model

```sh
LLM=anthropic ANTHROPIC_API_KEY=... pnpm --filter 08-observability start
```
