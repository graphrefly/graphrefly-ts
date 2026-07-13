import { execFileSync } from "node:child_process";
import {
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PKG = join(ROOT, "packages", "ts");
const TSC = join(ROOT, "node_modules", ".bin", "tsc");
const packageJson = JSON.parse(readFileSync(join(PKG, "package.json"), "utf8"));
const optionalPeers = [
	"@nestjs/common",
	"@nestjs/core",
	"@nestjs/microservices",
	"@nestjs/websockets",
	"canvas",
	"react",
	"rxjs",
	"solid-js",
	"svelte",
	"vue",
];

const expectedSubpaths = {
	"./adapters": {
		present: [
			"CanonicalProtobufError",
			"decodeCanonicalWireBridgeEnvelope",
			"decodeCanonicalWireEdgeFrame",
			"encodeCanonicalWireBridgeEnvelope",
			"encodeCanonicalWireEdgeFrame",
			"wireBridgeProtobuf",
			"subscribeNodeValues",
			"readableStore",
			"writableStore",
			"externalStore",
			"recordReadableStore",
			"memoryAgenticMemoryPassiveStoreFrameAdapter",
			"persistAgenticMemoryRecords",
			"openPersistentAgenticMemoryRecords",
			"loadAgenticMemoryRecordsState",
		],
		absent: [
			"useNodeValue",
			"useNodeInput",
			"useNodeRecord",
			"createNodeValue",
			"createNodeInput",
			"createNodeRecord",
			"nodeReadable",
			"nodeWritable",
			"nodeRecord",
			"fromNestReq",
			"toNestHttp",
		],
	},
	"./adapters/nestjs": {
		present: [
			"fromNestReq",
			"fromNestGuard",
			"fromNestIntercept",
			"fromNestError",
			"fromNestLifecycle",
			"fromNestCron",
			"toNestHttp",
			"GraphReq",
			"GraphGuard",
			"GraphIntercept",
			"GraphError",
			"GraphLifecycle",
			"GraphCron",
			"GraphHttpReply",
			"createNestGraphBoundaryRunner",
			"createNestGraphBoundaryInterceptor",
			"getNestBoundaryToken",
		],
		absent: [],
	},
	"./adapters/nestjs/native": {
		present: [
			"provideGraphBoundaryInterceptor",
			"provideGraphGuard",
			"provideGraphExceptionFilter",
			"provideGraphCronScheduler",
			"provideGraphLifecycleHooks",
			"provideGraphGuardDeniedFilter",
		],
		absent: [],
	},
	"./adapters/nestjs/websockets": {
		present: [
			"fromNestWs",
			"GraphWs",
			"GraphWsAck",
			"GraphWsReply",
			"createGraphWsBridge",
			"provideGraphWsBridge",
		],
		absent: ["fromNestMessage", "GraphMessage", "GraphMessageReply"],
	},
	"./adapters/nestjs/microservices": {
		present: [
			"fromNestMessage",
			"GraphMessage",
			"GraphMessageReply",
			"createGraphMessageBridge",
			"provideGraphMessageBridge",
		],
		absent: ["fromNestWs", "GraphWs", "GraphWsAck", "GraphWsReply"],
	},
	"./adapters/react": { present: ["useNodeValue", "useNodeInput", "useNodeRecord"], absent: [] },
	"./adapters/vue": { present: ["useNodeValue", "useNodeInput", "useNodeRecord"], absent: [] },
	"./adapters/solid": {
		present: ["createNodeValue", "createNodeInput", "createNodeRecord"],
		absent: [],
	},
	"./adapters/svelte": { present: ["nodeReadable", "nodeWritable", "nodeRecord"], absent: [] },
	"./cqrs/messaging": { present: ["cqrsMessagingRecipe"], absent: [] },
	"./cqrs/work-queue": { present: ["cqrsWorkQueueRecipe"], absent: [] },
	"./executors/tool-provider": {
		present: ["toolProviderExecutionRecipe"],
		absent: [],
	},
	"./executors/tool-provider-adapters": {
		present: [
			"localBuiltinToolProviderBinding",
			"localBuiltinToolProviderAdapterPack",
			"processToolProviderBinding",
			"processToolProviderAdapterPack",
			"processToolProviderCatalog",
			"httpToolProviderCatalog",
			"httpToolProviderRuntime",
		],
		absent: ["attachToolProviderAdapterRuntime", "toolProviderExecutionRecipe"],
	},
	"./executors/postgresql-tool-provider": {
		present: ["postgresqlToolProviderCatalog", "postgresqlToolProviderRuntime"],
		absent: [
			"attachToolProviderAdapterRuntime",
			"toolProviderExecutionRecipe",
			"httpToolProviderRuntime",
		],
	},
	"./executors/tool-provider-runtime": {
		present: ["attachToolProviderAdapterRuntime"],
		absent: [],
	},
	"./inspection/boundary": { present: ["boundaryManifest"], absent: [] },
	"./orchestration/messaging": { present: ["orchestrationMessagingRecipe"], absent: [] },
	"./orchestration/work-queue": { present: ["orchestrationWorkQueueRecipe"], absent: [] },
	"./memory": {
		present: ["validateMemoryFragment", "filterMemoryFragments", "memoryRetrievalBundle"],
		absent: ["agenticMemoryBundle", "workItemAuthoringProjector", "persistAgenticMemoryRecords"],
	},
	"./memory/semantic": {
		present: ["validateMemoryFragment", "filterMemoryFragments", "memoryRetrievalBundle"],
		absent: ["agenticMemoryBundle", "workItemAuthoringProjector", "persistAgenticMemoryRecords"],
	},
	"./scoring": {
		present: [
			"cosineSimilarity",
			"admissionScored",
			"admissionFilter3D",
			"scoreSubjects",
			"rankScoredSubjects",
			"normalizeScoreSignal",
			"isFiniteScore",
		],
		absent: ["memoryRetrievalBundle", "agenticMemoryBundle", "workItemAuthoringProjector"],
	},
	"./solutions/agentic-memory": {
		present: [
			"agenticMemoryBundle",
			"agenticMemoryRecordFrame",
			"agenticMemoryRetentionBundle",
			"admitAgenticMemoryRecordProposals",
			"agenticMemoryRecordAdmissionBundle",
			"projectAgenticMemoryRecordAdmissionPolicySource",
			"agenticMemoryRecordAdmissionPolicySourceBundle",
			"applyAgenticMemoryRecordAdmissions",
			"agenticMemoryRecordApplicationBundle",
			"projectAgenticMemoryRecordApplicationPriorEvidence",
			"projectAgenticMemoryRecordApplicationEvidenceFacts",
			"agenticMemoryRecordApplicationPriorEvidenceBundle",
			"agenticMemoryRecordApplicationEvidenceFactsBundle",
			"agenticMemoryConsolidationApplicationBundle",
			"agenticMemoryCommittedFactReadMaterializationBundle",
			"projectAgenticMemoryCommittedFactReadMaterialization",
			"agenticMemoryDurabilityGateBundle",
			"agenticMemoryDurabilityGateInput",
			"projectAgenticMemoryDurabilityGate",
			"agenticMemoryDurabilityResultMayAdvance",
			"agenticMemoryDurabilityAdvanceOnCommittedOrDuplicatePolicy",
			"agenticMemoryDurabilityUncertainResolutionStatus",
			"agenticMemoryCommittedFactLogStartupRead",
			"agenticMemoryCommittedFactLogAppendAttempt",
		],
		absent: [
			"workItemAuthoringProjector",
			"workItemEffectRunProjector",
			"persistAgenticMemoryRecords",
		],
	},
	"./solutions/agentic-work-item-memory": {
		present: ["mapAgenticWorkItemMemoryBridge", "agenticWorkItemMemoryBridgeBundle"],
		absent: [
			"agenticMemoryBundle",
			"mapAgenticWorkItemMemoryApplicationRecipe",
			"agenticWorkItemMemoryApplicationRecipeBundle",
			"workItemAuthoringProjector",
			"workItemEffectRunProjector",
			"persistAgenticMemoryRecords",
		],
	},
	"./solutions/agentic-work-item-memory-application": {
		present: [
			"mapAgenticWorkItemMemoryApplicationRecipe",
			"agenticWorkItemMemoryApplicationRecipeBundle",
		],
		absent: [
			"agenticMemoryBundle",
			"mapAgenticWorkItemMemoryBridge",
			"workItemAuthoringProjector",
			"persistAgenticMemoryRecords",
		],
	},
	"./solutions/work-item": {
		present: [
			"workItemAuthoringProjector",
			"workItemDomainActionAdmissionProjector",
			"workItemWorkQueueRecipe",
		],
		absent: ["agenticMemoryBundle", "workItemEffectRunProjector"],
	},
	"./solutions/work-item/scheduling": {
		present: [
			"isWorkspaceProposalProjectionReleaseMaterial",
			"validateWorkspaceProposalProjectionReleaseMaterial",
			"workspaceProposalProjectionReleaseDiagnosticProjector",
		],
		absent: [
			"genericFamilyFactReader",
			"readFamilyFact",
			"recordFamilyOutcome",
			"selectorAdapter",
			"selectorAdapterRegistry",
			"providerHandle",
			"storageHandle",
			"queryHandle",
			"opaqueProviderCursor",
			"providerCursor",
		],
	},
};

const forbiddenFrameworkSpecifiers = [
	'from "react"',
	"from 'react'",
	'require("react")',
	"require('react')",
	'from "vue"',
	"from 'vue'",
	'require("vue")',
	"require('vue')",
	'from "solid-js"',
	"from 'solid-js'",
	'require("solid-js")',
	"require('solid-js')",
	'from "svelte/store"',
	"from 'svelte/store'",
	'require("svelte/store")',
	"require('svelte/store')",
];

const rootAbsentExports = [
	"attachToolProviderAdapterRuntime",
	"toolProviderExecutionRecipe",
	"localBuiltinToolProviderBinding",
	"processToolProviderBinding",
	"httpToolProviderCatalog",
	"httpToolProviderRuntime",
	"useNodeValue",
	"useNodeInput",
	"useNodeRecord",
	"createNodeValue",
	"createNodeInput",
	"createNodeRecord",
	"nodeReadable",
	"nodeWritable",
	"nodeRecord",
	"boundaryManifest",
	"AGENTIC_MEMORY_RECORD_CHANGE_FORMAT",
	"AGENTIC_MEMORY_RECORD_SNAPSHOT_FORMAT",
	"AGENTIC_MEMORY_RECORD_STORAGE_FRAME_VERSION",
	"AGENTIC_MEMORY_PASSIVE_STORE_FRAME_CURSOR_KIND",
	"agenticMemoryRecordChangeFrame",
	"agenticMemoryRecordSnapshotFrame",
	"agenticMemoryRecordsSnapshotKey",
	"assertAgenticMemoryRecordChangeFrame",
	"assertAgenticMemoryRecordSnapshotFrame",
	"loadAgenticMemoryRecordsState",
	"memoryAgenticMemoryPassiveStoreFrameAdapter",
	"openPersistentAgenticMemoryRecords",
	"persistAgenticMemoryRecords",
	"isWorkspaceProposalProjectionReleaseMaterial",
	"validateWorkspaceProposalProjectionReleaseMaterial",
	"workspaceProposalProjectionReleaseDiagnosticProjector",
];

const rootAbsentTypeExports = [
	"BoundaryManifest",
	"BoundaryNode",
	"BoundaryRole",
	"InputBoundaryNode",
	"OutputBoundaryNode",
	"WorkspaceProposalProjectionRelease",
	"WorkspaceProposalProjectionReleaseDiagnostic",
	"WorkspaceProposalProjectionReleaseDiagnosticProjectorBundle",
	"WorkspaceProposalProjectionReleaseDiagnosticProjectorOptions",
	"WorkspaceProposalProjectionReleaseTargetKind",
	"WorkspaceProposalProjectionReleaseValidationResult",
	"AgenticMemoryPassiveStoreFrameAdapter",
	"AgenticMemoryPassiveStoreFrameAuditEntry",
	"AgenticMemoryPassiveStoreFrameCursor",
	"AgenticMemoryPassiveStoreFrameReadOptions",
	"AgenticMemoryPassiveStoreFrameReadResult",
	"AgenticMemoryPassiveStoreFrameStatus",
	"AgenticMemoryPassiveStoreFrameStatusState",
	"AgenticMemoryPassiveStoreFrameWriteResult",
	"AgenticMemoryRecordChangeFrame",
	"AgenticMemoryRecordSnapshotFrame",
	"AgenticMemoryRecordsPersistenceCursor",
	"AgenticMemoryRecordsPersistenceError",
	"AgenticMemoryRecordsPersistenceHandle",
	"AgenticMemoryRecordsPersistenceStatus",
	"AgenticMemoryRecordsRestoreState",
	"LoadAgenticMemoryRecordsStateOptions",
	"OpenPersistentAgenticMemoryRecordsOptions",
	"PersistAgenticMemoryRecordsOptions",
	"PersistentAgenticMemoryRecords",
];

function fail(message) {
	console.error(`check-ts-package-exports: ${message}`);
	process.exit(1);
}

function assert(condition, message) {
	if (!condition) fail(message);
}

function exportTarget(subpath, condition, key) {
	const entry = packageJson.exports?.[subpath]?.[condition]?.[key];
	assert(typeof entry === "string", `${subpath} missing exports.${condition}.${key}`);
	return join(PKG, entry);
}

function errorOutput(err) {
	const stdout =
		typeof err.stdout === "string"
			? err.stdout
			: Buffer.isBuffer(err.stdout)
				? err.stdout.toString("utf8")
				: "";
	const stderr =
		typeof err.stderr === "string"
			? err.stderr
			: Buffer.isBuffer(err.stderr)
				? err.stderr.toString("utf8")
				: "";
	return `${stdout}${stderr}`;
}

function validateExportTree(value, path) {
	if (typeof value === "string") {
		assert(value.startsWith("./"), `${path} must be a package-relative target`);
		assert(existsSync(join(PKG, value)), `${path} target missing: ${value}`);
		return;
	}
	assert(
		value !== null && typeof value === "object",
		`${path} must be a string or condition object`,
	);
	for (const [key, child] of Object.entries(value)) {
		validateExportTree(child, `${path}.${key}`);
	}
}

function expectTscFailure(tmp, file, expectedNames) {
	const config = `tsconfig.${file}.json`;
	writeFileSync(
		join(tmp, config),
		JSON.stringify(
			{
				compilerOptions: {
					target: "ES2022",
					module: "NodeNext",
					moduleResolution: "NodeNext",
					strict: true,
					noEmit: true,
					skipLibCheck: true,
				},
				include: [file],
			},
			null,
			"\t",
		),
	);
	try {
		execFileSync(TSC, ["-p", config], { cwd: tmp, stdio: "pipe" });
		fail(`${file} unexpectedly typechecked; forbidden type-only exports leaked`);
	} catch (e) {
		const out = errorOutput(e);
		for (const name of expectedNames) {
			assert(
				out.includes(name),
				`${file} failed for an unexpected reason; missing diagnostic for ${name}`,
			);
		}
	}
}

validateExportTree(packageJson.exports, "exports");

for (const subpath of Object.keys(expectedSubpaths)) {
	assert(packageJson.exports?.[subpath] !== undefined, `${subpath} missing from package exports`);
	for (const [condition, extension] of [
		["import", ".js"],
		["require", ".cjs"],
	]) {
		const runtimeTarget = exportTarget(subpath, condition, "default");
		assert(
			existsSync(runtimeTarget),
			`${subpath} ${condition} runtime target missing: ${runtimeTarget}`,
		);
		assert(
			runtimeTarget.endsWith(extension),
			`${subpath} ${condition} runtime target should end with ${extension}`,
		);
		const typeTarget = exportTarget(subpath, condition, "types");
		assert(existsSync(typeTarget), `${subpath} ${condition} type target missing: ${typeTarget}`);
	}
}

for (const peer of optionalPeers) {
	assert(
		packageJson.peerDependencies?.[peer] !== undefined,
		`optional peer ${peer} missing from peerDependencies`,
	);
	assert(
		packageJson.peerDependenciesMeta?.[peer]?.optional === true,
		`optional peer ${peer} missing peerDependenciesMeta optional:true`,
	);
}

for (const rel of [
	"dist/index.js",
	"dist/index.cjs",
	"dist/adapters/index.js",
	"dist/adapters/index.cjs",
]) {
	const file = join(PKG, rel);
	assert(existsSync(file), `${rel} missing; run pnpm --filter @graphrefly/ts build`);
	const text = readFileSync(file, "utf8");
	for (const specifier of forbiddenFrameworkSpecifiers) {
		assert(
			!text.includes(specifier),
			`${rel} imports framework peer through the universal/adapters build: ${specifier}`,
		);
	}
}

const tmp = mkdtempSync(join(tmpdir(), "graphrefly-ts-export-smoke-"));

try {
	mkdirSync(join(tmp, "node_modules", "@graphrefly"), { recursive: true });
	const tmpPkg = join(tmp, "node_modules", "@graphrefly", "ts");
	mkdirSync(tmpPkg, { recursive: true });
	cpSync(join(PKG, "package.json"), join(tmpPkg, "package.json"));
	cpSync(join(PKG, "dist"), join(tmpPkg, "dist"), { recursive: true });
	for (const peer of optionalPeers) {
		const realPeer = join(ROOT, "node_modules", peer);
		if (existsSync(realPeer)) {
			const link = join(tmp, "node_modules", peer);
			mkdirSync(dirname(link), { recursive: true });
			symlinkSync(realPeer, link, "dir");
		}
	}
	writeFileSync(
		join(tmp, "package.json"),
		JSON.stringify({ type: "module", private: true }, null, "\t"),
	);

	const rootAbsentChecks = rootAbsentExports
		.map(
			(name) =>
				`assert(!Object.hasOwn(root, ${JSON.stringify(name)}), ${JSON.stringify(`@graphrefly/ts must not export ${name}`)});`,
		)
		.join("\n");

	const runtimeAssertions = `{
	const root = await load("@graphrefly/ts");
	${rootAbsentChecks}
}
${Object.entries(expectedSubpaths)
	.map(([subpath, { present, absent }]) => {
		const specifier = `@graphrefly/ts${subpath.slice(1)}`;
		const presentChecks = present
			.map(
				(name) =>
					`assert(typeof mod[${JSON.stringify(name)}] === "function", ${JSON.stringify(`${specifier}.${name}`)});`,
			)
			.join("\n");
		const absentChecks = absent
			.map(
				(name) =>
					`assert(!Object.hasOwn(mod, ${JSON.stringify(name)}), ${JSON.stringify(`${specifier} must not export ${name}`)});`,
			)
			.join("\n");
		return `{
	const mod = await load(${JSON.stringify(specifier)});
	${presentChecks}
	${absentChecks}
}`;
	})
	.join("\n")}`;

	writeFileSync(
		join(tmp, "esm-smoke.mjs"),
		`import assert from "node:assert/strict";
const load = (specifier) => import(specifier);
${runtimeAssertions}
`,
	);

	writeFileSync(
		join(tmp, "cjs-smoke.cjs"),
		`const assert = require("node:assert/strict");
const load = (specifier) => require(specifier);
${runtimeAssertions.replaceAll("await load", "load")}
`,
	);

	writeFileSync(
		join(tmp, "types-smoke.mts"),
		`import { externalStore, readableStore, recordReadableStore, subscribeNodeValues, wireBridgeProtobuf, writableStore, type AgenticMemoryPassiveStoreFrameAdapter, type AgenticMemoryPassiveStoreFrameCursor, type AgenticMemoryPassiveStoreFrameReadResult, type AgenticMemoryPassiveStoreFrameStatus, type AgenticMemoryPassiveStoreFrameWriteResult, type WireBridgeProtobufBundle, type WireBridgeProtobufData, type WireBridgeProtobufIssue, type WireBridgeProtobufOptions, type WireBridgeProtobufStatus } from "@graphrefly/ts/adapters";
import { useNodeInput, useNodeRecord, useNodeValue } from "@graphrefly/ts/adapters/react";
import { createNodeInput, createNodeRecord, createNodeValue } from "@graphrefly/ts/adapters/solid";
import { nodeReadable, nodeRecord, nodeWritable } from "@graphrefly/ts/adapters/svelte";
import { useNodeInput as useVueNodeInput, useNodeRecord as useVueNodeRecord, useNodeValue as useVueNodeValue } from "@graphrefly/ts/adapters/vue";
import {
	toolProviderExecutionRecipe,
	type ToolProviderExecutionRecipeBundle,
	type ToolProviderExecutionRecipeOptions,
} from "@graphrefly/ts/executors/tool-provider";
import {
	httpToolProviderCatalog,
	httpToolProviderRuntime,
	localBuiltinToolProviderAdapterPack,
	localBuiltinToolProviderBinding,
	processToolProviderAdapterPack,
	processToolProviderBinding,
	processToolProviderCatalog,
	type HttpToolProviderDriver,
	type HttpToolProviderRuntimeBundle,
	type HttpToolProviderRuntimeOptions,
	type LocalBuiltinToolProviderBindingOptions,
	type ProcessToolProviderBindingOptions,
} from "@graphrefly/ts/executors/tool-provider-adapters";
import {
	attachToolProviderAdapterRuntime,
	type ToolProviderAdapterBinding,
	type ToolProviderAdapterExecutionRetentionEntry,
	type ToolProviderAdapterInputRetentionEntry,
	type ToolProviderAdapterRunContext,
	type ToolProviderAdapterRunIssueRetentionEntry,
	type ToolProviderAdapterRunRequestRetentionEntry,
	type ToolProviderAdapterRunResult,
	type ToolProviderAdapterRunStatusRetentionEntry,
	type ToolProviderAdapterRuntimeHandle,
	type ToolProviderAdapterRuntimeIndexRetentionPolicy,
	type ToolProviderAdapterRuntimeOptions,
	type ToolProviderAdapterRuntimeRetentionEvidenceEntry,
	type ToolProviderAdapterRuntimeRetentionIndex,
	type ToolProviderAdapterRuntimeRetentionOrder,
	type ToolProviderAdapterRuntimeRetentionPolicy,
	type ToolProviderAdapterRuntimeStatus,
	type ToolProviderAdapterRuntimeStatusKind,
	type ToolProviderPublicTextPolicy,
} from "@graphrefly/ts/executors/tool-provider-runtime";
import { boundaryManifest, type BoundaryManifest, type BoundaryNode, type BoundaryRole } from "@graphrefly/ts/inspection/boundary";
import {
	validateMemoryFragment,
	type MemoryFragment as MemoryNamespaceFragment,
} from "@graphrefly/ts/memory";
import {
	memoryRetrievalBundle,
	type MemoryRetrievalBundleOptions,
} from "@graphrefly/ts/memory/semantic";
import {
	admissionScored,
	cosineSimilarity,
	isFiniteScore,
	normalizeScoreSignal,
	rankScoredSubjects,
	scoreSubjects,
	type ScoredSubject,
	type ScorePolicy,
	type ScoringPolicy,
	type ScoreSignal,
	type ScoreSubject,
} from "@graphrefly/ts/scoring";
import {
	AGENTIC_MEMORY_RECORD_APPLICATION_MATERIAL_IDENTITY_ALGORITHM,
	AGENTIC_MEMORY_DURABILITY_ADVANCE_ON_COMMITTED_OR_DUPLICATE_POLICY,
	admitAgenticMemoryRecordProposals,
	agenticMemoryBundle,
	agenticMemoryConsolidationApplicationBundle,
	agenticMemoryDurabilityAdvanceOnCommittedOrDuplicatePolicy,
	agenticMemoryDurabilityGateBundle,
	agenticMemoryDurabilityGateInput,
	projectAgenticMemoryDurabilityGate,
	agenticMemoryDurabilityResultMayAdvance,
	agenticMemoryDurabilityUncertainResolutionStatus,
	agenticMemoryCommittedFactLogAppendAttempt,
	agenticMemoryCommittedFactLogStartupRead,
	type AgenticMemoryCommittedFactLogAppendAttemptOptions,
	type AgenticMemoryCommittedFactLogAppendAttemptResult,
	type AgenticMemoryCommittedFactLogStartupReadOptions,
	type AgenticMemoryCommittedFactLogStartupReadResult,
	type AgenticMemoryDurabilityGateBundleOptions,
	type AgenticMemoryDurabilityGateInput,
	type AgenticMemoryBundleOptions as FocusedAgenticMemoryBundleOptions,
	type AgenticMemoryConsolidationApplicationBundle,
	type AgenticMemoryConsolidationApplicationBundleOptions,
	type AgenticMemoryRecord as FocusedAgenticMemoryRecord,
	agenticMemoryRecordAdmissionBundle,
	type AgenticMemoryRecordAdmissionPolicy,
	agenticMemoryRecordAdmissionPolicySourceBundle,
	projectAgenticMemoryRecordAdmissionPolicySource,
	agenticMemoryRecordApplicationBundle,
	type AgenticMemoryRecordApplicationBundleOptions,
	type AgenticMemoryRecordApplicationMaterialIdentity,
	type AgenticMemoryRecordApplicationOperationStatus,
	type AgenticMemoryRecordApplicationOptions,
	type AgenticMemoryRecordApplicationPolicy,
	type AgenticMemoryRecordApplicationPriorEvidence,
	applyAgenticMemoryRecordAdmissions,
} from "@graphrefly/ts/solutions/agentic-memory";
import {
	agenticWorkItemMemoryApplicationRecipeBundle,
	mapAgenticWorkItemMemoryApplicationRecipe,
	type AgenticWorkItemMemoryApplicationRecipeBundleOptions,
	type AgenticWorkItemMemoryApplicationRecipeResult,
} from "@graphrefly/ts/solutions/agentic-work-item-memory-application";
import {
	agenticWorkItemMemoryBridgeBundle,
	mapAgenticWorkItemMemoryBridge,
	type AgenticWorkItemMemoryBridgeResult,
	type AgenticWorkItemMemoryBridgeStatus,
	type AgenticWorkItemMemoryMappingPolicy,
	type AgenticWorkItemMemoryRecordCandidate,
} from "@graphrefly/ts/solutions/agentic-work-item-memory";
import {
	workItemAuthoringProjector,
	type WorkItemProjection,
} from "@graphrefly/ts/solutions/work-item";
import {
	isWorkspaceProposalProjectionReleaseMaterial,
	validateWorkspaceProposalProjectionReleaseMaterial,
	workspaceProposalProjectionReleaseDiagnosticProjector,
	type WorkspaceProposalProjectionRelease,
	type WorkspaceProposalProjectionReleaseDiagnostic,
	type WorkspaceProposalProjectionReleaseDiagnosticProjectorBundle,
	type WorkspaceProposalProjectionReleaseDiagnosticProjectorOptions,
	type WorkspaceProposalProjectionReleaseTargetKind,
	type WorkspaceProposalProjectionReleaseValidationResult,
} from "@graphrefly/ts/solutions/work-item/scheduling";

void externalStore;
void readableStore;
void recordReadableStore;
void subscribeNodeValues;
void wireBridgeProtobuf;
void writableStore;
void useNodeInput;
void useNodeRecord;
void useNodeValue;
void createNodeInput;
void createNodeRecord;
void createNodeValue;
void nodeReadable;
void nodeRecord;
void nodeWritable;
void useVueNodeInput;
void useVueNodeRecord;
void useVueNodeValue;
void toolProviderExecutionRecipe;
void attachToolProviderAdapterRuntime;
void httpToolProviderCatalog;
void httpToolProviderRuntime;
void localBuiltinToolProviderAdapterPack;
void localBuiltinToolProviderBinding;
void processToolProviderAdapterPack;
void processToolProviderBinding;
void processToolProviderCatalog;
void boundaryManifest;
void validateMemoryFragment;
void memoryRetrievalBundle;
void admissionScored;
void cosineSimilarity;
void isFiniteScore;
void normalizeScoreSignal;
void rankScoredSubjects;
void scoreSubjects;
void AGENTIC_MEMORY_RECORD_APPLICATION_MATERIAL_IDENTITY_ALGORITHM;
void AGENTIC_MEMORY_DURABILITY_ADVANCE_ON_COMMITTED_OR_DUPLICATE_POLICY;
void admitAgenticMemoryRecordProposals;
void agenticMemoryBundle;
void agenticMemoryConsolidationApplicationBundle;
void agenticMemoryDurabilityAdvanceOnCommittedOrDuplicatePolicy;
void agenticMemoryDurabilityGateBundle;
void agenticMemoryDurabilityGateInput;
void agenticMemoryDurabilityResultMayAdvance;
void agenticMemoryDurabilityUncertainResolutionStatus;
void agenticMemoryCommittedFactLogAppendAttempt;
void agenticMemoryCommittedFactLogStartupRead;
void agenticMemoryRecordAdmissionBundle;
void agenticMemoryRecordAdmissionPolicySourceBundle;
void agenticMemoryRecordApplicationBundle;
void applyAgenticMemoryRecordAdmissions;
void projectAgenticMemoryDurabilityGate;
void projectAgenticMemoryRecordAdmissionPolicySource;
void agenticWorkItemMemoryApplicationRecipeBundle;
void agenticWorkItemMemoryBridgeBundle;
void mapAgenticWorkItemMemoryApplicationRecipe;
void mapAgenticWorkItemMemoryBridge;
void workItemAuthoringProjector;
void isWorkspaceProposalProjectionReleaseMaterial;
void validateWorkspaceProposalProjectionReleaseMaterial;
void workspaceProposalProjectionReleaseDiagnosticProjector;

declare const manifest: BoundaryManifest;
const role: BoundaryRole = "input";
const node: BoundaryNode | undefined = manifest.inputs[0] ?? manifest.outputs[0];
declare const memoryNamespaceFragment: MemoryNamespaceFragment;
declare const memoryRetrievalOptions: MemoryRetrievalBundleOptions;
declare const scoringPolicy: ScoringPolicy;
declare const scorePolicy: ScorePolicy;
declare const scoreSignal: ScoreSignal;
declare const scoreSubject: ScoreSubject;
declare const scoredSubject: ScoredSubject;
declare const focusedAgenticMemoryBundleOptions: FocusedAgenticMemoryBundleOptions;
declare const focusedConsolidationApplicationBundle: AgenticMemoryConsolidationApplicationBundle;
declare const focusedConsolidationApplicationBundleOptions: AgenticMemoryConsolidationApplicationBundleOptions;
declare const factLogAppendAttemptOptions: AgenticMemoryCommittedFactLogAppendAttemptOptions;
declare const factLogAppendAttemptResult: AgenticMemoryCommittedFactLogAppendAttemptResult;
declare const factLogStartupReadOptions: AgenticMemoryCommittedFactLogStartupReadOptions;
declare const factLogStartupReadResult: AgenticMemoryCommittedFactLogStartupReadResult;
declare const durabilityGateBundleOptions: AgenticMemoryDurabilityGateBundleOptions;
declare const durabilityGateInput: AgenticMemoryDurabilityGateInput;
declare const focusedAgenticMemoryRecord: FocusedAgenticMemoryRecord;
declare const agenticMemoryRecordAdmissionPolicy: AgenticMemoryRecordAdmissionPolicy;
declare const agenticMemoryRecordApplicationPolicy: AgenticMemoryRecordApplicationPolicy;
declare const agenticMemoryRecordApplicationOptions: AgenticMemoryRecordApplicationOptions;
declare const agenticMemoryRecordApplicationBundleOptions: AgenticMemoryRecordApplicationBundleOptions;
declare const agenticMemoryRecordApplicationMaterialIdentity: AgenticMemoryRecordApplicationMaterialIdentity;
declare const agenticMemoryRecordApplicationOperationStatus: AgenticMemoryRecordApplicationOperationStatus;
declare const agenticMemoryRecordApplicationPriorEvidence: AgenticMemoryRecordApplicationPriorEvidence;
declare const agenticWorkItemMemoryApplicationRecipeBundleOptions: AgenticWorkItemMemoryApplicationRecipeBundleOptions;
declare const agenticWorkItemMemoryApplicationRecipeResult: AgenticWorkItemMemoryApplicationRecipeResult;
declare const agenticWorkItemMemoryBridgeResult: AgenticWorkItemMemoryBridgeResult;
declare const agenticWorkItemMemoryBridgeStatus: AgenticWorkItemMemoryBridgeStatus;
declare const agenticWorkItemMemoryMappingPolicy: AgenticWorkItemMemoryMappingPolicy;
declare const agenticWorkItemMemoryRecordCandidate: AgenticWorkItemMemoryRecordCandidate;
declare const workItemProjection: WorkItemProjection;
declare const recipeBundle: ToolProviderExecutionRecipeBundle;
declare const recipeOptions: ToolProviderExecutionRecipeOptions;
declare const runtimeBinding: ToolProviderAdapterBinding;
declare const runtimeExecutionRetentionEntry: ToolProviderAdapterExecutionRetentionEntry;
declare const runtimeInputRetentionEntry: ToolProviderAdapterInputRetentionEntry;
declare const runtimeRunContext: ToolProviderAdapterRunContext;
declare const runtimeRunIssueRetentionEntry: ToolProviderAdapterRunIssueRetentionEntry;
declare const runtimeRunRequestRetentionEntry: ToolProviderAdapterRunRequestRetentionEntry;
declare const runtimeRunResult: ToolProviderAdapterRunResult;
declare const runtimeRunStatusRetentionEntry: ToolProviderAdapterRunStatusRetentionEntry;
declare const runtimeHandle: ToolProviderAdapterRuntimeHandle;
declare const runtimeIndexRetentionPolicy: ToolProviderAdapterRuntimeIndexRetentionPolicy<unknown>;
declare const runtimeOptions: ToolProviderAdapterRuntimeOptions;
declare const runtimeRetentionEvidenceEntry: ToolProviderAdapterRuntimeRetentionEvidenceEntry;
declare const runtimeRetentionIndex: ToolProviderAdapterRuntimeRetentionIndex;
const runtimeRetentionOrder: ToolProviderAdapterRuntimeRetentionOrder = "fifo";
declare const runtimeRetentionPolicy: ToolProviderAdapterRuntimeRetentionPolicy;
declare const runtimeStatus: ToolProviderAdapterRuntimeStatus;
declare const runtimeStatusKind: ToolProviderAdapterRuntimeStatusKind;
declare const publicTextPolicy: ToolProviderPublicTextPolicy;
declare const httpDriver: HttpToolProviderDriver;
declare const httpRuntimeBundle: HttpToolProviderRuntimeBundle;
declare const httpRuntimeOptions: HttpToolProviderRuntimeOptions;
declare const localBindingOptions: LocalBuiltinToolProviderBindingOptions;
declare const processBindingOptions: ProcessToolProviderBindingOptions;
declare const projectionRelease: WorkspaceProposalProjectionRelease;
declare const projectionReleaseDiagnostic: WorkspaceProposalProjectionReleaseDiagnostic;
declare const projectionReleaseDiagnosticProjectorBundle: WorkspaceProposalProjectionReleaseDiagnosticProjectorBundle;
declare const projectionReleaseDiagnosticProjectorOptions: WorkspaceProposalProjectionReleaseDiagnosticProjectorOptions;
declare const projectionReleaseValidationResult: WorkspaceProposalProjectionReleaseValidationResult;
declare const protobufBundle: WireBridgeProtobufBundle;
	declare const protobufData: WireBridgeProtobufData;
	declare const protobufIssue: WireBridgeProtobufIssue;
	declare const protobufOptions: WireBridgeProtobufOptions;
	declare const protobufStatus: WireBridgeProtobufStatus;
	declare const passiveStoreFrameAdapter: AgenticMemoryPassiveStoreFrameAdapter;
	declare const passiveStoreFrameCursor: AgenticMemoryPassiveStoreFrameCursor;
	declare const passiveStoreFrameReadResult: AgenticMemoryPassiveStoreFrameReadResult;
	declare const passiveStoreFrameStatus: AgenticMemoryPassiveStoreFrameStatus;
	declare const passiveStoreFrameWriteResult: AgenticMemoryPassiveStoreFrameWriteResult;
	const projectionReleaseTargetKind: WorkspaceProposalProjectionReleaseTargetKind = "family-read-model-query";
void role;
void node;
void memoryNamespaceFragment;
void memoryRetrievalOptions;
void scoringPolicy;
void scorePolicy;
void scoreSignal;
void scoreSubject;
void scoredSubject;
void focusedAgenticMemoryBundleOptions;
void focusedConsolidationApplicationBundle;
void focusedConsolidationApplicationBundleOptions;
void factLogAppendAttemptOptions;
void factLogAppendAttemptResult;
void factLogStartupReadOptions;
void factLogStartupReadResult;
void durabilityGateBundleOptions;
void durabilityGateInput;
void focusedAgenticMemoryRecord;
void agenticMemoryRecordAdmissionPolicy;
void agenticMemoryRecordApplicationPolicy;
void agenticMemoryRecordApplicationOptions;
void agenticMemoryRecordApplicationBundleOptions;
void agenticMemoryRecordApplicationMaterialIdentity;
void agenticMemoryRecordApplicationOperationStatus;
void agenticMemoryRecordApplicationPriorEvidence;
void agenticWorkItemMemoryApplicationRecipeBundleOptions;
void agenticWorkItemMemoryApplicationRecipeResult;
void agenticWorkItemMemoryBridgeResult;
void agenticWorkItemMemoryBridgeStatus;
void agenticWorkItemMemoryMappingPolicy;
void agenticWorkItemMemoryRecordCandidate;
void workItemProjection;
void recipeBundle;
void recipeOptions;
void runtimeBinding;
void runtimeExecutionRetentionEntry;
void runtimeInputRetentionEntry;
void runtimeRunContext;
void runtimeRunIssueRetentionEntry;
void runtimeRunRequestRetentionEntry;
void runtimeRunResult;
void runtimeRunStatusRetentionEntry;
void runtimeHandle;
void runtimeIndexRetentionPolicy;
void runtimeOptions;
void runtimeRetentionEvidenceEntry;
void runtimeRetentionIndex;
void runtimeRetentionOrder;
void runtimeRetentionPolicy;
void runtimeStatus;
void runtimeStatusKind;
void publicTextPolicy;
void httpDriver;
void httpRuntimeBundle;
void httpRuntimeOptions;
void localBindingOptions;
void processBindingOptions;
void projectionRelease;
void projectionReleaseDiagnostic;
void projectionReleaseDiagnosticProjectorBundle;
void projectionReleaseDiagnosticProjectorOptions;
void projectionReleaseValidationResult;
void projectionReleaseTargetKind;
void protobufBundle;
	void protobufData;
	void protobufIssue;
	void protobufOptions;
	void protobufStatus;
	void passiveStoreFrameAdapter;
	void passiveStoreFrameCursor;
	void passiveStoreFrameReadResult;
	void passiveStoreFrameStatus;
	void passiveStoreFrameWriteResult;
	`,
	);
	const rootForbiddenNames = [...rootAbsentExports, ...rootAbsentTypeExports].join(", ");
	writeFileSync(
		join(tmp, "root-negative.mts"),
		`import type { ${rootForbiddenNames} } from "@graphrefly/ts";
`,
	);
	writeFileSync(
		join(tmp, "adapters-negative.mts"),
		`import type { useNodeValue, useNodeInput, useNodeRecord, createNodeValue, createNodeInput, createNodeRecord, nodeReadable, nodeWritable, nodeRecord, fromNestReq, toNestHttp } from "@graphrefly/ts/adapters";
`,
	);
	writeFileSync(
		join(tmp, "scheduling-negative.mts"),
		`import type { ${expectedSubpaths["./solutions/work-item/scheduling"].absent.join(", ")} } from "@graphrefly/ts/solutions/work-item/scheduling";
`,
	);

	writeFileSync(
		join(tmp, "tsconfig.json"),
		JSON.stringify(
			{
				compilerOptions: {
					target: "ES2022",
					module: "NodeNext",
					moduleResolution: "NodeNext",
					strict: true,
					noEmit: true,
					skipLibCheck: true,
				},
				include: ["types-smoke.mts"],
			},
			null,
			"\t",
		),
	);

	execFileSync(process.execPath, ["esm-smoke.mjs"], { cwd: tmp, stdio: "pipe" });
	execFileSync(process.execPath, ["cjs-smoke.cjs"], { cwd: tmp, stdio: "pipe" });
	execFileSync(TSC, ["-p", "tsconfig.json"], { cwd: tmp, stdio: "pipe" });
	expectTscFailure(tmp, "root-negative.mts", [...rootAbsentExports, ...rootAbsentTypeExports]);
	expectTscFailure(tmp, "adapters-negative.mts", expectedSubpaths["./adapters"].absent);
	expectTscFailure(
		tmp,
		"scheduling-negative.mts",
		expectedSubpaths["./solutions/work-item/scheduling"].absent,
	);
} catch (e) {
	fail(`${e.message ?? e}\n${errorOutput(e)}`.trim());
} finally {
	rmSync(tmp, { recursive: true, force: true });
}

console.log("check-ts-package-exports: package ESM/CJS/DTS subpath smoke passed");
