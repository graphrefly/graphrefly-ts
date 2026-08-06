import ts from "typescript";
import { empiricalStrictJsonDigest, strictSnapshot } from "./canonical.js";

export const D683_SOURCE_AUDIT_VERSION = "graphrefly-orchestration-source-audit.d683.v2";
export const D683_DEPENDENCY_EXTENSION_SHARED_MARKER = "D683_DEPENDENCY_EXTENSION:shared-contract";
export const D683_DEPENDENCY_EXTENSION_TEST_MARKER = "D683_DEPENDENCY_EXTENSION:test";
export const D683_QA_CORRECTION_MARKER = "D683_QA_CORRECTION:duplicate-admission";

const MAX_SOURCE_BYTES = 524_288;
const MAX_PATCH_BYTES = 262_144;
const MUTATING_COLLECTION_METHODS = new Set([
	"add",
	"clear",
	"delete",
	"pop",
	"push",
	"set",
	"shift",
	"splice",
	"unshift",
]);

export interface D683CoordinatorSourceInput {
	readonly path: string;
	readonly source: string;
	readonly functionNames: readonly string[];
}

export interface D683DependencyExtensionPatchInput {
	readonly baselineCommit: string;
	readonly patch: string;
	readonly measuredTargetPaths: readonly string[];
}

export interface D683CoordinatorSourceAudit {
	readonly path: string;
	readonly entryFunctionNames: readonly string[];
	readonly functionNames: readonly string[];
	readonly sourceDigest: string;
	readonly sourceLineCount: number;
	readonly mutatedLocalCollectionBindingCount: number;
	readonly conditionalSyntaxNodeCount: number;
}

export interface D683ChangeSurfaceBucket {
	readonly fileCount: number;
	readonly hunkCount: number;
	readonly testCount: number;
	readonly changedPaths: readonly string[];
}

export interface D683DependencyExtensionChangeSurface {
	readonly measurementStatus: "collected";
	readonly preregisteredCoordinatorExpectationMet: boolean;
	readonly baselineCommit: string;
	readonly patchDigest: string;
	readonly commandRevision: "git-diff-no-ext-no-textconv-unified0-myers-no-renames.v1";
	readonly markers: {
		readonly sharedContract: typeof D683_DEPENDENCY_EXTENSION_SHARED_MARKER;
		readonly test: typeof D683_DEPENDENCY_EXTENSION_TEST_MARKER;
		readonly qaCorrection: typeof D683_QA_CORRECTION_MARKER;
	};
	readonly total: D683ChangeSurfaceBucket;
	readonly sharedContractOrFixture: D683ChangeSurfaceBucket;
	readonly graphreflyCoordinator: D683ChangeSurfaceBucket;
	readonly plainTypescriptCoordinator: D683ChangeSurfaceBucket;
	readonly tests: D683ChangeSurfaceBucket;
	readonly excludedMeasurementInfrastructure: D683ChangeSurfaceBucket;
	readonly excludedQaCorrections: D683ChangeSurfaceBucket;
}

export interface D683SourceAuditEvidenceV1 {
	readonly version: typeof D683_SOURCE_AUDIT_VERSION;
	readonly parserRevision: string;
	readonly coordinationPolicy: "ast-local-call-closure-syntactic-proxies.v2";
	readonly metricKind: "auxiliary-syntactic-proxy";
	readonly graphrefly: D683CoordinatorSourceAudit;
	readonly plainTypescript: D683CoordinatorSourceAudit;
	readonly extensionChangeSurface: D683DependencyExtensionChangeSurface;
	readonly evidenceDigest: string;
}

const D683_QUALIFIED_COORDINATES_DIGEST =
	"sha256:13858430ed270fec1951cbee0fd5c1228681024974439c62400cd2dfc80dd022";

export function validateD683QualifiedEvidenceCoordinates(
	coordinates: unknown,
	evidence: D683SourceAuditEvidenceV1,
): string {
	const snapshot = strictSnapshot(coordinates);
	const digest = empiricalStrictJsonDigest(snapshot);
	if (digest !== D683_QUALIFIED_COORDINATES_DIGEST) {
		throw new TypeError("D683 qualified evidence coordinates digest mismatch");
	}
	const expected = snapshot as {
		readonly parserRevision: string;
		readonly sourceAuditEvidenceDigest: string;
		readonly graphrefly: D683CoordinatorSourceAudit;
		readonly plainTypescript: D683CoordinatorSourceAudit;
		readonly extensionPatchDigest: string;
	};
	const { evidenceDigest, ...evidenceWithoutDigest } = evidence;
	if (
		empiricalStrictJsonDigest(evidenceWithoutDigest) !== evidenceDigest ||
		evidence.parserRevision !== expected.parserRevision ||
		evidenceDigest !== expected.sourceAuditEvidenceDigest ||
		empiricalStrictJsonDigest(evidence.graphrefly) !==
			empiricalStrictJsonDigest(expected.graphrefly) ||
		empiricalStrictJsonDigest(evidence.plainTypescript) !==
			empiricalStrictJsonDigest(expected.plainTypescript) ||
		evidence.extensionChangeSurface.patchDigest !== expected.extensionPatchDigest
	) {
		throw new TypeError("D683 source audit does not match its qualified coordinates");
	}
	return digest;
}

