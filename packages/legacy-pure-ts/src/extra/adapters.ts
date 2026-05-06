/**
 * Adapters barrel — moved into `./io/` per consolidation plan §2 (Tier 2.1 A1).
 *
 * Public-facing source of truth is `./io/index.ts`. Category sub-files
 * (`./io/http.ts`, `./io/websocket.ts`, `./io/webhook.ts`, `./io/sse.ts`,
 * `./io/sink.ts`, `./io/http-error.ts`) re-export by name for category-level
 * discoverability.
 *
 * **Deviation from plan:** the io/ folder names a 6-file split, but adapters.ts
 * also contains many additional adapters (Kafka, Redis, NATS, RabbitMQ,
 * Pulsar, MCP, OTel, Syslog, StatsD, Prometheus, ClickHouse, Pulsar, S3,
 * Postgres, MongoDB, Loki, Tempo, SQLite, Prisma, Drizzle, Kysely, CSV,
 * NDJSON, file/checkpoint sinks). These all live in `./io/index.ts` for now;
 * a finer per-protocol split is deferred.
 *
 * This shim preserves the legacy `src/extra/adapters.ts` import path so
 * consumers do not have to migrate.
 */

export * from "./io/index.js";
