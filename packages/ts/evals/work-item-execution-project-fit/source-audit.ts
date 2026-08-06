import { createHash } from "node:crypto";
import ts from "typescript";
import type { D686Arm, D686Category } from "./contracts.js";

const MAX_SOURCE_BYTES = 524_288;
const FAVORABLE_CATEGORIES: readonly D686Category[] = [
	"dependency-rich-fan-out-fan-in",
	"failed-prerequisite-independent-branch-join",
	"provenance-and-fault-governance",
];

export interface D686SourceInput {
	readonly arm: D686Arm;
	readonly path: string;
	readonly source: string;
}

export interface D686CategorySurface {
	readonly arm: D686Arm;
	readonly category: D686Category;
	readonly coordinationStatementCount: number;
	readonly nonBlankSourceLines: number;
	readonly mutableReadinessBindings: number;
	readonly executionLoops: number;
}

function sourceDigest(source: string): string {
	return `sha256:${createHash("sha256").update(source).digest("hex")}`;
}

function occurrenceCount(source: string, marker: string): number {
	return source.split(marker).length - 1;
}

function markedSource(input: D686SourceInput, category: D686Category): string {
	const start = `D686_COORDINATOR:${input.arm}:${category}:START`;
	const end = `D686_COORDINATOR:${input.arm}:${category}:END`;
	if (occurrenceCount(input.source, start) !== 1 || occurrenceCount(input.source, end) !== 1) {
		throw new TypeError(`D686 requires one marker pair for ${input.arm}/${category}`);
	}
	const startIndex = input.source.indexOf(start) + start.length;
	const endIndex = input.source.indexOf(end);
	if (endIndex < startIndex) throw new TypeError("D686 coordinator markers are reversed");
	return input.source.slice(startIndex, endIndex);
}

function auditMarkedSource(input: D686SourceInput, category: D686Category): D686CategorySurface {
	const source = markedSource(input, category);
	const sourceFile = ts.createSourceFile(
		`${input.arm}-${category}.ts`,
		source,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.TS,
	);
	let coordinationStatementCount = 0;
	let mutableReadinessBindings = 0;
	let executionLoops = 0;
	const visit = (node: ts.Node): void => {
		if (ts.isStatement(node) && !ts.isBlock(node) && !ts.isEmptyStatement(node)) {
			coordinationStatementCount += 1;
		}
		if (
			ts.isVariableDeclaration(node) &&
			node.initializer !== undefined &&
			(ts.isArrayLiteralExpression(node.initializer) ||
				(ts.isNewExpression(node.initializer) &&
					ts.isIdentifier(node.initializer.expression) &&
					["Map", "Set"].includes(node.initializer.expression.text)))
		) {
			mutableReadinessBindings += 1;
		}
		if (
			ts.isForStatement(node) ||
			ts.isForInStatement(node) ||
			ts.isForOfStatement(node) ||
			ts.isWhileStatement(node) ||
			ts.isDoStatement(node)
		) {
			executionLoops += 1;
		}
		ts.forEachChild(node, visit);
	};
	visit(sourceFile);
	const nonBlankSourceLines = source
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line.length > 0 && !line.startsWith("//")).length;
	return {
		arm: input.arm,
		category,
		coordinationStatementCount,
		nonBlankSourceLines,
		mutableReadinessBindings,
		executionLoops,
	};
}