function utf8Bytes(value: string): number {
	return new TextEncoder().encode(value).byteLength;
}

function portablePath(value: string, field: string): string {
	if (
		value.length === 0 ||
		value.length > 512 ||
		value.startsWith("/") ||
		value.includes("\\") ||
		value.split("/").some((part) => part.length === 0 || part === "." || part === "..") ||
		[...value].some((character) => {
			const code = character.charCodeAt(0);
			return code < 32 || code === 127;
		})
	) {
		throw new TypeError(`${field} must be a bounded repository-relative path`);
	}
	return value;
}

function portableIdentifier(value: string, field: string): string {
	if (!/^[A-Za-z_$][A-Za-z0-9_$]{0,127}$/.test(value)) {
		throw new TypeError(`${field} must be a bounded TypeScript identifier`);
	}
	return value;
}

function collectionInitializer(node: ts.Expression | undefined): boolean {
	if (node === undefined) return false;
	if (ts.isArrayLiteralExpression(node)) return true;
	return (
		ts.isNewExpression(node) &&
		ts.isIdentifier(node.expression) &&
		["Array", "Map", "Set", "WeakMap", "WeakSet"].includes(node.expression.text)
	);
}

function findNamedFunction(
	sourceFile: ts.SourceFile,
	functionName: string,
): ts.FunctionDeclaration {
	const matches: ts.FunctionDeclaration[] = [];
	const visit = (node: ts.Node): void => {
		if (ts.isFunctionDeclaration(node) && node.name?.text === functionName) matches.push(node);
		ts.forEachChild(node, visit);
	};
	visit(sourceFile);
	if (matches.length !== 1) {
		throw new TypeError(`D683 source audit requires exactly one function named ${functionName}`);
	}
	return matches[0]!;
}

function localFunctionClosure(
	sourceFile: ts.SourceFile,
	entryFunctionNames: readonly string[],
): readonly ts.FunctionDeclaration[] {
	const localFunctions = new Map<string, ts.FunctionDeclaration>();
	for (const statement of sourceFile.statements) {
		if (ts.isFunctionDeclaration(statement) && statement.name !== undefined) {
			localFunctions.set(statement.name.text, statement);
		}
	}
	const selected = new Set<string>();
	const pending = [...entryFunctionNames];
	while (pending.length > 0) {
		const name = pending.shift()!;
		if (selected.has(name)) continue;
		const target = localFunctions.get(name);
		if (target === undefined) {
			throw new TypeError(
				`D683 source audit requires exactly one top-level function named ${name}`,
			);
		}
		selected.add(name);
		const visit = (node: ts.Node): void => {
			if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
				const called = node.expression.text;
				if (localFunctions.has(called) && !selected.has(called)) pending.push(called);
			}
			ts.forEachChild(node, visit);
		};
		visit(target);
	}
	return [...selected]
		.map((name) => localFunctions.get(name)!)
		.sort((left, right) => left.getStart(sourceFile) - right.getStart(sourceFile));
}

