// ---------------------------------------------------------------------------
// Memory Tiers
// ---------------------------------------------------------------------------

import type { Node } from "../../../core/node.js";
import type { StorageHandle, StorageTier } from "../../../extra/storage-core.js";
import type { GraphAttachStorageOptions } from "../../../graph/graph.js";
import type { LightCollectionBundle } from "../../memory/index.js";

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
	archiveTier?: StorageTier;
	/** Options forwarded to `graph.attachStorage` for the archive tier. */
	archiveStorageOptions?: GraphAttachStorageOptions;
};

/** @internal */
export const DEFAULT_DECAY_RATE = Math.LN2 / (7 * 86_400); // 7-day half-life

export type MemoryTiersBundle<TMem> = {
	/** Permanent tier: never evicted. */
	readonly permanent: LightCollectionBundle<TMem>;
	/** Active entries node (reactive, holds ReadonlyMap). */
	readonly activeEntries: Node<unknown>;
	/** Archive storage handle (null if no tier configured). */
	readonly archiveHandle: StorageHandle | null;
	/** Classify a key into its current tier. */
	tierOf: (key: string) => MemoryTier;
	/** Move a key to the permanent tier. */
	markPermanent: (key: string, value: TMem) => void;
};
