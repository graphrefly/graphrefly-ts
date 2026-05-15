#!/usr/bin/env node

/**
 * codemod-cleave-A.ts — A2 execution: purify @graphrefly/pure-ts.
 *
 * Moves presentation files from packages/pure-ts/src/ to root src/{base,utils,presets,compat}/
 * Renames substrate files within pure-ts (sources/iter.ts → sources/sync/iter.ts, etc.)
 * Deletes 25 backward-compat shims at extra/*.ts (extra/storage.ts absent from disk)
 * Rewrites imports across the monorepo
 * Migrates presentation tests to root src/__tests__/ (Option B)
 * Moves trackingKey → utils/harness/_internal.ts (STOP #1 resolved)
 *
 * Usage:
 *   pnpm tsx scripts/codemod-cleave-A.ts [--dry]
 *
 * Provenance: archive/docs/SESSION-DS-cleave-A-file-moves.md
 * Escalations resolved: STOP #1 (trackingKey destination), STOP #2 (test migration Option B),
 *   MINOR (extra/storage.ts absent from disk).
 */

import { existsSync, statSync } from "node:fs";
import { copyFile, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const PURE_TS_SRC = join(ROOT, "packages/pure-ts/src");
const PURE_TS_TESTS = join(ROOT, "packages/pure-ts/src/__tests__");
const ROOT_SRC = join(ROOT, "src");
const ROOT_TESTS = join(ROOT, "src/__tests__");

const DRY = process.argv.includes("--dry");

// ---------------------------------------------------------------------------
// MOVES TABLE
// ---------------------------------------------------------------------------
// Format: [oldRelpath, newRelpath]
// oldRelpath: relative to packages/pure-ts/src/
// newRelpath: either relative to packages/pure-ts/src/ (substrate stays)
//             or prefixed with "ROOT:" for moves to root src/
//
// Longest-prefix-first to avoid premature matches.

type Move = {
	from: string; // relative to PURE_TS_SRC
	to: string; // relative to PURE_TS_SRC (substrate) or ROOT_SRC (presentation)
	toRoot: boolean; // true = destination is ROOT_SRC
};

const MOVES: Move[] = [
	// -------------------------------------------------------------------------
	// Substrate renames (within pure-ts)
	// -------------------------------------------------------------------------
	{ from: "extra/sources/iter.ts", to: "extra/sources/sync/iter.ts", toRoot: false },
	{ from: "extra/sources/event.ts", to: "extra/sources/event/_orig.ts", toRoot: false }, // handled via symbol split below
	{ from: "extra/timer.ts", to: "core/_internal/timer.ts", toRoot: false },
	{ from: "extra/utils/ring-buffer.ts", to: "core/_internal/ring-buffer.ts", toRoot: false },
	{ from: "extra/utils/sizeof.ts", to: "core/_internal/sizeof.ts", toRoot: false },

	// -------------------------------------------------------------------------
	// Presentation → base/io/ (31 files from extra/io/)
	// -------------------------------------------------------------------------
	{ from: "extra/io/_internal.ts", to: "base/io/_internal.ts", toRoot: true },
	{ from: "extra/io/checkpoint.ts", to: "base/io/checkpoint.ts", toRoot: true },
	{ from: "extra/io/clickhouse-watch.ts", to: "base/io/clickhouse-watch.ts", toRoot: true },
	{ from: "extra/io/csv.ts", to: "base/io/csv.ts", toRoot: true },
	{ from: "extra/io/drizzle.ts", to: "base/io/drizzle.ts", toRoot: true },
	{ from: "extra/io/http-error.ts", to: "base/io/http-error.ts", toRoot: true },
	{ from: "extra/io/http.ts", to: "base/io/http.ts", toRoot: true },
	{ from: "extra/io/index.ts", to: "base/io/index.ts", toRoot: true },
	{ from: "extra/io/kafka.ts", to: "base/io/kafka.ts", toRoot: true },
	{ from: "extra/io/kysely.ts", to: "base/io/kysely.ts", toRoot: true },
	{ from: "extra/io/mcp.ts", to: "base/io/mcp.ts", toRoot: true },
	{ from: "extra/io/nats.ts", to: "base/io/nats.ts", toRoot: true },
	{ from: "extra/io/ndjson.ts", to: "base/io/ndjson.ts", toRoot: true },
	{ from: "extra/io/otel.ts", to: "base/io/otel.ts", toRoot: true },
	{ from: "extra/io/prisma.ts", to: "base/io/prisma.ts", toRoot: true },
	{ from: "extra/io/prometheus.ts", to: "base/io/prometheus.ts", toRoot: true },
	{ from: "extra/io/pulsar.ts", to: "base/io/pulsar.ts", toRoot: true },
	{ from: "extra/io/rabbitmq.ts", to: "base/io/rabbitmq.ts", toRoot: true },
	{ from: "extra/io/redis-stream.ts", to: "base/io/redis-stream.ts", toRoot: true },
	{ from: "extra/io/sink.ts", to: "base/io/sink.ts", toRoot: true },
	{ from: "extra/io/sqlite.ts", to: "base/io/sqlite.ts", toRoot: true },
	{ from: "extra/io/sse.ts", to: "base/io/sse.ts", toRoot: true },
	{ from: "extra/io/statsd.ts", to: "base/io/statsd.ts", toRoot: true },
	{ from: "extra/io/syslog.ts", to: "base/io/syslog.ts", toRoot: true },
	{ from: "extra/io/to-clickhouse.ts", to: "base/io/to-clickhouse.ts", toRoot: true },
	{ from: "extra/io/to-csv.ts", to: "base/io/to-csv.ts", toRoot: true },
	{ from: "extra/io/to-file.ts", to: "base/io/to-file.ts", toRoot: true },
	{ from: "extra/io/to-loki.ts", to: "base/io/to-loki.ts", toRoot: true },
	{ from: "extra/io/to-mongo.ts", to: "base/io/to-mongo.ts", toRoot: true },
	{ from: "extra/io/to-postgres.ts", to: "base/io/to-postgres.ts", toRoot: true },
	{ from: "extra/io/to-s3.ts", to: "base/io/to-s3.ts", toRoot: true },
	{ from: "extra/io/to-tempo.ts", to: "base/io/to-tempo.ts", toRoot: true },
	{ from: "extra/io/webhook.ts", to: "base/io/webhook.ts", toRoot: true },
	{ from: "extra/io/websocket.ts", to: "base/io/websocket.ts", toRoot: true },
	// reactive-sink → base/io/_sink.ts (Q15)
	{ from: "extra/reactive-sink.ts", to: "base/io/_sink.ts", toRoot: true },

	// -------------------------------------------------------------------------
	// Presentation → base/composition/
	// -------------------------------------------------------------------------
	// Note: composite.ts is handled via SYMBOL_SPLITS (→ verifiable.ts + distill.ts)
	{ from: "extra/composition/observable.ts", to: "base/composition/observable.ts", toRoot: true },
	{ from: "extra/composition/materialize.ts", to: "base/composition/materialize.ts", toRoot: true },
	{
		from: "extra/composition/topology-diff.ts",
		to: "base/composition/topology-diff.ts",
		toRoot: true,
	},
	{ from: "extra/composition/pubsub.ts", to: "base/composition/pubsub.ts", toRoot: true },
	{
		from: "extra/composition/backpressure.ts",
		to: "base/composition/backpressure.ts",
		toRoot: true,
	},
	{
		from: "extra/composition/external-register.ts",
		to: "base/composition/external-register.ts",
		toRoot: true,
	},
	{ from: "extra/single-from-any.ts", to: "base/composition/single-from-any.ts", toRoot: true },

	// -------------------------------------------------------------------------
	// Presentation → base/mutation/
	// -------------------------------------------------------------------------
	{ from: "extra/mutation/index.ts", to: "base/mutation/index.ts", toRoot: true },

	// -------------------------------------------------------------------------
	// Presentation → base/worker/
	// -------------------------------------------------------------------------
	{ from: "extra/worker/bridge.ts", to: "base/worker/bridge.ts", toRoot: true },
	{ from: "extra/worker/index.ts", to: "base/worker/index.ts", toRoot: true },
	{ from: "extra/worker/protocol.ts", to: "base/worker/protocol.ts", toRoot: true },
	{ from: "extra/worker/self.ts", to: "base/worker/self.ts", toRoot: true },
	{ from: "extra/worker/transport.ts", to: "base/worker/transport.ts", toRoot: true },

	// -------------------------------------------------------------------------
	// Presentation → base/render/ (13 files)
	// -------------------------------------------------------------------------
	{ from: "extra/render/_ascii-grid.ts", to: "base/render/_ascii-grid.ts", toRoot: true },
	{ from: "extra/render/_ascii-width.ts", to: "base/render/_ascii-width.ts", toRoot: true },
	{ from: "extra/render/_internal.ts", to: "base/render/_internal.ts", toRoot: true },
	{ from: "extra/render/_layout-sugiyama.ts", to: "base/render/_layout-sugiyama.ts", toRoot: true },
	{
		from: "extra/render/graph-spec-to-ascii.ts",
		to: "base/render/graph-spec-to-ascii.ts",
		toRoot: true,
	},
	{ from: "extra/render/graph-spec-to-d2.ts", to: "base/render/graph-spec-to-d2.ts", toRoot: true },
	{
		from: "extra/render/graph-spec-to-json.ts",
		to: "base/render/graph-spec-to-json.ts",
		toRoot: true,
	},
	{
		from: "extra/render/graph-spec-to-mermaid-url.ts",
		to: "base/render/graph-spec-to-mermaid-url.ts",
		toRoot: true,
	},
	{
		from: "extra/render/graph-spec-to-mermaid.ts",
		to: "base/render/graph-spec-to-mermaid.ts",
		toRoot: true,
	},
	{
		from: "extra/render/graph-spec-to-pretty.ts",
		to: "base/render/graph-spec-to-pretty.ts",
		toRoot: true,
	},
	{ from: "extra/render/index.ts", to: "base/render/index.ts", toRoot: true },
	{
		from: "extra/render/layout-frame-to-svg.ts",
		to: "base/render/layout-frame-to-svg.ts",
		toRoot: true,
	},
	{ from: "extra/render/layout-types.ts", to: "base/render/layout-types.ts", toRoot: true },

	// -------------------------------------------------------------------------
	// Presentation → base/meta/
	// -------------------------------------------------------------------------
	{ from: "extra/meta.ts", to: "base/meta/domain-meta.ts", toRoot: true },
	// patterns/_internal/index.ts → split: emitToMeta + trackingKey (handled in SYMBOL_SPLITS)

	// -------------------------------------------------------------------------
	// Presentation → base/sources/ (settled, async, event splits)
	// -------------------------------------------------------------------------
	// settled.ts → base/sources/settled.ts (all except keepalive) + base/meta/keepalive.ts
	// Note: handled via SYMBOL_SPLITS below
	{ from: "extra/sources/async.ts", to: "base/sources/async.ts", toRoot: true },
	// event.ts → split handled in SYMBOL_SPLITS

	// -------------------------------------------------------------------------
	// Presentation → base/sources/node/ (Q9)
	// -------------------------------------------------------------------------
	{ from: "extra/sources/fs.ts", to: "base/sources/node/fs.ts", toRoot: true },
	{ from: "extra/sources/git.ts", to: "base/sources/node/git.ts", toRoot: true },
	{ from: "extra/sources-fs.ts", to: "base/sources/node/fs-root.ts", toRoot: true },
	{ from: "extra/sources-process.ts", to: "base/sources/node/process.ts", toRoot: true },
	{ from: "extra/git-hook.ts", to: "base/sources/node/git-hook.ts", toRoot: true },

	// -------------------------------------------------------------------------
	// Presentation → base/sources/browser/ (Q23)
	// -------------------------------------------------------------------------
	{ from: "extra/storage-browser.ts", to: "base/sources/browser/idb.ts", toRoot: true },

	// -------------------------------------------------------------------------
	// Presentation → base/utils/
	// -------------------------------------------------------------------------
	{ from: "extra/utils/decay.ts", to: "base/utils/decay.ts", toRoot: true },

	// -------------------------------------------------------------------------
	// Presentation → base/composition (audited-success-tracker from extra/composition/)
	// -------------------------------------------------------------------------
	{
		from: "extra/composition/audited-success-tracker.ts",
		to: "utils/orchestration/audited-success-tracker.ts",
		toRoot: true,
	},

	// -------------------------------------------------------------------------
	// Presentation → utils/messaging/
	// -------------------------------------------------------------------------
	{
		from: "patterns/messaging/audit-records.ts",
		to: "utils/messaging/audit-records.ts",
		toRoot: true,
	},
	{ from: "patterns/messaging/index.ts", to: "utils/messaging/index.ts", toRoot: true },
	{ from: "patterns/messaging/message.ts", to: "utils/messaging/message.ts", toRoot: true },

	// -------------------------------------------------------------------------
	// Presentation → utils/orchestration/
	// -------------------------------------------------------------------------
	{
		from: "patterns/orchestration/human-input.ts",
		to: "utils/orchestration/human-input.ts",
		toRoot: true,
	},
	{ from: "patterns/orchestration/index.ts", to: "utils/orchestration/index.ts", toRoot: true },
	{
		from: "patterns/orchestration/pipeline-graph.ts",
		to: "utils/orchestration/pipeline-graph.ts",
		toRoot: true,
	},
	{ from: "patterns/orchestration/tracker.ts", to: "utils/orchestration/tracker.ts", toRoot: true },

	// -------------------------------------------------------------------------
	// Presentation → utils/cqrs/
	// -------------------------------------------------------------------------
	{ from: "patterns/cqrs/index.ts", to: "utils/cqrs/index.ts", toRoot: true },

	// -------------------------------------------------------------------------
	// Presentation → utils/memory/
	// -------------------------------------------------------------------------
	{ from: "patterns/memory/index.ts", to: "utils/memory/index.ts", toRoot: true },

	// -------------------------------------------------------------------------
	// Presentation → utils/reduction/
	// -------------------------------------------------------------------------
	{ from: "patterns/reduction/index.ts", to: "utils/reduction/index.ts", toRoot: true },

	// -------------------------------------------------------------------------
	// Presentation → utils/inspect/
	// -------------------------------------------------------------------------
	{ from: "patterns/inspect/audit.ts", to: "utils/inspect/audit.ts", toRoot: true },
	{ from: "patterns/inspect/lens.ts", to: "utils/inspect/lens.ts", toRoot: true },
	{ from: "patterns/inspect/index.ts", to: "utils/inspect/index.ts", toRoot: true },

	// -------------------------------------------------------------------------
	// Presentation → utils/process/
	// -------------------------------------------------------------------------
	{ from: "patterns/process/index.ts", to: "utils/process/index.ts", toRoot: true },

	// -------------------------------------------------------------------------
	// Presentation → utils/job-queue/
	// -------------------------------------------------------------------------
	{ from: "patterns/job-queue/index.ts", to: "utils/job-queue/index.ts", toRoot: true },

	// -------------------------------------------------------------------------
	// Presentation → utils/surface/
	// -------------------------------------------------------------------------
	{ from: "patterns/surface/create.ts", to: "utils/surface/create.ts", toRoot: true },
	{ from: "patterns/surface/errors.ts", to: "utils/surface/errors.ts", toRoot: true },
	{ from: "patterns/surface/index.ts", to: "utils/surface/index.ts", toRoot: true },
	{ from: "patterns/surface/reduce.ts", to: "utils/surface/reduce.ts", toRoot: true },
	{ from: "patterns/surface/snapshot.ts", to: "utils/surface/snapshot.ts", toRoot: true },

	// -------------------------------------------------------------------------
	// Presentation → utils/topology-view/
	// -------------------------------------------------------------------------
	{
		from: "patterns/topology-view/_internal.ts",
		to: "utils/topology-view/_internal.ts",
		toRoot: true,
	},
	{ from: "patterns/topology-view/index.ts", to: "utils/topology-view/index.ts", toRoot: true },
	{ from: "patterns/topology-view/types.ts", to: "utils/topology-view/types.ts", toRoot: true },

	// -------------------------------------------------------------------------
	// Presentation → utils/reactive-layout/
	// -------------------------------------------------------------------------
	{ from: "patterns/reactive-layout/index.ts", to: "utils/reactive-layout/index.ts", toRoot: true },
	{
		from: "patterns/reactive-layout/measurement-adapters.ts",
		to: "utils/reactive-layout/measurement-adapters.ts",
		toRoot: true,
	},
	{
		from: "patterns/reactive-layout/reactive-block-layout.ts",
		to: "utils/reactive-layout/reactive-block-layout.ts",
		toRoot: true,
	},
	{
		from: "patterns/reactive-layout/reactive-flow-layout.ts",
		to: "utils/reactive-layout/reactive-flow-layout.ts",
		toRoot: true,
	},
	{
		from: "patterns/reactive-layout/reactive-layout.ts",
		to: "utils/reactive-layout/reactive-layout.ts",
		toRoot: true,
	},

	// -------------------------------------------------------------------------
	// Presentation → utils/graphspec/
	// -------------------------------------------------------------------------
	{ from: "patterns/graphspec/index.ts", to: "utils/graphspec/index.ts", toRoot: true },

	// -------------------------------------------------------------------------
	// Presentation → utils/demo-shell/
	// -------------------------------------------------------------------------
	{ from: "patterns/demo-shell/index.ts", to: "utils/demo-shell/index.ts", toRoot: true },

	// -------------------------------------------------------------------------
	// Presentation → utils/domain-templates/
	// -------------------------------------------------------------------------
	{
		from: "patterns/domain-templates/index.ts",
		to: "utils/domain-templates/index.ts",
		toRoot: true,
	},

	// -------------------------------------------------------------------------
	// Presentation → utils/ai/
	// -------------------------------------------------------------------------
	{ from: "patterns/ai/_internal.ts", to: "utils/ai/_internal.ts", toRoot: true },
	{ from: "patterns/ai/index.ts", to: "utils/ai/index.ts", toRoot: true },
	{ from: "patterns/ai/node.ts", to: "utils/ai/node.ts", toRoot: true },
	{ from: "patterns/ai/browser.ts", to: "utils/ai/browser.ts", toRoot: true },
	// ai/adapters subtree
	{
		from: "patterns/ai/adapters/_internal/content-addressed-cache.ts",
		to: "utils/ai/adapters/_internal/content-addressed-cache.ts",
		toRoot: true,
	},
	{
		from: "patterns/ai/adapters/_internal/wrappers.ts",
		to: "utils/ai/adapters/_internal/wrappers.ts",
		toRoot: true,
	},
	{
		from: "patterns/ai/adapters/core/capabilities.ts",
		to: "utils/ai/adapters/core/capabilities.ts",
		toRoot: true,
	},
	{
		from: "patterns/ai/adapters/core/factory.ts",
		to: "utils/ai/adapters/core/factory.ts",
		toRoot: true,
	},
	{
		from: "patterns/ai/adapters/core/index.ts",
		to: "utils/ai/adapters/core/index.ts",
		toRoot: true,
	},
	{
		from: "patterns/ai/adapters/core/observable.ts",
		to: "utils/ai/adapters/core/observable.ts",
		toRoot: true,
	},
	{
		from: "patterns/ai/adapters/core/pricing.ts",
		to: "utils/ai/adapters/core/pricing.ts",
		toRoot: true,
	},
	{
		from: "patterns/ai/adapters/core/types.ts",
		to: "utils/ai/adapters/core/types.ts",
		toRoot: true,
	},
	{ from: "patterns/ai/adapters/index.ts", to: "utils/ai/adapters/index.ts", toRoot: true },
	{
		from: "patterns/ai/adapters/middleware/breaker.ts",
		to: "utils/ai/adapters/middleware/breaker.ts",
		toRoot: true,
	},
	{
		from: "patterns/ai/adapters/middleware/budget-gate.ts",
		to: "utils/ai/adapters/middleware/budget-gate.ts",
		toRoot: true,
	},
	{
		from: "patterns/ai/adapters/middleware/dry-run.ts",
		to: "utils/ai/adapters/middleware/dry-run.ts",
		toRoot: true,
	},
	{
		from: "patterns/ai/adapters/middleware/http429-parser.ts",
		to: "utils/ai/adapters/middleware/http429-parser.ts",
		toRoot: true,
	},
	{
		from: "patterns/ai/adapters/middleware/index.ts",
		to: "utils/ai/adapters/middleware/index.ts",
		toRoot: true,
	},
	{
		from: "patterns/ai/adapters/middleware/rate-limiter.ts",
		to: "utils/ai/adapters/middleware/rate-limiter.ts",
		toRoot: true,
	},
	{
		from: "patterns/ai/adapters/middleware/replay-cache.ts",
		to: "utils/ai/adapters/middleware/replay-cache.ts",
		toRoot: true,
	},
	{
		from: "patterns/ai/adapters/middleware/resilient-adapter.ts",
		to: "utils/ai/adapters/middleware/resilient-adapter.ts",
		toRoot: true,
	},
	{
		from: "patterns/ai/adapters/middleware/retry.ts",
		to: "utils/ai/adapters/middleware/retry.ts",
		toRoot: true,
	},
	{
		from: "patterns/ai/adapters/middleware/timeout.ts",
		to: "utils/ai/adapters/middleware/timeout.ts",
		toRoot: true,
	},
	{
		from: "patterns/ai/adapters/providers/anthropic.ts",
		to: "utils/ai/adapters/providers/anthropic.ts",
		toRoot: true,
	},
	{
		from: "patterns/ai/adapters/providers/browser/chrome-nano.ts",
		to: "utils/ai/adapters/providers/browser/chrome-nano.ts",
		toRoot: true,
	},
	{
		from: "patterns/ai/adapters/providers/browser/index.ts",
		to: "utils/ai/adapters/providers/browser/index.ts",
		toRoot: true,
	},
	{
		from: "patterns/ai/adapters/providers/browser/webllm.ts",
		to: "utils/ai/adapters/providers/browser/webllm.ts",
		toRoot: true,
	},
	{
		from: "patterns/ai/adapters/providers/dry-run.ts",
		to: "utils/ai/adapters/providers/dry-run.ts",
		toRoot: true,
	},
	{
		from: "patterns/ai/adapters/providers/fallback-node.ts",
		to: "utils/ai/adapters/providers/fallback-node.ts",
		toRoot: true,
	},
	{
		from: "patterns/ai/adapters/providers/fallback.ts",
		to: "utils/ai/adapters/providers/fallback.ts",
		toRoot: true,
	},
	{
		from: "patterns/ai/adapters/providers/google.ts",
		to: "utils/ai/adapters/providers/google.ts",
		toRoot: true,
	},
	{
		from: "patterns/ai/adapters/providers/index.ts",
		to: "utils/ai/adapters/providers/index.ts",
		toRoot: true,
	},
	{
		from: "patterns/ai/adapters/providers/openai-compat.ts",
		to: "utils/ai/adapters/providers/openai-compat.ts",
		toRoot: true,
	},
	{
		from: "patterns/ai/adapters/routing/browser-presets.ts",
		to: "utils/ai/adapters/routing/browser-presets.ts",
		toRoot: true,
	},
	{
		from: "patterns/ai/adapters/routing/cascading.ts",
		to: "utils/ai/adapters/routing/cascading.ts",
		toRoot: true,
	},
	{
		from: "patterns/ai/adapters/routing/index.ts",
		to: "utils/ai/adapters/routing/index.ts",
		toRoot: true,
	},
	// ai/agents subtree (agents/presets.ts → presets/ai/agents.ts)
	{ from: "patterns/ai/agents/agent.ts", to: "utils/ai/agents/agent.ts", toRoot: true },
	{ from: "patterns/ai/agents/chat-stream.ts", to: "utils/ai/agents/chat-stream.ts", toRoot: true },
	{ from: "patterns/ai/agents/handoff.ts", to: "utils/ai/agents/handoff.ts", toRoot: true },
	{
		from: "patterns/ai/agents/tool-execution.ts",
		to: "utils/ai/agents/tool-execution.ts",
		toRoot: true,
	},
	{
		from: "patterns/ai/agents/tool-registry.ts",
		to: "utils/ai/agents/tool-registry.ts",
		toRoot: true,
	},
	{
		from: "patterns/ai/agents/tool-selector.ts",
		to: "utils/ai/agents/tool-selector.ts",
		toRoot: true,
	},
	// agents/presets.ts → presets/ (handled separately)
	{
		from: "patterns/ai/extractors/cost-meter.ts",
		to: "utils/ai/extractors/cost-meter.ts",
		toRoot: true,
	},
	{
		from: "patterns/ai/extractors/keyword-flag.ts",
		to: "utils/ai/extractors/keyword-flag.ts",
		toRoot: true,
	},
	{
		from: "patterns/ai/extractors/stream-extractor.ts",
		to: "utils/ai/extractors/stream-extractor.ts",
		toRoot: true,
	},
	{
		from: "patterns/ai/extractors/tool-call.ts",
		to: "utils/ai/extractors/tool-call.ts",
		toRoot: true,
	},
	{
		from: "patterns/ai/graph-integration/gauges-as-context.ts",
		to: "utils/ai/graph-integration/gauges-as-context.ts",
		toRoot: true,
	},
	{
		from: "patterns/ai/graph-integration/graph-from-spec.ts",
		to: "utils/ai/graph-integration/graph-from-spec.ts",
		toRoot: true,
	},
	{
		from: "patterns/ai/graph-integration/knobs-as-tools.ts",
		to: "utils/ai/graph-integration/knobs-as-tools.ts",
		toRoot: true,
	},
	{
		from: "patterns/ai/graph-integration/suggest-strategy.ts",
		to: "utils/ai/graph-integration/suggest-strategy.ts",
		toRoot: true,
	},
	{
		from: "patterns/ai/graph-integration/validate-graph-def.ts",
		to: "utils/ai/graph-integration/validate-graph-def.ts",
		toRoot: true,
	},
	{ from: "patterns/ai/memory/admission.ts", to: "utils/ai/memory/admission.ts", toRoot: true },
	{
		from: "patterns/ai/memory/memory-composers.ts",
		to: "utils/ai/memory/memory-composers.ts",
		toRoot: true,
	},
	{ from: "patterns/ai/memory/retrieval.ts", to: "utils/ai/memory/retrieval.ts", toRoot: true },
	{ from: "patterns/ai/memory/tiers.ts", to: "utils/ai/memory/tiers.ts", toRoot: true },
	{
		from: "patterns/ai/prompts/frozen-context.ts",
		to: "utils/ai/prompts/frozen-context.ts",
		toRoot: true,
	},
	{
		from: "patterns/ai/prompts/prompt-call.ts",
		to: "utils/ai/prompts/prompt-call.ts",
		toRoot: true,
	},
	{
		from: "patterns/ai/prompts/prompt-node.ts",
		to: "utils/ai/prompts/prompt-node.ts",
		toRoot: true,
	},
	{ from: "patterns/ai/prompts/streaming.ts", to: "utils/ai/prompts/streaming.ts", toRoot: true },
	{
		from: "patterns/ai/prompts/system-prompt.ts",
		to: "utils/ai/prompts/system-prompt.ts",
		toRoot: true,
	},
	{
		from: "patterns/ai/safety/content-gate.ts",
		to: "utils/ai/safety/content-gate.ts",
		toRoot: true,
	},
	{ from: "patterns/ai/safety/redactor.ts", to: "utils/ai/safety/redactor.ts", toRoot: true },

	// -------------------------------------------------------------------------
	// Presentation → utils/harness/
	// -------------------------------------------------------------------------
	{
		from: "patterns/harness/actuator-executor.ts",
		to: "utils/harness/actuator-executor.ts",
		toRoot: true,
	},
	{ from: "patterns/harness/auto-solidify.ts", to: "utils/harness/auto-solidify.ts", toRoot: true },
	{ from: "patterns/harness/bridge.ts", to: "utils/harness/bridge.ts", toRoot: true },
	{ from: "patterns/harness/defaults.ts", to: "utils/harness/defaults.ts", toRoot: true },
	{ from: "patterns/harness/eval-verifier.ts", to: "utils/harness/eval-verifier.ts", toRoot: true },
	{ from: "patterns/harness/index.ts", to: "utils/harness/index.ts", toRoot: true },
	{ from: "patterns/harness/profile.ts", to: "utils/harness/profile.ts", toRoot: true },
	{
		from: "patterns/harness/refine-executor.ts",
		to: "utils/harness/refine-executor.ts",
		toRoot: true,
	},
	{ from: "patterns/harness/strategy.ts", to: "utils/harness/strategy.ts", toRoot: true },
	{ from: "patterns/harness/trace.ts", to: "utils/harness/trace.ts", toRoot: true },
	{ from: "patterns/harness/types.ts", to: "utils/harness/types.ts", toRoot: true },

	// -------------------------------------------------------------------------
	// Presentation → utils/resilience/ (all except resilient-pipeline)
	// -------------------------------------------------------------------------
	{ from: "extra/resilience/_internal.ts", to: "utils/resilience/_internal.ts", toRoot: true },
	{ from: "extra/resilience/backoff.ts", to: "utils/resilience/backoff.ts", toRoot: true },
	{ from: "extra/resilience/breaker.ts", to: "utils/resilience/breaker.ts", toRoot: true },
	{ from: "extra/resilience/budget-gate.ts", to: "utils/resilience/budget-gate.ts", toRoot: true },
	{ from: "extra/resilience/fallback.ts", to: "utils/resilience/fallback.ts", toRoot: true },
	{ from: "extra/resilience/gate-state.ts", to: "utils/resilience/gate-state.ts", toRoot: true },
	{ from: "extra/resilience/index.ts", to: "utils/resilience/index.ts", toRoot: true },
	{
		from: "extra/resilience/rate-limiter.ts",
		to: "utils/resilience/rate-limiter.ts",
		toRoot: true,
	},
	{ from: "extra/resilience/retry.ts", to: "utils/resilience/retry.ts", toRoot: true },
	{ from: "extra/resilience/status.ts", to: "utils/resilience/status.ts", toRoot: true },
	{ from: "extra/resilience/timeout.ts", to: "utils/resilience/timeout.ts", toRoot: true },
	{
		from: "extra/adaptive-rate-limiter.ts",
		to: "utils/resilience/adaptive-rate-limiter.ts",
		toRoot: true,
	},

	// -------------------------------------------------------------------------
	// Presentation → utils/_errors/
	// -------------------------------------------------------------------------
	{ from: "patterns/_internal/errors.ts", to: "utils/_errors/index.ts", toRoot: true },

	// -------------------------------------------------------------------------
	// Presentation → presets/ai/
	// -------------------------------------------------------------------------
	{ from: "patterns/ai/presets/agent-loop.ts", to: "presets/ai/agent-loop.ts", toRoot: true },
	{ from: "patterns/ai/presets/agent-memory.ts", to: "presets/ai/agent-memory.ts", toRoot: true },
	{ from: "patterns/ai/agents/presets.ts", to: "presets/ai/agents.ts", toRoot: true },

	// -------------------------------------------------------------------------
	// Presentation → presets/harness/
	// -------------------------------------------------------------------------
	{
		from: "patterns/harness/presets/harness-loop.ts",
		to: "presets/harness/harness-loop.ts",
		toRoot: true,
	},
	{
		from: "patterns/harness/presets/refine-loop.ts",
		to: "presets/harness/refine-loop.ts",
		toRoot: true,
	},
	{
		from: "patterns/harness/presets/spawnable.ts",
		to: "presets/harness/spawnable.ts",
		toRoot: true,
	},

	// -------------------------------------------------------------------------
	// Presentation → presets/inspect/
	// -------------------------------------------------------------------------
	{
		from: "patterns/inspect/guarded-execution.ts",
		to: "presets/inspect/guarded-execution.ts",
		toRoot: true,
	},
	{ from: "patterns/inspect/presets/inspect.ts", to: "presets/inspect/composite.ts", toRoot: true },

	// -------------------------------------------------------------------------
	// Presentation → presets/resilience/
	// -------------------------------------------------------------------------
	{
		from: "extra/resilience/resilient-pipeline.ts",
		to: "presets/resilience/resilient-pipeline.ts",
		toRoot: true,
	},

	// -------------------------------------------------------------------------
	// Presentation → compat/ (path unchanged, just moves to root src/)
	// -------------------------------------------------------------------------
	{ from: "compat/index.ts", to: "compat/index.ts", toRoot: true },
	{ from: "compat/jotai/index.ts", to: "compat/jotai/index.ts", toRoot: true },
	{ from: "compat/nanostores/index.ts", to: "compat/nanostores/index.ts", toRoot: true },
	{ from: "compat/nestjs/decorators.ts", to: "compat/nestjs/decorators.ts", toRoot: true },
	{ from: "compat/nestjs/explorer.ts", to: "compat/nestjs/explorer.ts", toRoot: true },
	{ from: "compat/nestjs/gateway.ts", to: "compat/nestjs/gateway.ts", toRoot: true },
	{ from: "compat/nestjs/guard.ts", to: "compat/nestjs/guard.ts", toRoot: true },
	{ from: "compat/nestjs/index.ts", to: "compat/nestjs/index.ts", toRoot: true },
	{ from: "compat/nestjs/module.ts", to: "compat/nestjs/module.ts", toRoot: true },
	{ from: "compat/nestjs/tokens.ts", to: "compat/nestjs/tokens.ts", toRoot: true },
	{ from: "compat/react/index.ts", to: "compat/react/index.ts", toRoot: true },
	{ from: "compat/signals/index.ts", to: "compat/signals/index.ts", toRoot: true },
	{ from: "compat/solid/index.ts", to: "compat/solid/index.ts", toRoot: true },
	{ from: "compat/svelte/index.ts", to: "compat/svelte/index.ts", toRoot: true },
	{ from: "compat/vue/index.ts", to: "compat/vue/index.ts", toRoot: true },
	{ from: "compat/zustand/index.ts", to: "compat/zustand/index.ts", toRoot: true },
];

// ---------------------------------------------------------------------------
// SYMBOL SPLITS
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// DELETIONS (25 backward-compat shims; extra/storage.ts absent from disk)
// ---------------------------------------------------------------------------
const DELETE_FILES: string[] = [
	"extra/adapters.ts",
	"extra/backoff.ts",
	"extra/backpressure.ts",
	"extra/cascading-cache.ts",
	"extra/composite.ts",
	"extra/content-addressed-storage.ts",
	"extra/external-register.ts",
	"extra/http-error.ts",
	"extra/observable.ts",
	"extra/operators.ts",
	"extra/pubsub.ts",
	"extra/reactive-index.ts",
	"extra/reactive-list.ts",
	"extra/reactive-log.ts",
	"extra/reactive-map.ts",
	"extra/reactive.ts",
	"extra/resilience.ts",
	"extra/sources.ts",
	// "extra/storage.ts", // ABSENT from disk — skip
	"extra/storage-core.ts",
	"extra/storage-node.ts",
	"extra/storage-tiers.ts",
	"extra/storage-tiers-node.ts",
	"extra/storage-tiers-browser.ts",
	"extra/storage-wal.ts",
	"extra/stratify.ts",
];

// ---------------------------------------------------------------------------
// TEST MOVES TABLE (Option B: presentation tests → root src/__tests__/)
// ---------------------------------------------------------------------------
// Each entry: [oldRelpath, newRelpath] relative to PURE_TS_TESTS / ROOT_TESTS
// Substrate tests stay in pure-ts; presentation tests move to root.

type TestMove = {
	from: string; // relative to PURE_TS_TESTS
	to: string; // relative to ROOT_TESTS
};

const TEST_MOVES: TestMove[] = [
	// compat/* → compat/*
	{ from: "compat/jotai.test.ts", to: "compat/jotai.test.ts" },
	{ from: "compat/nanostores.test.ts", to: "compat/nanostores.test.ts" },
	{ from: "compat/nestjs.test.ts", to: "compat/nestjs.test.ts" },
	{ from: "compat/react.test.ts", to: "compat/react.test.ts" },
	{ from: "compat/signals-autotrack.test.ts", to: "compat/signals-autotrack.test.ts" },
	{ from: "compat/signals.test.ts", to: "compat/signals.test.ts" },
	{ from: "compat/solid.test.ts", to: "compat/solid.test.ts" },
	{ from: "compat/svelte.test.ts", to: "compat/svelte.test.ts" },
	{ from: "compat/vue.test.ts", to: "compat/vue.test.ts" },
	{ from: "compat/zustand.test.ts", to: "compat/zustand.test.ts" },

	// patterns/* → mirror
	{ from: "patterns/actuator-executor.test.ts", to: "utils/harness/actuator-executor.test.ts" },
	{ from: "patterns/ai.test.ts", to: "utils/ai/ai.test.ts" },
	{
		from: "patterns/ai/adapters/abort-propagation.test.ts",
		to: "utils/ai/adapters/abort-propagation.test.ts",
	},
	{
		from: "patterns/ai/adapters/adaptive-rate-limiter.test.ts",
		to: "utils/ai/adapters/adaptive-rate-limiter.test.ts",
	},
	{
		from: "patterns/ai/adapters/anthropic-mapping.test.ts",
		to: "utils/ai/adapters/anthropic-mapping.test.ts",
	},
	{
		from: "patterns/ai/adapters/capabilities.test.ts",
		to: "utils/ai/adapters/capabilities.test.ts",
	},
	{ from: "patterns/ai/adapters/cascading.test.ts", to: "utils/ai/adapters/cascading.test.ts" },
	{ from: "patterns/ai/adapters/dry-run.test.ts", to: "utils/ai/adapters/dry-run.test.ts" },
	{ from: "patterns/ai/adapters/fallback.test.ts", to: "utils/ai/adapters/fallback.test.ts" },
	{
		from: "patterns/ai/adapters/google-mapping.test.ts",
		to: "utils/ai/adapters/google-mapping.test.ts",
	},
	{
		from: "patterns/ai/adapters/http429-parser.test.ts",
		to: "utils/ai/adapters/http429-parser.test.ts",
	},
	{ from: "patterns/ai/adapters/middleware.test.ts", to: "utils/ai/adapters/middleware.test.ts" },
	{ from: "patterns/ai/adapters/observable.test.ts", to: "utils/ai/adapters/observable.test.ts" },
	{
		from: "patterns/ai/adapters/openai-compat-mapping.test.ts",
		to: "utils/ai/adapters/openai-compat-mapping.test.ts",
	},
	{ from: "patterns/ai/adapters/pricing.test.ts", to: "utils/ai/adapters/pricing.test.ts" },
	{
		from: "patterns/ai/adapters/qa-regressions.test.ts",
		to: "utils/ai/adapters/qa-regressions.test.ts",
	},
	{
		from: "patterns/ai/adapters/resilient-adapter.test.ts",
		to: "utils/ai/adapters/resilient-adapter.test.ts",
	},
	{ from: "patterns/ai/adapters/types.test.ts", to: "utils/ai/adapters/types.test.ts" },
	{ from: "patterns/ai/agents/agent.test.ts", to: "utils/ai/agents/agent.test.ts" },
	{
		from: "patterns/ai/agents/multi-agent-example.test.ts",
		to: "utils/ai/agents/multi-agent-example.test.ts",
	},
	{
		from: "patterns/ai/agents/tool-execution.test.ts",
		to: "utils/ai/agents/tool-execution.test.ts",
	},
	{ from: "patterns/audit.test.ts", to: "utils/inspect/audit.test.ts" },
	{ from: "patterns/auto-solidify.test.ts", to: "utils/harness/auto-solidify.test.ts" },
	{ from: "patterns/cqrs.test.ts", to: "utils/cqrs/cqrs.test.ts" },
	{ from: "patterns/demo-shell.test.ts", to: "utils/demo-shell/demo-shell.test.ts" },
	{
		from: "patterns/domain-templates.test.ts",
		to: "utils/domain-templates/domain-templates.test.ts",
	},
	{ from: "patterns/graphspec.test.ts", to: "utils/graphspec/graphspec.test.ts" },
	{ from: "patterns/guarded-execution.test.ts", to: "presets/inspect/guarded-execution.test.ts" },
	{
		from: "patterns/harness-default-bridges.test.ts",
		to: "utils/harness/harness-default-bridges.test.ts",
	},
	{ from: "patterns/harness.test.ts", to: "utils/harness/harness.test.ts" },
	{ from: "patterns/harness/spawnable.test.ts", to: "presets/harness/spawnable.test.ts" },
	{ from: "patterns/inspect-preset.test.ts", to: "presets/inspect/inspect-preset.test.ts" },
	{ from: "patterns/lens.test.ts", to: "utils/inspect/lens.test.ts" },
	{ from: "patterns/memory.test.ts", to: "utils/memory/memory.test.ts" },
	{ from: "patterns/messaging.test.ts", to: "utils/messaging/messaging.test.ts" },
	{ from: "patterns/orchestration.test.ts", to: "utils/orchestration/orchestration.test.ts" },
	{
		from: "patterns/orchestration/human-input-tracker.test.ts",
		to: "utils/orchestration/human-input-tracker.test.ts",
	},
	{ from: "patterns/process.test.ts", to: "utils/process/process.test.ts" },
	{
		from: "patterns/reactive-layout/measurement-adapters.test.ts",
		to: "utils/reactive-layout/measurement-adapters.test.ts",
	},
	{
		from: "patterns/reactive-layout/reactive-block-layout.test.ts",
		to: "utils/reactive-layout/reactive-block-layout.test.ts",
	},
	{
		from: "patterns/reactive-layout/reactive-flow-layout.test.ts",
		to: "utils/reactive-layout/reactive-flow-layout.test.ts",
	},
	{
		from: "patterns/reactive-layout/reactive-layout.test.ts",
		to: "utils/reactive-layout/reactive-layout.test.ts",
	},
	{ from: "patterns/reduction.test.ts", to: "utils/reduction/reduction.test.ts" },
	{ from: "patterns/refine-executor.test.ts", to: "utils/harness/refine-executor.test.ts" },
	{ from: "patterns/refine-loop.test.ts", to: "presets/harness/refine-loop.test.ts" },
	{
		from: "patterns/resilient-pipeline.test.ts",
		to: "presets/resilience/resilient-pipeline.test.ts",
	},
	{ from: "patterns/surface/surface.test.ts", to: "utils/surface/surface.test.ts" },
	{ from: "patterns/topology-view.test.ts", to: "utils/topology-view/topology-view.test.ts" },

	// extra presentation tests → base/ or utils/
	{ from: "extra/adapters.ingest.test.ts", to: "utils/ai/adapters/adapters.ingest.test.ts" },
	{ from: "extra/adapters.storage.test.ts", to: "utils/ai/adapters/adapters.storage.test.ts" },
	{ from: "extra/backpressure.test.ts", to: "base/composition/backpressure.test.ts" },
	{ from: "extra/cascading-cache.test.ts", to: "utils/ai/adapters/cascading-cache.test.ts" },
	{ from: "extra/composite.test.ts", to: "base/composition/composite.test.ts" },
	{ from: "extra/external-register.test.ts", to: "base/composition/external-register.test.ts" },
	{ from: "extra/materialize.test.ts", to: "base/composition/materialize.test.ts" },
	{ from: "extra/mutation/mutation.test.ts", to: "base/mutation/mutation.test.ts" },
	{ from: "extra/pubsub-stress.test.ts", to: "base/composition/pubsub-stress.test.ts" },
	{ from: "extra/reactive-sink.test.ts", to: "base/io/reactive-sink.test.ts" },
	{ from: "extra/resilience.test.ts", to: "utils/resilience/resilience.test.ts" },
	{ from: "extra/single-from-any.test.ts", to: "base/composition/single-from-any.test.ts" },
	{ from: "extra/sources-process.test.ts", to: "base/sources/node/sources-process.test.ts" },
	{ from: "extra/sources.http.test.ts", to: "base/io/sources.http.test.ts" },
	{ from: "extra/sources.test.ts", to: "base/sources/sources.test.ts" },
	{
		from: "extra/token-bucket-putback.test.ts",
		to: "utils/resilience/token-bucket-putback.test.ts",
	},
	{ from: "extra/worker.test.ts", to: "base/worker/worker.test.ts" },

	// graphspec tests → utils/graphspec/
	{
		from: "graphspec/factory-tags-audit.test.ts",
		to: "utils/graphspec/factory-tags-audit.test.ts",
	},
	{
		from: "graphspec/factory-tags-bundles.test.ts",
		to: "utils/graphspec/factory-tags-bundles.test.ts",
	},
	{
		from: "graphspec/factory-tags-memory-harness.test.ts",
		to: "utils/graphspec/factory-tags-memory-harness.test.ts",
	},
	{
		from: "graphspec/factory-tags-orchestration.test.ts",
		to: "utils/graphspec/factory-tags-orchestration.test.ts",
	},
	{ from: "graphspec/spec-roundtrip.test.ts", to: "utils/graphspec/spec-roundtrip.test.ts" },

	// evals tests → utils/harness/evals/
	{
		from: "evals/catalog-aware-evaluator.test.ts",
		to: "utils/harness/evals/catalog-aware-evaluator.test.ts",
	},
	{ from: "evals/catalog-overlay.test.ts", to: "utils/harness/evals/catalog-overlay.test.ts" },
	{
		from: "evals/contrastive-resume.test.ts",
		to: "utils/harness/evals/contrastive-resume.test.ts",
	},
	{ from: "evals/cost-safety.test.ts", to: "utils/harness/evals/cost-safety.test.ts" },
	{ from: "evals/merge-runs.test.ts", to: "utils/harness/evals/merge-runs.test.ts" },
	{ from: "evals/portable-catalog.test.ts", to: "utils/harness/evals/portable-catalog.test.ts" },
	{
		from: "evals/prompt-template-validity.test.ts",
		to: "utils/harness/evals/prompt-template-validity.test.ts",
	},
	{
		from: "evals/rate-limit-cache-order.test.ts",
		to: "utils/harness/evals/rate-limit-cache-order.test.ts",
	},

	// top-level presentation tests
	{ from: "adapter-contract.test.ts", to: "utils/ai/adapter-contract.test.ts" },
	{ from: "phase5-llm-composition.test.ts", to: "utils/ai/phase5-llm-composition.test.ts" },

	// helpers (presentation)
	{ from: "helpers/mock-llm.ts", to: "helpers/mock-llm.ts" },
];

// ---------------------------------------------------------------------------
// File system utilities
// ---------------------------------------------------------------------------

async function walk(dir: string): Promise<string[]> {
	if (!existsSync(dir)) return [];
	const out: string[] = [];
	const entries = await readdir(dir, { withFileTypes: true });
	for (const e of entries) {
		const p = join(dir, e.name);
		if (e.name === "node_modules" || e.name === "dist") continue;
		if (e.isDirectory()) out.push(...(await walk(p)));
		else if (/\.(ts|tsx|mts|cts)$/.test(e.name) && !e.name.endsWith(".d.ts")) {
			out.push(p);
		}
	}
	return out;
}

async function ensureDir(p: string): Promise<void> {
	await mkdir(dirname(p), { recursive: true });
}

// ---------------------------------------------------------------------------
// Build the move lookup: srcAbs → dstAbs
// ---------------------------------------------------------------------------

function buildMoveLookup(): Map<string, string> {
	const lookup = new Map<string, string>();
	for (const m of MOVES) {
		const srcAbs = join(PURE_TS_SRC, m.from);
		const dstAbs = m.toRoot ? join(ROOT_SRC, m.to) : join(PURE_TS_SRC, m.to);
		lookup.set(srcAbs, dstAbs);
	}
	return lookup;
}

// ---------------------------------------------------------------------------
// Import path resolver
// ---------------------------------------------------------------------------

function resolveImport(fromFile: string, spec: string): string | null {
	if (!spec.startsWith(".")) return null;
	const fromDir = dirname(fromFile);
	// Strip .js extension — TypeScript ESM projects use .js in imports but .ts on disk
	const specNoJs = spec.replace(/\.js$/, "");
	const resolved = resolve(fromDir, specNoJs);
	if (existsSync(resolved + ".ts")) return resolved + ".ts";
	if (existsSync(join(resolved, "index.ts"))) return join(resolved, "index.ts");
	// Also try the original (non-stripped) path
	const resolvedOrig = resolve(fromDir, spec);
	if (existsSync(resolvedOrig + ".ts")) return resolvedOrig + ".ts";
	if (existsSync(join(resolvedOrig, "index.ts"))) return join(resolvedOrig, "index.ts");
	if (existsSync(resolved) && statSync(resolved).isFile()) return resolved;
	return null;
}

// ---------------------------------------------------------------------------
// Import rewriter
// ---------------------------------------------------------------------------

let totalFilesModified = 0;
const unresolvableImports: Array<{ file: string; spec: string }> = [];

async function rewriteImports(absFile: string, moveLookup: Map<string, string>): Promise<boolean> {
	const src = await readFile(absFile, "utf8");

	const importRe = /^((?:import|export)[^"'`\n]*from\s+)(["'])([^"'`]+)\2/gm;

	let changed = false;
	let result = src;

	const matches: Array<{
		full: string;
		prefix: string;
		quote: string;
		spec: string;
		index: number;
	}> = [];
	importRe.lastIndex = 0;
	for (let m = importRe.exec(src); m !== null; m = importRe.exec(src)) {
		matches.push({ full: m[0], prefix: m[1], quote: m[2], spec: m[3], index: m.index });
	}

	const edits: Array<{ from: number; to: number; replacement: string }> = [];

	for (const match of matches) {
		const spec = match.spec;
		if (!spec.startsWith(".")) continue;

		const resolvedAbs = resolveImport(absFile, spec);
		if (!resolvedAbs) {
			if (spec.startsWith("./") || spec.startsWith("../")) {
				unresolvableImports.push({ file: absFile, spec });
			}
			continue;
		}

		const newAbs = moveLookup.get(resolvedAbs);
		if (!newAbs) continue;

		// The importing file might also be moving
		const importerNewAbs = moveLookup.get(absFile) ?? absFile;

		const newRelRaw = relative(dirname(importerNewAbs), newAbs);
		const newRel = newRelRaw.startsWith(".") ? newRelRaw : "./" + newRelRaw;
		// newAbs has .ts extension; convert to .js for the import specifier (ESM convention)
		// The project uses .js extensions in imports (TypeScript ESM convention)
		const newSpecFinal = newRel.replace(/\.ts$/, ".js");

		if (newSpecFinal !== spec) {
			const newFull = match.prefix + match.quote + newSpecFinal + match.quote;
			edits.push({ from: match.index, to: match.index + match.full.length, replacement: newFull });
			changed = true;
		}
	}

	if (edits.length > 0) {
		edits.sort((a, b) => b.from - a.from);
		for (const edit of edits) {
			result = result.slice(0, edit.from) + edit.replacement + result.slice(edit.to);
		}
	}

	if (changed) {
		if (!DRY) {
			await writeFile(absFile, result, "utf8");
		}
		totalFilesModified++;
	}

	return changed;
}

// ---------------------------------------------------------------------------
// Phase 0: Symbol splits + _internal split
// ---------------------------------------------------------------------------

async function executeSplits(moveLookup: Map<string, string>): Promise<void> {
	console.log("\n[Phase 0] Symbol splits...");

	// Split composite.ts → verifiable.ts + distill.ts
	const compositeSrc = join(PURE_TS_SRC, "extra/composition/composite.ts");
	if (!existsSync(compositeSrc)) {
		console.log("  SKIP: extra/composition/composite.ts not found");
	} else {
		const compositeContent = await readFile(compositeSrc, "utf8");
		const extractionIdx = compositeContent.indexOf("export type Extraction<TMem>");
		if (extractionIdx === -1) {
			console.log("  ERROR: Could not find split point in composite.ts");
		} else {
			let verifiablePart = compositeContent.slice(0, extractionIdx);
			let distillPart = compositeContent.slice(extractionIdx);

			// distill imports from substrate
			const distillImports = `import { batch } from "@graphrefly/pure-ts/core";
import { DATA } from "@graphrefly/pure-ts/core";
import { factoryTag } from "@graphrefly/pure-ts/core";
import { type Node, type NodeOptions, node } from "@graphrefly/pure-ts/core";
import {
\ttype ReactiveMapBundle,
\ttype ReactiveMapOptions,
\treactiveMap,
} from "@graphrefly/pure-ts/extra";
import { switchMap, withLatestFrom } from "@graphrefly/pure-ts/extra";
import { forEach, fromAny } from "@graphrefly/pure-ts/extra";

`;
			distillPart =
				`/**
 * Budget-constrained reactive memory composition (roadmap §3.2b).
 *
 * Moved to base/composition/distill.ts during cleave A2.
 */

` +
				distillImports +
				distillPart;

			verifiablePart =
				`/**
 * Verifiable composition pattern (roadmap §3.2b).
 *
 * Moved to base/composition/verifiable.ts during cleave A2.
 */

` + verifiablePart;

			const verifiableDst = join(ROOT_SRC, "base/composition/verifiable.ts");
			const distillDst = join(ROOT_SRC, "base/composition/distill.ts");

			if (!DRY) {
				await ensureDir(verifiableDst);
				await writeFile(verifiableDst, verifiablePart);
				await ensureDir(distillDst);
				await writeFile(distillDst, distillPart);
				console.log(`  SPLIT composite.ts → verifiable.ts + distill.ts`);
			} else {
				console.log(`  [DRY] SPLIT composite.ts → verifiable.ts + distill.ts`);
			}
			// Register the split destinations in moveLookup so import rewriter can find them
			moveLookup.set(compositeSrc, join(ROOT_SRC, "base/composition/verifiable.ts")); // primary
		}
	}

	// Split event.ts → event/timer.ts (substrate) + base/sources/event/cron.ts + base/sources/event/dom.ts
	const eventSrc = join(PURE_TS_SRC, "extra/sources/event.ts");
	if (existsSync(eventSrc)) {
		const eventContent = await readFile(eventSrc, "utf8");
		const rafIdx = eventContent.indexOf("export function fromRaf");
		const cronIdx = eventContent.indexOf("export function fromCron");
		const fromEventIdx = eventContent.indexOf("export function fromEvent");

		if (rafIdx === -1 || cronIdx === -1) {
			console.log("  ERROR: Could not find split points in event.ts");
		} else {
			const firstSplit = Math.min(
				rafIdx !== -1 ? rafIdx : Infinity,
				cronIdx !== -1 ? cronIdx : Infinity,
				fromEventIdx !== -1 ? fromEventIdx : Infinity,
			);

			const timerContent = eventContent.slice(0, firstSplit);
			const timerDst = join(PURE_TS_SRC, "extra/sources/event/timer.ts");
			if (!DRY) {
				await ensureDir(timerDst);
				await writeFile(
					timerDst,
					`/**
 * Timer-based reactive source (substrate — stays in pure-ts).
 *
 * Moved to extra/sources/event/timer.ts during cleave A2.
 */

` + timerContent,
				);
				console.log(`  SPLIT event.ts → event/timer.ts`);
			} else {
				console.log(`  [DRY] SPLIT event.ts → event/timer.ts`);
			}

			// cron.ts: fromCron + extra/cron.ts content
			const cronSrc = join(PURE_TS_SRC, "extra/cron.ts");
			let cronContent = "";
			if (existsSync(cronSrc)) {
				cronContent = await readFile(cronSrc, "utf8");
			}
			const fromCronEnd = fromEventIdx !== -1 ? fromEventIdx : eventContent.length;
			const fromCronSection = cronIdx !== -1 ? eventContent.slice(cronIdx, fromCronEnd) : "";
			const cronDst = join(ROOT_SRC, "base/sources/event/cron.ts");
			if (!DRY) {
				await ensureDir(cronDst);
				await writeFile(
					cronDst,
					`/**
 * Cron-based reactive sources and schedule types.
 *
 * Merged from extra/cron.ts + extra/sources/event.ts (fromCron) during cleave A2.
 */

` +
						cronContent +
						"\n\n// fromCron extracted from extra/sources/event.ts\n" +
						fromCronSection,
				);
				console.log(`  SPLIT event.ts (fromCron) + cron.ts → base/sources/event/cron.ts`);
			} else {
				console.log(`  [DRY] SPLIT event.ts (fromCron) + cron.ts → base/sources/event/cron.ts`);
			}

			// dom.ts: fromEvent + fromRaf
			const domStartIdx = Math.min(
				rafIdx !== -1 ? rafIdx : Infinity,
				fromEventIdx !== -1 ? fromEventIdx : Infinity,
			);
			const domContent = domStartIdx < eventContent.length ? eventContent.slice(domStartIdx) : "";
			const domDst = join(ROOT_SRC, "base/sources/event/dom.ts");
			if (!DRY) {
				await ensureDir(domDst);
				await writeFile(
					domDst,
					`/**
 * DOM-based reactive event sources (browser-layer).
 *
 * Moved from extra/sources/event.ts (fromEvent, fromRaf) during cleave A2.
 */

` + domContent,
				);
				console.log(`  SPLIT event.ts (fromEvent/fromRaf) → base/sources/event/dom.ts`);
			} else {
				console.log(`  [DRY] SPLIT event.ts (fromEvent/fromRaf) → base/sources/event/dom.ts`);
			}
		}
	}

	// Split settled.ts → base/sources/settled.ts + base/meta/keepalive.ts
	const settledSrc = join(PURE_TS_SRC, "extra/sources/settled.ts");
	if (existsSync(settledSrc)) {
		const settledContent = await readFile(settledSrc, "utf8");
		const keepaliveIdx = settledContent.indexOf(
			"// ---------------------------------------------------------------------------\n// keepalive",
		);
		const reactiveCounterIdx = settledContent.indexOf(
			"// ---------------------------------------------------------------------------\n// reactiveCounter",
		);

		if (keepaliveIdx === -1) {
			console.log("  ERROR: Could not find keepalive section in settled.ts");
		} else {
			const settledPart = settledContent.slice(0, keepaliveIdx);
			const settledWithCounter =
				settledPart +
				"\n" +
				settledContent.slice(
					reactiveCounterIdx !== -1 ? reactiveCounterIdx : settledContent.length,
				);
			const keepaliveEndIdx =
				reactiveCounterIdx !== -1 ? reactiveCounterIdx : settledContent.length;
			const keepalivePart = settledContent.slice(keepaliveIdx, keepaliveEndIdx);

			const settledDst = join(ROOT_SRC, "base/sources/settled.ts");
			const keepaliveDst = join(ROOT_SRC, "base/meta/keepalive.ts");

			if (!DRY) {
				await ensureDir(settledDst);
				await writeFile(
					settledDst,
					`/**
 * Settled/signal helpers.
 *
 * Moved from extra/sources/settled.ts during cleave A2.
 * keepalive extracted to base/meta/keepalive.ts.
 */

` + settledWithCounter,
				);
				await ensureDir(keepaliveDst);
				await writeFile(
					keepaliveDst,
					`/**
 * keepalive — empty subscription to keep derived nodes wired.
 *
 * Extracted from extra/sources/settled.ts during cleave A2.
 */

import type { Node } from "@graphrefly/pure-ts/core";

` + keepalivePart,
				);
				console.log(`  SPLIT settled.ts → base/sources/settled.ts + base/meta/keepalive.ts`);
			} else {
				console.log(`  [DRY] SPLIT settled.ts → base/sources/settled.ts + base/meta/keepalive.ts`);
			}
		}
	}

	// Split patterns/_internal/index.ts:
	//   emitToMeta → base/meta/emit-to-meta.ts
	//   trackingKey → utils/harness/_internal.ts  (STOP #1 resolved)
	// The original file stays (deleted in Phase 2 deletes after split)
	const internalSrc = join(PURE_TS_SRC, "patterns/_internal/index.ts");
	if (existsSync(internalSrc)) {
		const internalContent = await readFile(internalSrc, "utf8");
		const emitToMetaIdx = internalContent.indexOf("// emitToMeta");
		const trackingKeyIdx = internalContent.indexOf("// trackingKey");

		if (emitToMetaIdx === -1) {
			console.log("  ERROR: Could not find emitToMeta section in _internal/index.ts");
		} else {
			// emitToMeta section (between its comment and trackingKey)
			const emitToMetaSection = internalContent.slice(
				emitToMetaIdx,
				trackingKeyIdx !== -1 ? trackingKeyIdx : undefined,
			);
			const emitToMetaDst = join(ROOT_SRC, "base/meta/emit-to-meta.ts");

			// trackingKey section
			const trackingKeySection = trackingKeyIdx !== -1 ? internalContent.slice(trackingKeyIdx) : "";
			const trackingKeyDst = join(ROOT_SRC, "utils/harness/_internal.ts");

			if (!DRY) {
				await ensureDir(emitToMetaDst);
				await writeFile(
					emitToMetaDst,
					`/**
 * emitToMeta — forward DATA to a meta companion node via tier-3 deferral.
 *
 * Extracted from patterns/_internal/index.ts during cleave A2.
 */

import { downWithBatch } from "@graphrefly/pure-ts/core";
import { DATA } from "@graphrefly/pure-ts/core";
import type { Node } from "@graphrefly/pure-ts/core";
import { defaultConfig } from "@graphrefly/pure-ts/core";

` + emitToMetaSection.replace(/^\/\/ emitToMeta\n\n/, ""),
				);

				await ensureDir(trackingKeyDst);
				await writeFile(
					trackingKeyDst,
					`/**
 * Harness-domain internal helpers.
 *
 * trackingKey extracted from patterns/_internal/index.ts during cleave A2.
 * Destination decided per STOP #1 resolution: harness-domain shape,
 * used only by utils/harness/types.ts and presets/harness/harness-loop.ts.
 */

` + trackingKeySection.replace(/^\/\/ trackingKey\n\n/, ""),
				);

				console.log(
					`  SPLIT _internal/index.ts → base/meta/emit-to-meta.ts + utils/harness/_internal.ts`,
				);
			} else {
				console.log(
					`  [DRY] SPLIT _internal/index.ts → base/meta/emit-to-meta.ts + utils/harness/_internal.ts`,
				);
				console.log(`  [DRY]   emitToMeta → base/meta/emit-to-meta.ts`);
				console.log(`  [DRY]   trackingKey → utils/harness/_internal.ts  (STOP #1 resolved)`);
			}
		}
	}
}

// ---------------------------------------------------------------------------
// Phase 1: Physical file moves (source files)
// ---------------------------------------------------------------------------

let totalMoved = 0;
let totalSkipped = 0;

async function executeMoves(moveLookup: Map<string, string>): Promise<void> {
	console.log("\n[Phase 1] Moving source files...");

	for (const [srcAbs, dstAbs] of moveLookup) {
		if (!existsSync(srcAbs)) {
			console.log(`  SKIP (missing): ${relative(ROOT, srcAbs)}`);
			totalSkipped++;
			continue;
		}

		if (!DRY) {
			await ensureDir(dstAbs);
			await rename(srcAbs, dstAbs);
		}
		console.log(
			`  ${DRY ? "[DRY] " : ""}MOVE: ${relative(ROOT, srcAbs)} → ${relative(ROOT, dstAbs)}`,
		);
		totalMoved++;
	}
}

// ---------------------------------------------------------------------------
// Phase 2: Delete backward-compat shims + split source files
// ---------------------------------------------------------------------------

let totalDeleted = 0;

async function executeDeletes(): Promise<void> {
	console.log("\n[Phase 2] Deleting backward-compat shims...");

	for (const relPath of DELETE_FILES) {
		const absPath = join(PURE_TS_SRC, relPath);
		if (!existsSync(absPath)) {
			console.log(`  SKIP (missing): ${relPath}`);
			continue;
		}
		if (!DRY) {
			await rm(absPath);
		}
		console.log(`  ${DRY ? "[DRY] " : ""}DELETE: ${relPath}`);
		totalDeleted++;
	}

	// Delete split sources
	const splitSources = [
		"extra/composition/composite.ts", // split → verifiable.ts + distill.ts
		// extra/sources/event.ts: kept as _orig.ts via MOVES (event/timer.ts will be the live version)
		// extra/sources/settled.ts: moved via MOVES table above
		// patterns/_internal/index.ts: split → emit-to-meta.ts + utils/harness/_internal.ts
		"patterns/_internal/index.ts",
	];
	for (const relPath of splitSources) {
		const absPath = join(PURE_TS_SRC, relPath);
		if (!existsSync(absPath)) continue;
		if (!DRY) {
			await rm(absPath);
		}
		console.log(`  ${DRY ? "[DRY] " : ""}DELETE (split source): ${relPath}`);
		totalDeleted++;
	}
}

// ---------------------------------------------------------------------------
// Phase 3: Move test files (Option B)
// ---------------------------------------------------------------------------

let totalTestsMoved = 0;
let totalTestsSkipped = 0;

async function executeTestMoves(): Promise<void> {
	console.log("\n[Phase 3] Moving presentation test files to root src/__tests__/...");

	for (const tm of TEST_MOVES) {
		const srcAbs = join(PURE_TS_TESTS, tm.from);
		const dstAbs = join(ROOT_TESTS, tm.to);

		if (!existsSync(srcAbs)) {
			console.log(`  SKIP (missing): ${tm.from}`);
			totalTestsSkipped++;
			continue;
		}

		if (!DRY) {
			await ensureDir(dstAbs);
			await rename(srcAbs, dstAbs);
		}
		console.log(`  ${DRY ? "[DRY] " : ""}TEST MOVE: ${tm.from} → ${tm.to}`);
		totalTestsMoved++;
	}
}

// ---------------------------------------------------------------------------
// Phase 4: Rewrite imports
// ---------------------------------------------------------------------------

async function executeImportRewrites(moveLookup: Map<string, string>): Promise<void> {
	console.log("\n[Phase 4] Rewriting imports...");

	// Build combined lookup that includes test moves
	const combinedLookup = new Map(moveLookup);
	for (const tm of TEST_MOVES) {
		const srcAbs = join(PURE_TS_TESTS, tm.from);
		const dstAbs = join(ROOT_TESTS, tm.to);
		combinedLookup.set(srcAbs, dstAbs);
	}

	const roots = [
		join(ROOT, "packages/pure-ts/src"),
		ROOT_SRC,
		join(ROOT, "packages/parity-tests"),
		join(ROOT, "packages/cli/src"),
		join(ROOT, "packages/cli/tests"),
	];

	for (const rootDir of roots) {
		if (!existsSync(rootDir)) continue;
		const files = await walk(rootDir);
		for (const f of files) {
			await rewriteImports(f, combinedLookup);
		}
	}
}

// ---------------------------------------------------------------------------
// Phase 5: Create root vitest.config.ts + update package.json scripts
// ---------------------------------------------------------------------------

async function createRootVitestConfig(): Promise<void> {
	console.log("\n[Phase 5] Creating root vitest.config.ts...");

	const vitestConfigPath = join(ROOT, "vitest.config.ts");
	const vitestConfigContent = `import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
\tresolve: {
\t\talias: [
\t\t\t{
\t\t\t\tfind: /^@graphrefly\\/pure-ts\\/(.+)$/,
\t\t\t\treplacement: path.resolve(__dirname, "packages/pure-ts/src/$1"),
\t\t\t},
\t\t\t{
\t\t\t\tfind: "@graphrefly/pure-ts",
\t\t\t\treplacement: path.resolve(__dirname, "packages/pure-ts/src/index.ts"),
\t\t\t},
\t\t],
\t},
\ttest: {
\t\tinclude: ["src/**/*.test.ts"],
\t\texclude: ["**/node_modules/**", "dist/**", "**/*.bench.ts"],
\t\tenvironment: "node",
\t},
});
`;

	if (!DRY) {
		await writeFile(vitestConfigPath, vitestConfigContent, "utf8");
		console.log(`  CREATED: vitest.config.ts at root`);
	} else {
		console.log(`  [DRY] WOULD CREATE: vitest.config.ts at root`);
	}
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
	console.log(`\n=== codemod-cleave-A ${DRY ? "(DRY RUN)" : "(LIVE)"} ===\n`);

	const moveLookup = buildMoveLookup();

	console.log(`Total planned source moves: ${moveLookup.size}`);
	console.log(`Total planned test moves: ${TEST_MOVES.length}`);

	// Phase 0: Symbol splits
	await executeSplits(moveLookup);

	// Phase 1: Physical file moves (source)
	await executeMoves(moveLookup);

	// Phase 2: Deletions (shims + split sources)
	await executeDeletes();

	// Phase 3: Test file moves
	await executeTestMoves();

	// Phase 4: Import rewrites (after all files are in new locations)
	await executeImportRewrites(moveLookup);

	// Phase 5: Create root vitest config
	await createRootVitestConfig();

	// Summary
	console.log("\n=== SUMMARY ===");
	console.log(`  Source files moved:      ${totalMoved} (${totalSkipped} skipped/missing)`);
	console.log(
		`  Test files moved:        ${totalTestsMoved} (${totalTestsSkipped} skipped/missing)`,
	);
	console.log(`  Files deleted:           ${totalDeleted}`);
	console.log(`  Files imports rewritten: ${totalFilesModified}`);

	const benignImports = unresolvableImports.filter(
		(u) => u.file.includes("__bench__") || u.file.includes("__experiments__"),
	);
	const realUnresolvable = unresolvableImports.filter(
		(u) => !u.file.includes("__bench__") && !u.file.includes("__experiments__"),
	);

	if (realUnresolvable.length > 0) {
		const top20 = realUnresolvable.slice(0, 20);
		console.log(
			`\n  Unresolvable imports (non-bench, top ${top20.length} of ${realUnresolvable.length}):`,
		);
		for (const u of top20) {
			console.log(`    ${relative(ROOT, u.file)}: "${u.spec}"`);
		}
	} else {
		console.log(`  Unresolvable imports (non-bench): 0`);
	}

	if (benignImports.length > 0) {
		console.log(`  Benign unresolvable (bench/experiments): ${benignImports.length}`);
	}

	console.log("\n=== RESOLVED DECISIONS ===");
	console.log("  STOP #1: trackingKey → utils/harness/_internal.ts");
	console.log("  STOP #2: Test migration → Option B (move to root src/__tests__/)");
	console.log("  MINOR: extra/storage.ts absent from disk — skipped (25 shims, not 26)");

	console.log("\n=== DONE ===\n");
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