function auditFunction(
	sourceFile: ts.SourceFile,
	target: ts.FunctionDeclaration,
): {
	readonly sourceLineCount: number;
	readonly mutatedLocalCollectionBindingCount: number;
	readonly conditionalSyntaxNodeCount: number;
} {
	const collectionNames = new Set<string>();
	const mutatedNames = new Set<string>();
	let conditionalSyntaxNodeCount = 0;
	const visit = (node: ts.Node): void => {
		if (
			ts.isVariableDeclaration(node) &&
			ts.isIdentifier(node.name) &&
			collectionInitializer(node.initializer)
		) {
			if (collectionNames.has(node.name.text)) {
				throw new TypeError("D683 source audit rejects shadowed mutable collection names");
			}
			collectionNames.add(node.name.text);
		}
		if (
			ts.isCallExpression(node) &&
			ts.isPropertyAccessExpression(node.expression) &&
			ts.isIdentifier(node.expression.expression) &&
			MUTATING_COLLECTION_METHODS.has(node.expression.name.text)
		) {
			mutatedNames.add(node.expression.expression.text);
		}
		if (
			ts.isBinaryExpression(node) &&
			node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
			ts.isElementAccessExpression(node.left) &&
			ts.isIdentifier(node.left.expression)
		) {
			mutatedNames.add(node.left.expression.text);
		}
		if (
			ts.isIfStatement(node) ||
			ts.isConditionalExpression(node) ||
			ts.isCaseClause(node) ||
			ts.isDefaultClause(node)
		) {
			conditionalSyntaxNodeCount += 1;
		}
		ts.forEachChild(node, visit);
	};
	visit(target);
	const startLine = sourceFile.getLineAndCharacterOfPosition(target.getStart(sourceFile)).line;
	const endLine = sourceFile.getLineAndCharacterOfPosition(target.end).line;
	return {
		sourceLineCount: endLine - startLine + 1,
		mutatedLocalCollectionBindingCount: [...collectionNames].filter((name) =>
			mutatedNames.has(name),
		).length,
		conditionalSyntaxNodeCount,
	};
}

function auditCoordinator(input: D683CoordinatorSourceInput): D683CoordinatorSourceAudit {
	const path = portablePath(input.path, "d683.source.path");
	if (
		!Array.isArray(input.functionNames) ||
		input.functionNames.length < 1 ||
		input.functionNames.length > 8
	) {
		throw new TypeError("D683 source audit requires 1..8 function names");
	}
	const entryFunctionNames = input.functionNames.map((name) =>
		portableIdentifier(name, "d683.source.functionName"),
	);
	if (new Set(entryFunctionNames).size !== entryFunctionNames.length) {
		throw new TypeError("D683 source audit function names must be unique");
	}
	if (utf8Bytes(input.source) < 1 || utf8Bytes(input.source) > MAX_SOURCE_BYTES) {
		throw new TypeError("D683 source audit input exceeds its byte bound");
	}
	const sourceFile = ts.createSourceFile(
		path,
		input.source,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.TS,
	);
	const parseDiagnostics = (
		sourceFile as ts.SourceFile & { readonly parseDiagnostics: readonly ts.Diagnostic[] }
	).parseDiagnostics;
	if (parseDiagnostics.length > 0) {
		throw new TypeError("D683 source audit input must parse as TypeScript");
	}
	for (const name of entryFunctionNames) findNamedFunction(sourceFile, name);
	const selectedFunctions = localFunctionClosure(sourceFile, entryFunctionNames);
	const functionNames = selectedFunctions.map((target) => target.name!.text);
	const functionAudits = selectedFunctions.map((target) => auditFunction(sourceFile, target));
	return strictSnapshot({
		path,
		entryFunctionNames,
		functionNames,
		sourceDigest: empiricalStrictJsonDigest(input.source),
		sourceLineCount: functionAudits.reduce((sum, audit) => sum + audit.sourceLineCount, 0),
		mutatedLocalCollectionBindingCount: functionAudits.reduce(
			(sum, audit) => sum + audit.mutatedLocalCollectionBindingCount,
			0,
		),
		conditionalSyntaxNodeCount: functionAudits.reduce(
			(sum, audit) => sum + audit.conditionalSyntaxNodeCount,
			0,
		),
	});
}

function sortedUniquePaths(values: readonly string[], field: string): string[] {
	if (!Array.isArray(values) || values.length < 1 || values.length > 16) {
		throw new TypeError(`${field} must contain 1..16 paths`);
	}
	const out = values.map((value) => portablePath(value, field)).sort();
	if (new Set(out).size !== out.length) throw new TypeError(`${field} paths must be unique`);
	return out;
}

interface D683CoordinatorPathRanges {
	readonly path: string;
	readonly ranges: readonly { readonly startLine: number; readonly endLine: number }[];
}

function hunkTouchesRanges(
	header: string,
	ranges: readonly { readonly startLine: number; readonly endLine: number }[],
): boolean {
	const match = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(header);
	if (match === null) throw new TypeError("D683 extension patch hunk header is malformed");
	const startLine = Number(match[1]);
	const lineCount = match[2] === undefined ? 1 : Number(match[2]);
	const endLine = startLine + Math.max(lineCount, 1) - 1;
	return ranges.some((range) => startLine <= range.endLine && endLine >= range.startLine);
}

