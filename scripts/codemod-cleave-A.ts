#!/usr/bin/env node
/**
 * codemod-cleave-A.ts — A2 execution: purify @graphrefly/pure-ts.
 *
 * Moves presentation files from packages/pure-ts/src/ to root src/{base,utils,presets,compat}/
 * Renames substrate files within pure-ts (sources/iter.ts → sources/sync/iter.ts, etc.)
 * Deletes 26 backward-compat shims at extra/*.ts
 * Rewrites imports across the monorepo
 *
 * Usage:
 *   pnpm tsx scripts/codemod-cleave-A.ts [--dry]
 *
 * Provenance: archive/docs/SESSION-DS-cleave-A-file-moves.md
 */

import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { existsSync, statSync } from "node:fs";

const ROOT = resolve(import.meta.dirname, "..");
const PURE_TS_SRC = join(ROOT, "packages/pure-ts/src");
const ROOT_SRC = join(ROOT, "src");

const DRY = process.argv.includes("--dry");

// ---------------------------------------------------------------------------
// ESCALATION ITEMS (must be resolved by Opus before codemod runs)
// ---------------------------------------------------------------------------
// 1. patterns/_internal/index.ts exports BOTH emitToMeta AND trackingKey.
//    The A1 doc only maps emitToMeta → base/meta/emit-to-meta.ts.
//    trackingKey is used by:
//      - patterns/harness/types.ts         → moves to utils/harness/types.ts
//      - patterns/harness/presets/harness-loop.ts → moves to presets/harness/harness-loop.ts
//    Its natural destination would be utils/harness/_internal.ts, but this
//    requires Opus judgment. STOPPING per brief rule.
//
// 2. extra/storage.ts is listed in the A1 doc's 26 shims but does NOT exist on disk.
//    Will delete only the 25 shims that actually exist.
//
// 3. Test migration: packages/pure-ts vitest config includes "src/**/*.test.ts".
//    After source files move to root src/, test imports via relative paths will break.
//    The tests themselves can stay in packages/pure-ts/ but must be rewritten to import
//    from @graphrefly/pure-ts (substrate) or @graphrefly/graphrefly (presentation).
//    BUT pure-ts vitest config has no alias for @graphrefly/graphrefly.
//    This requires a decision on where presentation tests live post-cleave.

const ESCALATION_ITEMS = [
  "STOP: patterns/_internal/index.ts exports trackingKey (no A1 doc destination). Used by harness/types.ts + harness-loop.ts. Proposed: utils/harness/_internal.ts — awaiting Opus decision.",
  "MINOR: extra/storage.ts not on disk (A1 lists 26 shims, only 25 found). Will delete 25.",
  "STOP: Test migration strategy unresolved. Tests in packages/pure-ts/src/__tests__/patterns/ use relative imports like '../../patterns/...'. After move, these break. No root vitest config exists. Awaiting Opus decision on test co-location vs cross-package alias.",
];

