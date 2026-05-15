/**
 * emitToMeta — forward DATA to a meta companion node via tier-3 deferral.
 *
 * Extracted from patterns/_internal/index.ts during cleave A2.
 */

import type { Node } from "@graphrefly/pure-ts/core";
import { DATA, defaultConfig, downWithBatch } from "@graphrefly/pure-ts/core";

// emitToMeta
// ---------------------------------------------------------------------------

/**
 * Forward a single `[DATA, value]` to a meta companion node via tier-3
 * deferral, tolerating absent companions. Used by patterns that publish
 * per-wave statistics alongside their main output (cache-hit-rate,
 * segment-count, layout-time-ns, etc.) — subscribers see the parent's
 * DATA first because phase-2 completes before phase-3 during drain.
 *
 * // Expands to: `if (meta) downWithBatch(meta, [[Type, value]])` with null-guard.
 *
 * @internal
 */
export function emitToMeta<T>(metaNode: Node<T> | undefined, value: T): void {
	if (metaNode == null) return;
	downWithBatch((msgs) => metaNode.down(msgs), [[DATA, value]], defaultConfig.tierOf);
}

// ---------------------------------------------------------------------------