function coordinatorPathRanges(input: D683CoordinatorSourceInput): D683CoordinatorPathRanges {
	const sourceFile = ts.createSourceFile(
		input.path,
		input.source,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.TS,
	);
	const selected = localFunctionClosure(sourceFile, input.functionNames);
	return {
		path: input.path,
		ranges: selected.map((target) => ({
			startLine: sourceFile.getLineAndCharacterOfPosition(target.getStart(sourceFile)).line + 1,
			endLine: sourceFile.getLineAndCharacterOfPosition(target.end).line + 1,
		})),
	};
}

function auditExtensionPatch(
	input: D683DependencyExtensionPatchInput,
	coordinators: {
		readonly graphrefly: D683CoordinatorPathRanges;
		readonly plainTypescript: D683CoordinatorPathRanges;
	},
): D683DependencyExtensionChangeSurface {
	if (!/^[0-9a-f]{40}$/.test(input.baselineCommit)) {
		throw new TypeError("D683 extension baselineCommit must be an exact SHA-1 commit id");
	}
	if (utf8Bytes(input.patch) < 1 || utf8Bytes(input.patch) > MAX_PATCH_BYTES) {
		throw new TypeError("D683 extension patch exceeds its byte bound");
	}
	const expectedPaths = sortedUniquePaths(input.measuredTargetPaths, "d683.extension.target");
	const changedPaths = new Set<string>();
	const sharedPaths = new Set<string>();
	const graphreflyPaths = new Set<string>();
	const plainTypescriptPaths = new Set<string>();
	const testPaths = new Set<string>();
	const measurementInfrastructurePaths = new Set<string>();
	const qaCorrectionPaths = new Set<string>();
	const measuredHunks: string[] = [];
	let currentPath: string | undefined;
	let currentHunk: string[] = [];
	let sharedHunkCount = 0;
	let graphreflyHunkCount = 0;
	let plainTypescriptHunkCount = 0;
	let testHunkCount = 0;
	let measurementInfrastructureHunkCount = 0;
	let qaCorrectionHunkCount = 0;
	let testCount = 0;
	const isTestPath = (path: string): boolean =>
		path.includes("/__tests__/") || /\.test\.[cm]?[jt]sx?$/.test(path);
	const flushHunk = (): void => {
		if (currentPath === undefined || currentHunk.length === 0) return;
		const addedLines = currentHunk.filter(
			(line) => line.startsWith("+") && !line.startsWith("+++"),
		);
		const hasSharedMarker = addedLines.some((line) =>
			line.includes(D683_DEPENDENCY_EXTENSION_SHARED_MARKER),
		);
		const hasTestMarker = addedLines.some((line) =>
			line.includes(D683_DEPENDENCY_EXTENSION_TEST_MARKER),
		);
		const hasQaCorrectionMarker = addedLines.some((line) =>
			line.includes(D683_QA_CORRECTION_MARKER),
		);
		if ([hasSharedMarker, hasTestMarker, hasQaCorrectionMarker].filter(Boolean).length > 1) {
			throw new TypeError("D683 extension hunk cannot mix attribution markers");
		}
		const selectedPath = portablePath(currentPath, "d683.extension.patchPath");
		if (!expectedPaths.includes(selectedPath)) {
			throw new TypeError("D683 extension patch contains an unmeasured target path");
		}
		if (hasSharedMarker && isTestPath(selectedPath)) {
			throw new TypeError("D683 shared-contract marker must be in a non-test file");
		}
		if (hasTestMarker && !isTestPath(selectedPath)) {
			throw new TypeError("D683 test marker must be in a test file");
		}
		changedPaths.add(selectedPath);
		measuredHunks.push(`${selectedPath}\n${currentHunk.join("\n")}`);
		if (hasSharedMarker) {
			sharedPaths.add(selectedPath);
			sharedHunkCount += 1;
		} else if (hasTestMarker) {
			testPaths.add(selectedPath);
			testHunkCount += 1;
			testCount += addedLines.filter((line) => /^\+\s*(?:it|test)\s*\(/.test(line)).length;
		} else if (hasQaCorrectionMarker) {
			qaCorrectionPaths.add(selectedPath);
			qaCorrectionHunkCount += 1;
		} else if (isTestPath(selectedPath)) {
			measurementInfrastructurePaths.add(selectedPath);
			measurementInfrastructureHunkCount += 1;
		} else if (
			selectedPath === coordinators.graphrefly.path &&
			hunkTouchesRanges(currentHunk[0]!, coordinators.graphrefly.ranges)
		) {
			graphreflyPaths.add(selectedPath);
			graphreflyHunkCount += 1;
		} else if (
			selectedPath === coordinators.plainTypescript.path &&
			hunkTouchesRanges(currentHunk[0]!, coordinators.plainTypescript.ranges)
		) {
			plainTypescriptPaths.add(selectedPath);
			plainTypescriptHunkCount += 1;
		} else {
			measurementInfrastructurePaths.add(selectedPath);
			measurementInfrastructureHunkCount += 1;
		}
		currentHunk = [];
	};
	for (const line of input.patch.split("\n")) {
		const fileMatch = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
		if (fileMatch !== null) {
			flushHunk();
			if (fileMatch[1] !== fileMatch[2]) {
				throw new TypeError("D683 extension patch must not rename measured files");
			}
			currentPath = fileMatch[2];
			continue;
		}
		if (line.startsWith("@@ ")) {
			flushHunk();
			currentHunk = [line];
			continue;
		}
		if (currentHunk.length > 0) currentHunk.push(line);
	}
	flushHunk();
	if (
		!expectedPaths.includes(coordinators.graphrefly.path) ||
		!expectedPaths.includes(coordinators.plainTypescript.path)
	) {
		throw new TypeError("D683 extension targets must include both coordinator paths");
	}
	if (sharedHunkCount < 1 || testHunkCount < 1 || testCount < 1) {
		throw new TypeError(
			"D683 extension patch must contain separately marked source and test evidence",
		);
	}
	const bucket = (
		paths: ReadonlySet<string>,
		hunkCount: number,
		addedTestCount: number,
	): D683ChangeSurfaceBucket => ({
		fileCount: paths.size,
		hunkCount,
		testCount: addedTestCount,
		changedPaths: [...paths].sort(),
	});
	return strictSnapshot({
		measurementStatus: "collected" as const,
		preregisteredCoordinatorExpectationMet:
			graphreflyHunkCount === 0 && plainTypescriptHunkCount === 0,
		baselineCommit: input.baselineCommit,
		patchDigest: empiricalStrictJsonDigest(measuredHunks.sort()),
		commandRevision: "git-diff-no-ext-no-textconv-unified0-myers-no-renames.v1" as const,
		markers: {
			sharedContract: D683_DEPENDENCY_EXTENSION_SHARED_MARKER,
			test: D683_DEPENDENCY_EXTENSION_TEST_MARKER,
			qaCorrection: D683_QA_CORRECTION_MARKER,
		},
		total: bucket(
			new Set([...sharedPaths, ...graphreflyPaths, ...plainTypescriptPaths, ...testPaths]),
			sharedHunkCount + graphreflyHunkCount + plainTypescriptHunkCount + testHunkCount,
			testCount,
		),
		sharedContractOrFixture: bucket(sharedPaths, sharedHunkCount, 0),
		graphreflyCoordinator: bucket(graphreflyPaths, graphreflyHunkCount, 0),
		plainTypescriptCoordinator: bucket(plainTypescriptPaths, plainTypescriptHunkCount, 0),
		tests: bucket(testPaths, testHunkCount, testCount),
		excludedMeasurementInfrastructure: bucket(
			measurementInfrastructurePaths,
			measurementInfrastructureHunkCount,
			0,
		),
		excludedQaCorrections: bucket(qaCorrectionPaths, qaCorrectionHunkCount, 0),
	});
}

export function createD683SourceAuditEvidence(input: {
	readonly graphrefly: D683CoordinatorSourceInput;
	readonly plainTypescript: D683CoordinatorSourceInput;
	readonly extensionPatch: D683DependencyExtensionPatchInput;
}): D683SourceAuditEvidenceV1 {
	const withoutDigest: Omit<D683SourceAuditEvidenceV1, "evidenceDigest"> = {
		version: D683_SOURCE_AUDIT_VERSION,
		parserRevision: `typescript@${ts.version}`,
		coordinationPolicy: "ast-local-call-closure-syntactic-proxies.v2" as const,
		metricKind: "auxiliary-syntactic-proxy" as const,
		graphrefly: auditCoordinator(input.graphrefly),
		plainTypescript: auditCoordinator(input.plainTypescript),
		extensionChangeSurface: auditExtensionPatch(input.extensionPatch, {
			graphrefly: coordinatorPathRanges(input.graphrefly),
			plainTypescript: coordinatorPathRanges(input.plainTypescript),
		}),
	};
	return strictSnapshot({
		...withoutDigest,
		evidenceDigest: empiricalStrictJsonDigest(withoutDigest),
	});
}