console.log("\n=== ESCALATION ITEMS (require Opus decision) ===");
for (const item of ESCALATION_ITEMS) {
  console.log(`  ⚠️  ${item}`);
}
console.log("=================================================\n");

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
  from: string;   // relative to PURE_TS_SRC
  to: string;     // relative to PURE_TS_SRC (substrate) or ROOT_SRC (presentation)
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
  { from: "extra/composition/topology-diff.ts", to: "base/composition/topology-diff.ts", toRoot: true },
  { from: "extra/composition/pubsub.ts", to: "base/composition/pubsub.ts", toRoot: true },
  { from: "extra/composition/backpressure.ts", to: "base/composition/backpressure.ts", toRoot: true },
  { from: "extra/composition/external-register.ts", to: "base/composition/external-register.ts", toRoot: true },
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
  { from: "extra/render/graph-spec-to-ascii.ts", to: "base/render/graph-spec-to-ascii.ts", toRoot: true },
  { from: "extra/render/graph-spec-to-d2.ts", to: "base/render/graph-spec-to-d2.ts", toRoot: true },
  { from: "extra/render/graph-spec-to-json.ts", to: "base/render/graph-spec-to-json.ts", toRoot: true },
  { from: "extra/render/graph-spec-to-mermaid-url.ts", to: "base/render/graph-spec-to-mermaid-url.ts", toRoot: true },
  { from: "extra/render/graph-spec-to-mermaid.ts", to: "base/render/graph-spec-to-mermaid.ts", toRoot: true },
  { from: "extra/render/graph-spec-to-pretty.ts", to: "base/render/graph-spec-to-pretty.ts", toRoot: true },
  { from: "extra/render/index.ts", to: "base/render/index.ts", toRoot: true },
  { from: "extra/render/layout-frame-to-svg.ts", to: "base/render/layout-frame-to-svg.ts", toRoot: true },
  { from: "extra/render/layout-types.ts", to: "base/render/layout-types.ts", toRoot: true },

  // -------------------------------------------------------------------------
  // Presentation → base/meta/
  // -------------------------------------------------------------------------
  { from: "extra/meta.ts", to: "base/meta/domain-meta.ts", toRoot: true },
  // patterns/_internal/index.ts → base/meta/emit-to-meta.ts (only emitToMeta)
  // NOTE: trackingKey has no A1-doc destination — ESCALATION ITEM #1
  // We do NOT move this file until resolved.

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
  { from: "extra/sources-fs.ts", to: "base/sources/node/fs-root.ts", toRoot: true }, // consolidate later
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
  { from: "extra/composition/audited-success-tracker.ts", to: "utils/orchestration/audited-success-tracker.ts", toRoot: true },

  // -------------------------------------------------------------------------
  // Presentation → utils/messaging/
  // -------------------------------------------------------------------------
  { from: "patterns/messaging/audit-records.ts", to: "utils/messaging/audit-records.ts", toRoot: true },
  { from: "patterns/messaging/index.ts", to: "utils/messaging/index.ts", toRoot: true },
  { from: "patterns/messaging/message.ts", to: "utils/messaging/message.ts", toRoot: true },

  // -------------------------------------------------------------------------
  // Presentation → utils/orchestration/
  // -------------------------------------------------------------------------
  { from: "patterns/orchestration/human-input.ts", to: "utils/orchestration/human-input.ts", toRoot: true },
  { from: "patterns/orchestration/index.ts", to: "utils/orchestration/index.ts", toRoot: true },
  { from: "patterns/orchestration/pipeline-graph.ts", to: "utils/orchestration/pipeline-graph.ts", toRoot: true },
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
  { from: "patterns/topology-view/_internal.ts", to: "utils/topology-view/_internal.ts", toRoot: true },
  { from: "patterns/topology-view/index.ts", to: "utils/topology-view/index.ts", toRoot: true },
  { from: "patterns/topology-view/types.ts", to: "utils/topology-view/types.ts", toRoot: true },

  // -------------------------------------------------------------------------
  // Presentation → utils/reactive-layout/
  // -------------------------------------------------------------------------
  { from: "patterns/reactive-layout/index.ts", to: "utils/reactive-layout/index.ts", toRoot: true },
  { from: "patterns/reactive-layout/measurement-adapters.ts", to: "utils/reactive-layout/measurement-adapters.ts", toRoot: true },
  { from: "patterns/reactive-layout/reactive-block-layout.ts", to: "utils/reactive-layout/reactive-block-layout.ts", toRoot: true },
  { from: "patterns/reactive-layout/reactive-flow-layout.ts", to: "utils/reactive-layout/reactive-flow-layout.ts", toRoot: true },
  { from: "patterns/reactive-layout/reactive-layout.ts", to: "utils/reactive-layout/reactive-layout.ts", toRoot: true },

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
  { from: "patterns/domain-templates/index.ts", to: "utils/domain-templates/index.ts", toRoot: true },

  // -------------------------------------------------------------------------
  // Presentation → utils/ai/
  // -------------------------------------------------------------------------
  { from: "patterns/ai/_internal.ts", to: "utils/ai/_internal.ts", toRoot: true },
  { from: "patterns/ai/index.ts", to: "utils/ai/index.ts", toRoot: true },
  { from: "patterns/ai/node.ts", to: "utils/ai/node.ts", toRoot: true },
  { from: "patterns/ai/browser.ts", to: "utils/ai/browser.ts", toRoot: true },
  // ai/adapters subtree
  { from: "patterns/ai/adapters/_internal/content-addressed-cache.ts", to: "utils/ai/adapters/_internal/content-addressed-cache.ts", toRoot: true },
  { from: "patterns/ai/adapters/_internal/wrappers.ts", to: "utils/ai/adapters/_internal/wrappers.ts", toRoot: true },
  { from: "patterns/ai/adapters/core/capabilities.ts", to: "utils/ai/adapters/core/capabilities.ts", toRoot: true },
  { from: "patterns/ai/adapters/core/factory.ts", to: "utils/ai/adapters/core/factory.ts", toRoot: true },
  { from: "patterns/ai/adapters/core/index.ts", to: "utils/ai/adapters/core/index.ts", toRoot: true },
  { from: "patterns/ai/adapters/core/observable.ts", to: "utils/ai/adapters/core/observable.ts", toRoot: true },
  { from: "patterns/ai/adapters/core/pricing.ts", to: "utils/ai/adapters/core/pricing.ts", toRoot: true },
  { from: "patterns/ai/adapters/core/types.ts", to: "utils/ai/adapters/core/types.ts", toRoot: true },
  { from: "patterns/ai/adapters/index.ts", to: "utils/ai/adapters/index.ts", toRoot: true },
  { from: "patterns/ai/adapters/middleware/breaker.ts", to: "utils/ai/adapters/middleware/breaker.ts", toRoot: true },
  { from: "patterns/ai/adapters/middleware/budget-gate.ts", to: "utils/ai/adapters/middleware/budget-gate.ts", toRoot: true },
  { from: "patterns/ai/adapters/middleware/dry-run.ts", to: "utils/ai/adapters/middleware/dry-run.ts", toRoot: true },
  { from: "patterns/ai/adapters/middleware/http429-parser.ts", to: "utils/ai/adapters/middleware/http429-parser.ts", toRoot: true },
  { from: "patterns/ai/adapters/middleware/index.ts", to: "utils/ai/adapters/middleware/index.ts", toRoot: true },
  { from: "patterns/ai/adapters/middleware/rate-limiter.ts", to: "utils/ai/adapters/middleware/rate-limiter.ts", toRoot: true },
  { from: "patterns/ai/adapters/middleware/replay-cache.ts", to: "utils/ai/adapters/middleware/replay-cache.ts", toRoot: true },
  { from: "patterns/ai/adapters/middleware/resilient-adapter.ts", to: "utils/ai/adapters/middleware/resilient-adapter.ts", toRoot: true },
  { from: "patterns/ai/adapters/middleware/retry.ts", to: "utils/ai/adapters/middleware/retry.ts", toRoot: true },
  { from: "patterns/ai/adapters/middleware/timeout.ts", to: "utils/ai/adapters/middleware/timeout.ts", toRoot: true },
  { from: "patterns/ai/adapters/providers/anthropic.ts", to: "utils/ai/adapters/providers/anthropic.ts", toRoot: true },
  { from: "patterns/ai/adapters/providers/browser/chrome-nano.ts", to: "utils/ai/adapters/providers/browser/chrome-nano.ts", toRoot: true },
  { from: "patterns/ai/adapters/providers/browser/index.ts", to: "utils/ai/adapters/providers/browser/index.ts", toRoot: true },
  { from: "patterns/ai/adapters/providers/browser/webllm.ts", to: "utils/ai/adapters/providers/browser/webllm.ts", toRoot: true },
  { from: "patterns/ai/adapters/providers/dry-run.ts", to: "utils/ai/adapters/providers/dry-run.ts", toRoot: true },
  { from: "patterns/ai/adapters/providers/fallback-node.ts", to: "utils/ai/adapters/providers/fallback-node.ts", toRoot: true },
  { from: "patterns/ai/adapters/providers/fallback.ts", to: "utils/ai/adapters/providers/fallback.ts", toRoot: true },
  { from: "patterns/ai/adapters/providers/google.ts", to: "utils/ai/adapters/providers/google.ts", toRoot: true },
  { from: "patterns/ai/adapters/providers/index.ts", to: "utils/ai/adapters/providers/index.ts", toRoot: true },
  { from: "patterns/ai/adapters/providers/openai-compat.ts", to: "utils/ai/adapters/providers/openai-compat.ts", toRoot: true },
  { from: "patterns/ai/adapters/routing/browser-presets.ts", to: "utils/ai/adapters/routing/browser-presets.ts", toRoot: true },
  { from: "patterns/ai/adapters/routing/cascading.ts", to: "utils/ai/adapters/routing/cascading.ts", toRoot: true },
  { from: "patterns/ai/adapters/routing/index.ts", to: "utils/ai/adapters/routing/index.ts", toRoot: true },
  // ai/agents subtree (agents/presets.ts → presets/ai/agents.ts)
  { from: "patterns/ai/agents/agent.ts", to: "utils/ai/agents/agent.ts", toRoot: true },
  { from: "patterns/ai/agents/chat-stream.ts", to: "utils/ai/agents/chat-stream.ts", toRoot: true },
  { from: "patterns/ai/agents/handoff.ts", to: "utils/ai/agents/handoff.ts", toRoot: true },
  { from: "patterns/ai/agents/tool-execution.ts", to: "utils/ai/agents/tool-execution.ts", toRoot: true },
  { from: "patterns/ai/agents/tool-registry.ts", to: "utils/ai/agents/tool-registry.ts", toRoot: true },
  { from: "patterns/ai/agents/tool-selector.ts", to: "utils/ai/agents/tool-selector.ts", toRoot: true },
  // agents/presets.ts → presets/ (handled separately)
  { from: "patterns/ai/extractors/cost-meter.ts", to: "utils/ai/extractors/cost-meter.ts", toRoot: true },
  { from: "patterns/ai/extractors/keyword-flag.ts", to: "utils/ai/extractors/keyword-flag.ts", toRoot: true },
  { from: "patterns/ai/extractors/stream-extractor.ts", to: "utils/ai/extractors/stream-extractor.ts", toRoot: true },
  { from: "patterns/ai/extractors/tool-call.ts", to: "utils/ai/extractors/tool-call.ts", toRoot: true },
  { from: "patterns/ai/graph-integration/gauges-as-context.ts", to: "utils/ai/graph-integration/gauges-as-context.ts", toRoot: true },
  { from: "patterns/ai/graph-integration/graph-from-spec.ts", to: "utils/ai/graph-integration/graph-from-spec.ts", toRoot: true },
  { from: "patterns/ai/graph-integration/knobs-as-tools.ts", to: "utils/ai/graph-integration/knobs-as-tools.ts", toRoot: true },
  { from: "patterns/ai/graph-integration/suggest-strategy.ts", to: "utils/ai/graph-integration/suggest-strategy.ts", toRoot: true },
  { from: "patterns/ai/graph-integration/validate-graph-def.ts", to: "utils/ai/graph-integration/validate-graph-def.ts", toRoot: true },
  { from: "patterns/ai/memory/admission.ts", to: "utils/ai/memory/admission.ts", toRoot: true },
  { from: "patterns/ai/memory/memory-composers.ts", to: "utils/ai/memory/memory-composers.ts", toRoot: true },
  { from: "patterns/ai/memory/retrieval.ts", to: "utils/ai/memory/retrieval.ts", toRoot: true },
  { from: "patterns/ai/memory/tiers.ts", to: "utils/ai/memory/tiers.ts", toRoot: true },
  { from: "patterns/ai/prompts/frozen-context.ts", to: "utils/ai/prompts/frozen-context.ts", toRoot: true },
  { from: "patterns/ai/prompts/prompt-call.ts", to: "utils/ai/prompts/prompt-call.ts", toRoot: true },
  { from: "patterns/ai/prompts/prompt-node.ts", to: "utils/ai/prompts/prompt-node.ts", toRoot: true },
  { from: "patterns/ai/prompts/streaming.ts", to: "utils/ai/prompts/streaming.ts", toRoot: true },
  { from: "patterns/ai/prompts/system-prompt.ts", to: "utils/ai/prompts/system-prompt.ts", toRoot: true },
  { from: "patterns/ai/safety/content-gate.ts", to: "utils/ai/safety/content-gate.ts", toRoot: true },
  { from: "patterns/ai/safety/redactor.ts", to: "utils/ai/safety/redactor.ts", toRoot: true },

  // -------------------------------------------------------------------------
  // Presentation → utils/harness/
  // -------------------------------------------------------------------------
  { from: "patterns/harness/actuator-executor.ts", to: "utils/harness/actuator-executor.ts", toRoot: true },
  { from: "patterns/harness/auto-solidify.ts", to: "utils/harness/auto-solidify.ts", toRoot: true },
  { from: "patterns/harness/bridge.ts", to: "utils/harness/bridge.ts", toRoot: true },
  { from: "patterns/harness/defaults.ts", to: "utils/harness/defaults.ts", toRoot: true },
  { from: "patterns/harness/eval-verifier.ts", to: "utils/harness/eval-verifier.ts", toRoot: true },
  { from: "patterns/harness/index.ts", to: "utils/harness/index.ts", toRoot: true },
  { from: "patterns/harness/profile.ts", to: "utils/harness/profile.ts", toRoot: true },
  { from: "patterns/harness/refine-executor.ts", to: "utils/harness/refine-executor.ts", toRoot: true },
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
  { from: "extra/resilience/rate-limiter.ts", to: "utils/resilience/rate-limiter.ts", toRoot: true },
  { from: "extra/resilience/retry.ts", to: "utils/resilience/retry.ts", toRoot: true },
  { from: "extra/resilience/status.ts", to: "utils/resilience/status.ts", toRoot: true },
  { from: "extra/resilience/timeout.ts", to: "utils/resilience/timeout.ts", toRoot: true },
  { from: "extra/adaptive-rate-limiter.ts", to: "utils/resilience/adaptive-rate-limiter.ts", toRoot: true },

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
  { from: "patterns/harness/presets/harness-loop.ts", to: "presets/harness/harness-loop.ts", toRoot: true },
  { from: "patterns/harness/presets/refine-loop.ts", to: "presets/harness/refine-loop.ts", toRoot: true },
  { from: "patterns/harness/presets/spawnable.ts", to: "presets/harness/spawnable.ts", toRoot: true },

  // -------------------------------------------------------------------------
  // Presentation → presets/inspect/
  // -------------------------------------------------------------------------
  { from: "patterns/inspect/guarded-execution.ts", to: "presets/inspect/guarded-execution.ts", toRoot: true },
  { from: "patterns/inspect/presets/inspect.ts", to: "presets/inspect/composite.ts", toRoot: true },

  // -------------------------------------------------------------------------
  // Presentation → presets/resilience/
  // -------------------------------------------------------------------------
  { from: "extra/resilience/resilient-pipeline.ts", to: "presets/resilience/resilient-pipeline.ts", toRoot: true },

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
// Files that must be READ, SPLIT, and two new files WRITTEN.
// The source file is then DELETED.

