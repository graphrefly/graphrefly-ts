/**
 * Horizontal reusable graph patterns.
 *
 * Former preset material lands here only when it is not a vertical solution
 * and has been re-derived onto clean-slate APIs.
 */

export {
	type ProfileSummary,
	type ProfileSummaryNode,
	profileSummary,
} from "./inspection.js";
export {
	type AdmissionFilter,
	type AdmissionScore3DOptions,
	type AdmissionScoredOptions,
	type AdmissionScores,
	type AdmissionThresholds,
	admissionFilter3D,
	admissionScored,
	type CollectionEntry,
	type CollectionScoreFn,
	cosineSimilarity,
	type DecayPolicy,
	type FactId,
	type FactStore,
	filterMemoryFragments,
	isMemoryFragment,
	type MemoryAnswer,
	type MemoryFragment,
	type MemoryFragmentValidation,
	type MemoryQuery,
	memoryFragmentMatchesQuery,
	memoryFragmentValidAt,
	type OutcomeSignal,
	type RankedCollectionEntry,
	type RetrievalEntry,
	type RetrievalQuery,
	type RetrievalTrace,
	type ScoringPolicy,
	type ShardByTenantConfig,
	type ShardByTenantOptions,
	type ShardKey,
	type StoreReadHandle,
	shardByTenant,
	type VectorSearchResult,
	validateMemoryFragment,
} from "./semantic-memory.js";
