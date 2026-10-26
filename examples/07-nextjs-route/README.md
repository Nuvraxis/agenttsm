# 07 · Next.js route handlers

A refund review runs behind Next.js App Router route handlers. Each handler is one line that
forwards to `machine.http()`.

```text
app/api/runs/route.ts               POST  -> http.start(request)
app/api/runs/[id]/route.ts          GET   -> http.get(request, id)
app/api/runs/[id]/resume/route.ts   POST  -> http.resume(request, id)
lib/machine.ts                      the machine, created once per server process
```

```sh
pnpm --filter 07-nextjs-route start
```

`start` imports the three route modules and calls them with Web `Request` objects, without a
server, then exits:

```text
POST /api/runs without a token -> 401
POST /api/runs -> 201 waiting (state: decide)
  recommendation: Approve: the item arrived damaged.
GET /api/runs/<id> -> 200 waiting (state: decide)
POST /api/runs/<id>/resume -> 200 done (state: decide)
  decision: refunded
```

To run the real Next.js server, set `REFUND_API_TOKEN` and send it as a bearer token. Without it,
every route answers `401`:

```sh
pnpm exec turbo run build --filter=@nuvraxis-org/agenttsm   # Next resolves the built package
REFUND_API_TOKEN=dev-secret pnpm --filter 07-nextjs-route dev
curl -H 'authorization: Bearer dev-secret' -X POST localhost:3000/api/runs -d '{"orderId":"A-1001","reason":"arrived damaged","recommendation":"","decision":""}'
curl -H 'authorization: Bearer dev-secret' -X POST localhost:3000/api/runs/<id>/resume -d '{"input":"approve"}'
```

`pnpm --filter 07-nextjs-route build` runs `next build`, which type-checks with the project's
TypeScript 7 `tsc`.

## Notes

- `machine.http({ authorize })` is required. The `authorize` in `lib/machine.ts` compares the bearer
  token with `REFUND_API_TOKEN` in constant time; replace it with your session check.

- `lib/machine.ts` caches the handlers on `globalThis`, so dev-mode reloads don't drop runs held
  in the in-memory store. A deployment with more than one instance needs a shared `Store`.
- Handlers use `RouteContext<"/api/runs/[id]">`, which `next typegen` generates.
- `next.config.ts` sets `turbopack.root` to the monorepo root, and `transpilePackages` for the
  shared example helper, which ships TypeScript source.

## Real model

```sh
LLM=anthropic ANTHROPIC_API_KEY=... pnpm --filter 07-nextjs-route start
```
