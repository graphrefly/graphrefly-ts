/**
 * Protocol, system, and ingest adapters (roadmap §5.2, §5.2c).
 *
 * Each adapter wraps an external protocol or system as a reactive {@link Node}
 * built on {@link producer} / {@link node} — no second protocol.
 *
 * **Moved from sources.ts:** fromHTTP, fromWebSocket/toWebSocket, fromWebhook,
 * toSSE, fromMCP, fromGitHook.
 *
 * **5.2c:** fromOTel, fromSyslog, fromStatsD, fromPrometheus,
 * fromKafka/toKafka, fromRedisStream/toRedisStream, fromCSV, fromNDJSON,
 * fromClickHouseWatch, fromPulsar/toPulsar, fromNATS/toNATS,
 * fromRabbitMQ/toRabbitMQ.
 *
 * Thin barrel — every adapter lives in a category sub-file:
 * - `_internal.ts` — shared `ExtraOpts` / `sourceOpts` / `SinkHandle` /
 *   `BufferedSinkHandle` / `AdapterHandlers` / `AckableMessage` /
 *   `AttachStorageGraphLike`
 * - `websocket.ts` — `fromWebSocket`, `toWebSocket`, `fromWebSocketReconnect`
 * - `webhook.ts` — `fromWebhook`
 * - `http.ts` — `fromHTTP`, `toHTTP`, `fromHTTPStream`, `fromHTTPPoll`
 * - `sse.ts` — `toSSE`, `toSSEBytes`, `toReadableStream`, `fromSSE`,
 *   `parseSSEStream`
 * - `mcp.ts` — `fromMCP`
 * - `otel.ts` — `fromOTel`
 * - `syslog.ts` — `fromSyslog`, `parseSyslog`
 * - `statsd.ts` — `fromStatsD`, `parseStatsD`
 * - `prometheus.ts` — `fromPrometheus`, `parsePrometheusText`
 * - `kafka.ts` — `fromKafka`, `toKafka`
 * - `redis-stream.ts` — `fromRedisStream`, `toRedisStream`
 * - `csv.ts` — `fromCSV`, `csvRows`
 * - `ndjson.ts` — `fromNDJSON`, `ndjsonRows`
 * - `clickhouse-watch.ts` — `fromClickHouseWatch`
 * - `pulsar.ts` — `fromPulsar`, `toPulsar`
 * - `nats.ts` — `fromNATS`, `toNATS`
 * - `rabbitmq.ts` — `fromRabbitMQ`, `toRabbitMQ`
 * - `to-file.ts` — `toFile` (and shared `FileWriterLike`)
 * - `to-csv.ts` — `toCSV`
 * - `to-clickhouse.ts` — `toClickHouse`
 * - `to-s3.ts` — `toS3` (and shared `S3ClientLike`)
 * - `to-postgres.ts` — `toPostgres`
 * - `to-mongo.ts` — `toMongo`
 * - `to-loki.ts` — `toLoki`
 * - `to-tempo.ts` — `toTempo`
 * - `checkpoint.ts` — `checkpointToS3`, `checkpointToRedis`
 * - `sqlite.ts` — `fromSqlite`, `fromSqliteCursor`, `toSqlite`
 * - `prisma.ts` — `fromPrisma`
 * - `drizzle.ts` — `fromDrizzle`
 * - `kysely.ts` — `fromKysely`
 * - `http-error.ts` — re-export of `../http-error.js`
 * - `sink.ts` — re-export of `../reactive-sink.js`
 *
 * `fromGitHook` and other Node-only ingest adapters live separately in
 * `extra/git-hook.ts` etc. so the universal `extra/index` barrel stays
 * browser-safe (those entries are reached via `extra/node`).
 */

export type { SinkTransportError } from "../reactive-sink.js";
// Shared public re-exports from helpers + reactive-sink. Kept here so the
// barrel surface still includes `SinkHandle` / `AdapterHandlers` / etc. that
// historically lived alongside the bodies.
export type {
	AckableMessage,
	AdapterHandlers,
	BufferedSinkHandle,
	SinkHandle,
} from "./_internal.js";

export * from "./checkpoint.js";
export * from "./clickhouse-watch.js";
export * from "./csv.js";
export * from "./drizzle.js";
export * from "./http.js";
export * from "./kafka.js";
export * from "./kysely.js";
export * from "./mcp.js";
export * from "./nats.js";
export * from "./ndjson.js";
export * from "./otel.js";
export * from "./prisma.js";
export * from "./prometheus.js";
export * from "./pulsar.js";
export * from "./rabbitmq.js";
export * from "./redis-stream.js";
export * from "./sqlite.js";
export * from "./sse.js";
export * from "./statsd.js";
export * from "./syslog.js";
export * from "./to-clickhouse.js";
export * from "./to-csv.js";
export * from "./to-file.js";
export * from "./to-loki.js";
export * from "./to-mongo.js";
export * from "./to-postgres.js";
export * from "./to-s3.js";
export * from "./to-tempo.js";
export * from "./webhook.js";
export * from "./websocket.js";