export function auditD686CoordinatorSources(inputs: readonly D686SourceInput[]): {
	readonly measurementQualified: false;
	readonly missingEvidence: readonly [
		"independent-arm-provenance-implementations",
		"committed-before-after-category-change-surfaces",
	];
	readonly sources: readonly {
		readonly arm: D686Arm;
		readonly path: string;
		readonly sourceDigest: string;
	}[];
	readonly surfaces: readonly D686CategorySurface[];
	readonly rawMarkerStrictlyLowerCategories: readonly D686Category[];
	readonly rawMarkerNonInferiorCategories: readonly D686Category[];
} {
	if (inputs.length !== 3 || new Set(inputs.map((input) => input.arm)).size !== 3) {
		throw new TypeError("D686 source audit requires exactly one source per arm");
	}
	for (const input of inputs) {
		if (new TextEncoder().encode(input.source).byteLength > MAX_SOURCE_BYTES) {
			throw new TypeError(`D686 source exceeds byte bound: ${input.path}`);
		}
	}
	const surfaces = inputs.flatMap((input) =>
		FAVORABLE_CATEGORIES.map((category) => auditMarkedSource(input, category)),
	);
	const strictlyLowerCategories: D686Category[] = [];
	const nonInferiorCategories: D686Category[] = [];
	for (const category of FAVORABLE_CATEGORIES) {
		const recipe = surfaces.find(
			(surface) => surface.arm === "default-recipe" && surface.category === category,
		)!;
		const plain = surfaces.find(
			(surface) => surface.arm === "plain-typescript" && surface.category === category,
		)!;
		if (recipe.coordinationStatementCount < plain.coordinationStatementCount) {
			strictlyLowerCategories.push(category);
		}
		if (recipe.coordinationStatementCount <= plain.coordinationStatementCount) {
			nonInferiorCategories.push(category);
		}
	}
	return {
		measurementQualified: false,
		missingEvidence: [
			"independent-arm-provenance-implementations",
			"committed-before-after-category-change-surfaces",
		],
		sources: inputs.map((input) => ({
			arm: input.arm,
			path: input.path,
			sourceDigest: sourceDigest(input.source),
		})),
		surfaces,
		rawMarkerStrictlyLowerCategories: strictlyLowerCategories,
		rawMarkerNonInferiorCategories: nonInferiorCategories,
	};
}

export function auditD686RecipeBoundaries(input: {
	readonly candidateSource: string;
	readonly recipeArmSource: string;
}): {
	readonly candidateSourceDigest: string;
	readonly handwrittenDependencyScheduler: boolean;
	readonly mutableReadinessTable: boolean;
	readonly executionAuthority: boolean;
	readonly linearControlExtraStateMachine: boolean;
} {
	const candidate = ts.createSourceFile(
		"work-item-execution.ts",
		input.candidateSource,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.TS,
	);
	const recipeArm = ts.createSourceFile(
		"recipe-arm.ts",
		input.recipeArmSource,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.TS,
	);
	let handwrittenDependencyScheduler = false;
	let mutableReadinessTable = false;
	let executionAuthority = false;
	let linearControlExtraStateMachine = false;
	const visitCandidate = (node: ts.Node): void => {
		if (
			ts.isIdentifier(node) &&
			["dependsOnMemberIds", "dependencyReady", "readyMembers", "topologicalSort"].includes(
				node.text,
			)
		) {
			handwrittenDependencyScheduler = true;
		}
		if (
			ts.isIdentifier(node) &&
			["readiness", "readyBy", "pendingByDependency"].includes(node.text)
		) {
			mutableReadinessTable = true;
		}
		if (ts.isCallExpression(node)) {
			if (
				ts.isIdentifier(node.expression) &&
				["fetch", "setTimeout", "setInterval", "retry"].includes(node.expression.text)
			) {
				executionAuthority = true;
			}
			if (
				ts.isPropertyAccessExpression(node.expression) &&
				["execute", "dispatch", "retry"].includes(node.expression.name.text)
			) {
				executionAuthority = true;
			}
		}
		ts.forEachChild(node, visitCandidate);
	};
	const visitRecipeArm = (node: ts.Node): void => {
		if (
			(ts.isNewExpression(node) &&
				ts.isIdentifier(node.expression) &&
				["Map", "Set"].includes(node.expression.text)) ||
			ts.isWhileStatement(node) ||
			ts.isSwitchStatement(node)
		) {
			linearControlExtraStateMachine = true;
		}
		ts.forEachChild(node, visitRecipeArm);
	};
	visitCandidate(candidate);
	visitRecipeArm(recipeArm);
	return {
		candidateSourceDigest: sourceDigest(input.candidateSource),
		handwrittenDependencyScheduler,
		mutableReadinessTable,
		executionAuthority,
		linearControlExtraStateMachine,
	};
}
