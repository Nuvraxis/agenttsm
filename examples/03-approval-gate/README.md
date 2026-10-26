# 03 · Approval gate over HTTP

An LLM drafts a refund email, then the run waits for a human to approve it. The machine is served
with `machine.http()` mounted on [Hono](https://hono.dev) in [`src/hono.ts`](src/hono.ts).

```sh
pnpm --filter 03-approval-gate start
```

The script starts the server on a random port, drives it with `fetch`, prints each response and
exits. The requester's attempt to approve their own refund is refused:

```text
requester POST /runs -> 201 waiting (state: send)
  waiting for: {"kind":"human","prompt":"Approve this refund email?"}
  draft: Hi Sajan, we have refunded $42.00 to your card. It should arrive within 5 business days.
requester GET /runs/<id> -> 200 waiting (state: send)
requester POST /runs/<id>/resume -> 403 forbidden
reviewer  POST /runs/<id>/resume -> 200 done (state: send)
  sent: true
```

To keep the server running and call it yourself, set the two tokens (otherwise random ones are
generated and printed in the `curl` lines):

```sh
REQUESTER_TOKEN=req-secret REVIEWER_TOKEN=rev-secret SERVE=1 PORT=3000 pnpm --filter 03-approval-gate start
curl -H 'authorization: Bearer req-secret' -X POST localhost:3000/runs -d '{"customer":"Sajan","amountUsd":42,"email":"","sent":false}'
curl -H 'authorization: Bearer req-secret' localhost:3000/runs/<id>
curl -H 'authorization: Bearer rev-secret' -X POST localhost:3000/runs/<id>/resume -d '{"input":{"approved":true}}'
```

## Routes

| Route                   | Handler                                         | Who                 | Responses                                             |
| ----------------------- | ----------------------------------------------- | ------------------- | ----------------------------------------------------- |
| `POST /runs`            | `http.start(req)`, body is the ctx              | requester, reviewer | `201` snapshot, `400` invalid JSON or non-object body |
| `GET /runs/:id`         | `http.get(req, id)`                             | requester, reviewer | `200` snapshot, `404`                                 |
| `POST /runs/:id/resume` | `http.resume(req, id)`, body `{ "input": ... }` | reviewer            | `200` snapshot, `404`, `409` concurrent resume        |

Every route also answers `401` without a bearer token and `403` when the role may not call it.

## What it shows

- `draft` returns `{ to: "send", wait: { kind: "human" } }`. The handler finishes, the snapshot is
  saved with status `waiting`, and `start()` returns.
- `resume(runId, input)` continues from `send`. `draft` does not run again, and the input is in
  `ctx.lastInput`.
- If the reviewer sends `{ "approved": false }`, `send` routes back to `draft`.
- The adapter is three lines. `http()` works with anything that uses Web `Request` and `Response`.
- `http({ authorize })` is required. [`src/auth.ts`](src/auth.ts) stands in for a real session
  check: the requester may start and read runs, and only the reviewer may resume. `authorize` also
  receives the stored snapshot for `get` and `resume`, so a real app can check that the caller owns
  the run.
- A `lastInput` sent in the start body is dropped. Only `resume` can set it, so nobody can
  pre-approve a refund through `POST /runs`.