type SymbolSplit = {
  source: string;  // relative to PURE_TS_SRC
  destinations: Array<{
    file: string;   // relative to ROOT_SRC (always presentation)
    symbols: string[]; // export names that go here
    // For keepalive in settled.ts: we need special handling
  }>;
  note?: string;
};

// These are the splits that need to be analyzed and handled.
// For the actual implementation, we'll COPY the files and note the split.
// The import rewriter then knows which symbols came from which destination.
const SYMBOL_SPLIT_SOURCES: SymbolSplit[] = [
  {
    source: "extra/composition/composite.ts",
    destinations: [
      { file: "base/composition/verifiable.ts", symbols: ["VerifyValue", "VerifiableOptions", "VerifiableBundle", "verifiable"] },
      { file: "base/composition/distill.ts", symbols: ["Extraction", "DistillOptions", "DistillBundle", "distill"] },
    ],
  },
  {
    source: "extra/sources/event.ts",
    destinations: [
      { file: "extra/sources/event/timer.ts", symbols: ["fromTimer"] }, // substrate — stays in pure-ts
      { file: "base/sources/event/cron.ts", symbols: ["FromCronOptions", "fromCron"] }, // presentation
      { file: "base/sources/event/dom.ts", symbols: ["EventTargetLike", "fromEvent", "fromRaf"] }, // presentation
    ],
    note: "extra/cron.ts (CronSchedule, parseCron, matchesCron) also goes to base/sources/event/cron.ts",
  },
  {
    source: "extra/sources/settled.ts",
    destinations: [
      { file: "base/sources/settled.ts", symbols: ["firstValueFrom", "firstWhere", "awaitSettled", "nodeSignal", "ReactiveCounterBundle", "reactiveCounter"] },
      { file: "base/meta/keepalive.ts", symbols: ["keepalive"] },
    ],
  },
];

