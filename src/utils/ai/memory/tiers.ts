// ---------------------------------------------------------------------------
// Memory Tiers
// ---------------------------------------------------------------------------

import type { Node } from "@graphrefly/pure-ts/core/node.js";
import type { SnapshotStorageTier, StorageHandle } from "@graphrefly/pure-ts/extra";
import type {
	GraphAttachStorageOptions,
	GraphCheckpointRecord,
} from "@graphrefly/pure-ts/graph/graph.js";
import { DEFAULT_DECAY_RATE } from "../../../extra/utils/decay.js";
import type { CollectionGraph } from "../../memory/index.js";

export type MemoryTier = "permanent" | "active" | "archived";

export type MemoryTiersOptions<TMem> = {
	/** Exponential decay rate per second for active tier.
	 *  Default: 7-day half-life ≈ ln(2)/(7×86400) ≈ 0.00000114. */
	decayRate?: number;
	/** Max entries in the active tier before archiving lowest-scored (default 1000). */
	maxActive?: number;
	/** Score threshold below which active entries get archived (default 0.1). */
	archiveThreshold?: number;
	/** Predicate: true → entry belongs in permanent tier (default: never). */
	permanentFilter?: (key: string, mem: TMem) => boolean;
	/** Storage tier for the archive. Omit to disable archiving. */
	archiveTier?: SnapshotStorageTier<GraphCheckpointRecord>;
	/** Options forwarded to `graph.attachSnapshotStorage` for the archive tier. */
	archiveStorageOptions?: GraphAttachStorageOptions;
};

// `DEFAULT_DECAY_RATE` is canonical at `extra/utils/decay.ts` (Tier 4.4
// Wave AM Unit 1). Re-exported here for backward-compat with existing
// `patterns/ai/memory/` consumers.
export { DEFAULT_DECAY_RATE };

export type MemoryTiersBundle<TMem> = {
	/**
	 * Permanent tier: never evicted. Backed by a `collection({ranked:false})`
	 * Graph (Tier 2.3 — was previously a `LightCollectionBundle`; the no-Graph
	 * bundle shape was folded into the unified `CollectionGraph`).
	 */
	readonly permanent: CollectionGraph<TMem>;
	/** Active entries node (reactive, holds ReadonlyMap). */
	readonly activeEntries: Node<unknown>;
	/** Archive storage handle (null if no tier configured). */
	readonly archiveHandle: StorageHandle | null;
	/** Classify a key into its current tier. */
	tierOf: (key: string) => MemoryTier;
	/** Move a key to the permanent tier. */
	markPermanent: (key: string, value: TMem) => void;
};
