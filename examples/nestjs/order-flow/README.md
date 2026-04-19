# nestjs / order-flow

Full NestJS integration example demonstrating every GraphReFly integration
point:

1. Module registration — `GraphReflyModule.forRoot()` + `forCqrs()`.
2. Actor extraction from a request header (`GraphReflyGuard`).
3. CQRS flow — command → event → projection → saga.
4. Scheduled jobs — `fromTimer` / `fromCron` as graph nodes.
5. WebSocket observe gateway.
6. SSE stream of events via `observeSSE`.
7. Admin endpoints — `graph.describe()`, Mermaid, D2.

## Run

```bash
pnpm install
pnpm start    # http://localhost:3000
```

Hit it:

```bash
curl -X POST http://localhost:3000/orders/place \
  -H "Content-Type: application/json" \
  -d '{"id":"order-1","item":"Widget","amount":29.99}'

curl http://localhost:3000/orders/summary
curl -N http://localhost:3000/orders/stream
curl http://localhost:3000/admin/describe | jq .
```