// ---------------------------------------------------------------------------
// SYMBOL MAP for import rewriting
// ---------------------------------------------------------------------------
// When we see an import from a split source, we redirect each symbol to its new home.
// Key: source file path (relative to PURE_TS_SRC, without .ts extension)
// Value: map of symbol name → new file path (relative to ROOT_SRC for presentation, or PURE_TS_SRC for substrate)

const SYMBOL_MAP: Record<string, Record<string, { file: string; toRoot: boolean }>> = {
  "extra/composition/composite": {
    verifiable: { file: "base/composition/verifiable", toRoot: true },
    VerifiableOptions: { file: "base/composition/verifiable", toRoot: true },
    VerifiableBundle: { file: "base/composition/verifiable", toRoot: true },
    VerifyValue: { file: "base/composition/verifiable", toRoot: true },
    distill: { file: "base/composition/distill", toRoot: true },
    DistillOptions: { file: "base/composition/distill", toRoot: true },
    DistillBundle: { file: "base/composition/distill", toRoot: true },
    Extraction: { file: "base/composition/distill", toRoot: true },
  },
  "extra/sources/event": {
    fromTimer: { file: "extra/sources/event/timer", toRoot: false },
    FromCronOptions: { file: "base/sources/event/cron", toRoot: true },
    fromCron: { file: "base/sources/event/cron", toRoot: true },
    EventTargetLike: { file: "base/sources/event/dom", toRoot: true },
    fromEvent: { file: "base/sources/event/dom", toRoot: true },
    fromRaf: { file: "base/sources/event/dom", toRoot: true },
  },
  "extra/sources/settled": {
    firstValueFrom: { file: "base/sources/settled", toRoot: true },
    firstWhere: { file: "base/sources/settled", toRoot: true },
    awaitSettled: { file: "base/sources/settled", toRoot: true },
    nodeSignal: { file: "base/sources/settled", toRoot: true },
    ReactiveCounterBundle: { file: "base/sources/settled", toRoot: true },
    reactiveCounter: { file: "base/sources/settled", toRoot: true },
    keepalive: { file: "base/meta/keepalive", toRoot: true },
  },
  // emitToMeta from _internal/index.ts → base/meta/emit-to-meta
  // (trackingKey destination is UNRESOLVED — escalation item #1)
  "patterns/_internal/index": {
    emitToMeta: { file: "base/meta/emit-to-meta", toRoot: true },
    // trackingKey: UNRESOLVED — will stay at old location until Opus decides
  },
};

