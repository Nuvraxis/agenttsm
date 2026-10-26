# 03 · Approval gate over HTTP

An LLM drafts a refund email, then the run waits for a human to approve it. The machine is served
with `machine.http()` mounted on [Hono](https://hono.dev) in [`src/hono.ts`](src/hono.ts).

```sh
pnpm --filter 03-approval-gate start
```

The script starts the server on a random port, drives it with `fetch`, prints each response and
exits:

```text
POST /runs -> 201 waiting (state: send)
  waiting for: {"kind":"human","prompt":"Approve this refund email?"}
  draft: Hi Sajan, we have refunded $42.00 to your card. It should arrive within 5 business days.
GET /runs/<id> -> 200 waiting (state: send)
POST /runs/<id>/resume -> 200 done (state: send)
  sent: true
```

To keep the server running and call it yourself:

```sh
SERVE=1 PORT=3000 pnpm --filter 03-approval-gate start
curl -X POST localhost:3000/runs -d '{"customer":"Sajan","amountUsd":42,"email":"","sent":false}'
curl localhost:3000/runs/<id>
curl -X POST localhost:3000/runs/<id>/resume -d '{"input":{"approved":true}}'
```

## Routes

| Route                   | Handler                                         | Responses                                             |
| ----------------------- | ----------------------------------------------- | ----------------------------------------------------- |
| `POST /runs`            | `http.start(req)`, body is the ctx              | `201` snapshot, `400` invalid JSON or non-object body |
| `GET /runs/:id`         | `http.get(req, id)`                             | `200` snapshot, `404`                                 |
| `POST /runs/:id/resume` | `http.resume(req, id)`, body `{ "input": ... }` | `200` snapshot, `404`, `409` concurrent resume        |

## What it shows

- `draft` returns `{ to: "send", wait: { kind: "human" } }`. The handler finishes, the snapshot is
  saved with status `waiting`, and `start()` returns.
- `resume(runId, input)` continues from `send`. `draft` does not run again, and the input is in
  `ctx.lastInput`.
- If the reviewer sends `{ "approved": false }`, `send` routes back to `draft`.
- The adapter is three lines. `http()` works with anything that uses Web `Request` and `Response`.