// ---------------------------------------------------------------------------
// DELETIONS (26 backward-compat shims; 25 actually exist on disk)
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
  // "extra/storage.ts", // MISSING from disk; A1 doc lists but doesn't exist
  "extra/storage-core.ts",
  "extra/storage-node.ts",
  "extra/storage-tiers.ts",
  "extra/storage-tiers-node.ts",
  "extra/storage-tiers-browser.ts",
  "extra/storage-wal.ts",
  "extra/stratify.ts",
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
    if (e.isDirectory()) out.push(...await walk(p));
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

// Build a reverse lookup: srcRelPath (no ext) → dstRelInfo
// Used by the import rewriter.

type MoveTarget = { file: string; toRoot: boolean };

function buildRelMoveLookup(): Map<string, MoveTarget> {
  const lookup = new Map<string, MoveTarget>();
  for (const m of MOVES) {
    const fromNoExt = m.from.replace(/\.ts$/, "");
    lookup.set(fromNoExt, { file: m.to.replace(/\.ts$/, ""), toRoot: m.toRoot });
  }
  return lookup;
}

// ---------------------------------------------------------------------------
// Import path resolver
// ---------------------------------------------------------------------------

function resolveImport(fromFile: string, spec: string): string | null {
  if (!spec.startsWith(".")) return null;
  const fromDir = dirname(fromFile);
  const resolved = resolve(fromDir, spec);
  // Try .ts extension
  if (existsSync(resolved + ".ts")) return resolved + ".ts";
  // Try index.ts
  if (existsSync(join(resolved, "index.ts"))) return join(resolved, "index.ts");
  // Try without extension (already has .ts)
  if (existsSync(resolved) && statSync(resolved).isFile()) return resolved;
  return null;
}

// Given an absolute file path, compute its repo-relative path without extension
function toRelNoExt(abs: string, baseDir: string): string | null {
  if (!abs.startsWith(baseDir)) return null;
  return abs.slice(baseDir.length + 1).replace(/\.ts$/, "");
}

// ---------------------------------------------------------------------------
// Import rewriter
// ---------------------------------------------------------------------------

const relMoveLookup = buildRelMoveLookup();

let totalFilesModified = 0;
const unresolvableImports: Array<{ file: string; spec: string }> = [];

async function rewriteImports(absFile: string, moveLookup: Map<string, string>): Promise<boolean> {
  const src = await readFile(absFile, "utf8");

  // Determine which package this file is in (or will be in after moves)
  const inPureTsSrc = absFile.startsWith(PURE_TS_SRC);
  const inRootSrc = absFile.startsWith(ROOT_SRC) && !absFile.startsWith(join(ROOT_SRC, "../packages"));

  // Parse import/export statements with a regex approach
  // Matches: import ... from "..."  |  export ... from "..."  |  import("...")
  const importRe = /^((?:import|export)[^"'`\n]*from\s+)(["'])([^"'`]+)\2/gm;
  const dynImportRe = /\bimport\s*\(\s*(["'])([^"'`]+)\1\s*\)/g;

  let changed = false;
  let result = src;

  // Process static imports/exports
  const matches: Array<{ full: string; prefix: string; quote: string; spec: string; index: number }> = [];
  let m: RegExpExecArray | null;

  importRe.lastIndex = 0;
  while ((m = importRe.exec(src)) !== null) {
    matches.push({ full: m[0], prefix: m[1], quote: m[2], spec: m[3], index: m.index });
  }

  // Process in reverse order to preserve indices
  const edits: Array<{ from: number; to: number; replacement: string }> = [];

  for (const match of matches) {
    const spec = match.spec;
    if (!spec.startsWith(".")) continue; // skip package imports

    const resolvedAbs = resolveImport(absFile, spec);
    if (!resolvedAbs) {
      if (spec.startsWith("./") || spec.startsWith("../")) {
        unresolvableImports.push({ file: absFile, spec });
      }
      continue;
    }

    // Check if this resolved file is in our move table
    const newAbs = moveLookup.get(resolvedAbs);
    if (!newAbs) continue;

    // The target file moved to newAbs. Compute new relative import from absFile's new location.
    // The importing file might also be moving — find its new location.
    const importerNewAbs = moveLookup.get(absFile) ?? absFile;

    const newRelRaw = relative(dirname(importerNewAbs), newAbs);
    const newRel = newRelRaw.startsWith(".") ? newRelRaw : "./" + newRelRaw;
    // Remove .ts extension (imports use no-ext by convention)
    const newSpec = newRel.replace(/\.ts$/, "");

    if (newSpec !== spec) {
      const newFull = match.prefix + match.quote + newSpec + match.quote;
      edits.push({ from: match.index, to: match.index + match.full.length, replacement: newFull });
      changed = true;
    }
  }

  // Apply edits in reverse order
  if (edits.length > 0) {
    const buf = [...result];
    // Sort descending by position
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
// Phase 1: Create new files for symbol splits
// ---------------------------------------------------------------------------

async function executeSplits(): Promise<void> {
  console.log("\n[Phase 1] Symbol splits...");

  // Split composite.ts → verifiable.ts + distill.ts
  const compositeSrc = join(PURE_TS_SRC, "extra/composition/composite.ts");
  if (!existsSync(compositeSrc)) {
    console.log("  SKIP: extra/composition/composite.ts not found");
  } else {
    const compositeContent = await readFile(compositeSrc, "utf8");

    // Split: verifiable.ts (everything up to and including the verifiable function)
    // distill.ts (everything from Extraction type to end)
    // We split at the Extraction type comment/declaration

    const extractionIdx = compositeContent.indexOf("export type Extraction<TMem>");
    if (extractionIdx === -1) {
      console.log("  ERROR: Could not find split point in composite.ts");
    } else {
      // verifiable part: imports + verifiable types + verifiable function
      let verifiablePart = compositeContent.slice(0, extractionIdx);
      // distill part: Extraction onwards
      let distillPart = compositeContent.slice(extractionIdx);

      // Fix distill part imports — it needs the same imports as the original
      // but the verifiable part takes the original imports. We need to add missing imports.
      const distillImports = `import { batch } from "../../core/batch.js";
import { DATA } from "../../core/messages.js";
import { factoryTag } from "../../core/meta.js";
import { type Node, type NodeOptions, node } from "../../core/node.js";
import {
\ttype ReactiveMapBundle,
\ttype ReactiveMapOptions,
\treactiveMap,
} from "../data-structures/reactive-map.js";
import { switchMap, withLatestFrom } from "../operators/index.js";
import { forEach, fromAny } from "../sources/index.js";

`;
      // The distill part already has the keepalive local function and mapFromSnapshot
      // We need to ensure the distill file has a doc comment
      distillPart = `/**
 * Budget-constrained reactive memory composition (roadmap §3.2b).
 *
 * Moved to base/composition/distill.ts during cleave A2.
 */

` + distillImports + distillPart;

      // The verifiable part already has the original imports
      verifiablePart = `/**
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
    }
  }

  // Split event.ts → event/timer.ts + base/sources/event/cron.ts + base/sources/event/dom.ts
  const eventSrc = join(PURE_TS_SRC, "extra/sources/event.ts");
  if (existsSync(eventSrc)) {
    const eventContent = await readFile(eventSrc, "utf8");

    // timer.ts: fromTimer only (import block + fromTimer function)
    // Find where fromRaf starts
    const rafIdx = eventContent.indexOf("export function fromRaf");
    const cronIdx = eventContent.indexOf("export function fromCron");

    if (rafIdx === -1 || cronIdx === -1) {
      console.log("  ERROR: Could not find split points in event.ts");
    } else {
      const firstSplit = Math.min(rafIdx, cronIdx);

      // timer.ts: everything up to the first of fromRaf/fromCron
      const timerContent = eventContent.slice(0, firstSplit);

      const timerDst = join(PURE_TS_SRC, "extra/sources/event/timer.ts");
      if (!DRY) {
        await ensureDir(timerDst);
        await writeFile(timerDst, `/**
 * Timer-based reactive source (substrate — stays in pure-ts).
 *
 * Moved to extra/sources/event/timer.ts during cleave A2.
 */

` + timerContent);
        console.log(`  SPLIT event.ts → event/timer.ts`);
      } else {
        console.log(`  [DRY] SPLIT event.ts → event/timer.ts`);
      }

      // cron.ts: fromCron + related type + extra/cron.ts content
      const cronSrc = join(PURE_TS_SRC, "extra/cron.ts");
      let cronContent = "";
      if (existsSync(cronSrc)) {
        cronContent = await readFile(cronSrc, "utf8");
      }
      // fromCron in event.ts — extract just the fromCron section
      // Order in event.ts: fromTimer → fromRaf → fromCron → fromEvent
      // Find fromEvent index to bound fromCron extraction
      const fromEventIdx = eventContent.indexOf("export function fromEvent");
      const fromCronEnd = fromEventIdx !== -1 ? fromEventIdx : eventContent.length;
      const fromCronInEvent = eventContent.slice(cronIdx, fromCronEnd);
      const cronDst = join(ROOT_SRC, "base/sources/event/cron.ts");
      if (!DRY) {
        await ensureDir(cronDst);
        await writeFile(cronDst, `/**
 * Cron-based reactive sources and schedule types.
 *
 * Moved from extra/cron.ts + extra/sources/event.ts (fromCron) to
 * base/sources/event/cron.ts during cleave A2.
 */

` + cronContent + "\n\n" + "// fromCron extracted from extra/sources/event.ts\n" + fromCronInEvent);
        console.log(`  SPLIT event.ts (fromCron) + cron.ts → base/sources/event/cron.ts`);
      } else {
        console.log(`  [DRY] SPLIT event.ts (fromCron) + cron.ts → base/sources/event/cron.ts`);
      }

      // dom.ts: fromEvent + fromRaf (both are presentation/browser-layer)
      // fromEvent comes after fromCron in the file
      const domStartIdx = fromEventIdx !== -1 ? Math.min(rafIdx, fromEventIdx) : rafIdx;
      const domContent = domStartIdx < eventContent.length ? eventContent.slice(domStartIdx) : "";
      const domDst = join(ROOT_SRC, "base/sources/event/dom.ts");
      if (!DRY) {
        await ensureDir(domDst);
        await writeFile(domDst, `/**
 * DOM-based reactive event sources (browser-layer).
 *
 * Moved from extra/sources/event.ts (fromEvent, fromRaf) to
 * base/sources/event/dom.ts during cleave A2.
 */

` + domContent);
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
    const keepaliveIdx = settledContent.indexOf("// ---------------------------------------------------------------------------\n// keepalive");
    const reactiveCounterIdx = settledContent.indexOf("// ---------------------------------------------------------------------------\n// reactiveCounter");

    if (keepaliveIdx === -1) {
      console.log("  ERROR: Could not find keepalive section in settled.ts");
    } else {
      // base/sources/settled.ts: everything up to keepalive
      const settledPart = settledContent.slice(0, keepaliveIdx);

      // Add reactiveCounter: it's after keepalive section
      // settled.ts = [firstValueFrom..awaitSettled..nodeSignal] + [keepalive] + [reactiveCounter]
      const settledWithCounter = settledPart + "\n" + settledContent.slice(reactiveCounterIdx !== -1 ? reactiveCounterIdx : settledContent.length);

      // base/meta/keepalive.ts: just the keepalive section
      let keepaliveEndIdx = reactiveCounterIdx !== -1 ? reactiveCounterIdx : settledContent.length;
      const keepalivePart = settledContent.slice(keepaliveIdx, keepaliveEndIdx);

      const settledDst = join(ROOT_SRC, "base/sources/settled.ts");
      const keepaliveDst = join(ROOT_SRC, "base/meta/keepalive.ts");

      if (!DRY) {
        await ensureDir(settledDst);
        await writeFile(settledDst, `/**
 * Settled/signal helpers.
 *
 * Moved from extra/sources/settled.ts during cleave A2.
 * keepalive extracted to base/meta/keepalive.ts.
 */

` + settledWithCounter);
        await ensureDir(keepaliveDst);
        await writeFile(keepaliveDst, `/**
 * keepalive — empty subscription to keep derived nodes wired.
 *
 * Extracted from extra/sources/settled.ts during cleave A2.
 */

import type { Node } from "@graphrefly/pure-ts/core";

` + keepalivePart);
        console.log(`  SPLIT settled.ts → base/sources/settled.ts + base/meta/keepalive.ts`);
      } else {
        console.log(`  [DRY] SPLIT settled.ts → base/sources/settled.ts + base/meta/keepalive.ts`);
      }
    }
  }

  // Extract emitToMeta from patterns/_internal/index.ts
  // NOTE: trackingKey has no destination → ESCALATION. We write only emitToMeta.
  const internalSrc = join(PURE_TS_SRC, "patterns/_internal/index.ts");
  if (existsSync(internalSrc)) {
    const internalContent = await readFile(internalSrc, "utf8");
    // emitToMeta function (everything from its comment to the end of the function)
    const emitToMetaIdx = internalContent.indexOf("// emitToMeta");
    const trackingKeyIdx = internalContent.indexOf("// trackingKey");
    if (emitToMetaIdx === -1) {
      console.log("  ERROR: Could not find emitToMeta section in _internal/index.ts");
    } else {
      // Extract just emitToMeta section
      const emitToMetaSection = internalContent.slice(
        emitToMetaIdx,
        trackingKeyIdx !== -1 ? trackingKeyIdx : undefined
      );
      const emitToMetaDst = join(ROOT_SRC, "base/meta/emit-to-meta.ts");
      if (!DRY) {
        await ensureDir(emitToMetaDst);
        await writeFile(emitToMetaDst, `/**
 * emitToMeta — forward DATA to a meta companion node via tier-3 deferral.
 *
 * Extracted from patterns/_internal/index.ts during cleave A2.
 * trackingKey stays in patterns/_internal/index.ts pending Opus decision on destination.
 */

import { downWithBatch } from "@graphrefly/pure-ts/core";
import { DATA } from "@graphrefly/pure-ts/core";
import type { Node } from "@graphrefly/pure-ts/core";
import { defaultConfig } from "@graphrefly/pure-ts/core";

` + emitToMetaSection.replace(/^\/\/ emitToMeta\n\n\/\*\*/, "/**"));
        console.log(`  EXTRACTED emitToMeta → base/meta/emit-to-meta.ts`);
        console.log(`  ⚠️  trackingKey NOT moved — awaiting Opus decision on destination`);
      } else {
        console.log(`  [DRY] EXTRACTED emitToMeta → base/meta/emit-to-meta.ts`);
        console.log(`  ⚠️  [DRY] trackingKey NOT moved — awaiting Opus decision`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Phase 2: Physical file moves
// ---------------------------------------------------------------------------

let totalMoved = 0;
let totalSkipped = 0;

async function executeMoves(moveLookup: Map<string, string>): Promise<void> {
  console.log("\n[Phase 2] Moving files...");

  for (const [srcAbs, dstAbs] of moveLookup) {
    if (!existsSync(srcAbs)) {
      console.log(`  SKIP (missing): ${relative(ROOT, srcAbs)}`);
      totalSkipped++;
      continue;
    }

    // Check destination doesn't already exist (root compat shims etc.)
    // If the destination is in root src/ and already exists as a shim, we'll
    // OVERWRITE it (the shim was just export * from "@graphrefly/pure-ts/...")

    if (!DRY) {
      await ensureDir(dstAbs);
      await rename(srcAbs, dstAbs);
    }
    console.log(`  ${DRY ? "[DRY] " : ""}MOVE: ${relative(ROOT, srcAbs)} → ${relative(ROOT, dstAbs)}`);
    totalMoved++;
  }
}

// ---------------------------------------------------------------------------
// Phase 3: Delete backward-compat shims
// ---------------------------------------------------------------------------

let totalDeleted = 0;

async function executeDeletes(): Promise<void> {
  console.log("\n[Phase 3] Deleting backward-compat shims...");

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

  // Also delete original split source files after splits are written
  const splitSources = [
    "extra/composition/composite.ts",
    // "extra/sources/event.ts" — kept as substrate base (timer.ts)
    // "extra/sources/settled.ts" — moved to base/sources/settled.ts via MOVES
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
// Phase 4: Rewrite imports
// ---------------------------------------------------------------------------

async function executeImportRewrites(moveLookup: Map<string, string>): Promise<void> {
  console.log("\n[Phase 4] Rewriting imports...");

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
      await rewriteImports(f, moveLookup);
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log(`\n=== codemod-cleave-A ${DRY ? "(DRY RUN)" : "(LIVE)"} ===\n`);

  const moveLookup = buildMoveLookup();

  console.log(`Total planned moves: ${moveLookup.size}`);

  // Phase 1: Symbol splits
  await executeSplits();

  // Phase 2: Physical file moves
  await executeMoves(moveLookup);

  // Phase 3: Deletions
  await executeDeletes();

  // Phase 4: Import rewrites
  await executeImportRewrites(moveLookup);

  // Summary
  console.log("\n=== SUMMARY ===");
  console.log(`  Files moved:          ${totalMoved} (${totalSkipped} skipped/missing)`);
  console.log(`  Files deleted:        ${totalDeleted}`);
  console.log(`  Files imports rewritten: ${totalFilesModified}`);

  if (unresolvableImports.length > 0) {
    const top10 = unresolvableImports.slice(0, 10);
    console.log(`\n  Unresolvable imports (top ${top10.length}):`);
    for (const u of top10) {
      console.log(`    ${relative(ROOT, u.file)}: "${u.spec}"`);
    }
  } else {
    console.log("  Unresolvable imports: 0");
  }

  console.log("\n=== ESCALATION ITEMS (require Opus decision before proceeding) ===");
  for (const item of ESCALATION_ITEMS) {
    console.log(`  ⚠️  ${item}`);
  }

  console.log("\n=== DONE ===\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
