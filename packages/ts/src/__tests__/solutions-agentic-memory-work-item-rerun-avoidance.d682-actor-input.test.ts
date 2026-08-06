import { describe, expect, it } from "vitest";
import { empiricalStrictJsonDigest } from "../../evals/empirical-memory-rerun-avoidance/canonical.js";
import { CLOSED_ACTOR_TOOL_REFS } from "../../evals/empirical-memory-rerun-avoidance/closed-task-profile-host.js";
import type {
	EmpiricalSchemaCatalogV1,
	EmpiricalStrictJsonShapeV1,
} from "../../evals/empirical-memory-rerun-avoidance/contracts.js";
import {
	createD682MechanicalActorInput,
	D682_MECHANICAL_ACTOR_INPUT_SCHEMA,
	hasQualifiedD682ActionSequence,
	specializeD682MechanicalToolSchemaCatalog,
	validateD682MechanicalActorInput,
	validateD682MechanicalToolContract,
} from "../../evals/empirical-memory-rerun-avoidance/d682-mechanical-qualification.js";
import { validateEmpiricalSchemaCatalog } from "../../evals/empirical-memory-rerun-avoidance/strict-json-shape.js";

describe("D682 bounded generic mechanical actor input", () => {
	const objectShape = (
		properties: readonly {
			readonly name: string;
			readonly required: boolean;
			readonly shape: EmpiricalStrictJsonShapeV1;
		}[],
	): EmpiricalStrictJsonShapeV1 => ({ kind: "object", properties, additionalProperties: false });
	const stringShape: EmpiricalStrictJsonShapeV1 = {
		kind: "string",
		minLength: 1,
		maxLength: 32_768,
		enum: null,
	};
	it("makes exact workspace-relative path, replacement, command, and order coordinates actor-visible", () => {
		const input = createD682MechanicalActorInput({
			workItemRef: "work-item-d682-fixture",
			instructionRef: "instruction-d682-fixture",
			readablePaths: ["README.md", "src/example.ts"],
			writablePaths: ["README.md"],
			commandRefs: ["actor.status"],
			path: "README.md",
			oldText: "broken-placeholder-value",
			newText: "fixed-placeholder-value",
		});

		expect(input).toEqual({
			schemaVersion: D682_MECHANICAL_ACTOR_INPUT_SCHEMA,
			workItemRef: "work-item-d682-fixture",
			instructionRef: "instruction-d682-fixture",
			taskKind: "replace-exact-workspace-text",
			pathMode: "workspace-relative",
			readablePaths: ["README.md", "src/example.ts"],
			writablePaths: ["README.md"],
			commandRefs: ["actor.status"],
			replacementProposal: {
				path: "README.md",
				oldText: "broken-placeholder-value",
				newText: "fixed-placeholder-value",
			},
			requiredExecutionOrder: [
				"read-file",
				"replace-exact",
				"workspace-diff",
				"run-command",
				"final",
			],
		});
		expect(Object.isFrozen(input)).toBe(true);
		expect(validateD682MechanicalActorInput(input)).toEqual(input);
	});

	it("requires the mechanical path in order while allowing bounded extra inspection", () => {
		const required = [
			CLOSED_ACTOR_TOOL_REFS.readFile,
			CLOSED_ACTOR_TOOL_REFS.replaceExact,
			CLOSED_ACTOR_TOOL_REFS.workspaceDiff,
			CLOSED_ACTOR_TOOL_REFS.runCommand,
		];
		expect(hasQualifiedD682ActionSequence(required)).toBe(true);
		expect(
			hasQualifiedD682ActionSequence([
				CLOSED_ACTOR_TOOL_REFS.searchLiteral,
				CLOSED_ACTOR_TOOL_REFS.readFile,
				CLOSED_ACTOR_TOOL_REFS.readFile,
				...required.slice(1),
			]),
		).toBe(true);
		expect(hasQualifiedD682ActionSequence(required.slice(0, -1))).toBe(false);
		expect(
			hasQualifiedD682ActionSequence([
				CLOSED_ACTOR_TOOL_REFS.replaceExact,
				CLOSED_ACTOR_TOOL_REFS.readFile,
				CLOSED_ACTOR_TOOL_REFS.workspaceDiff,
				CLOSED_ACTOR_TOOL_REFS.runCommand,
			]),
		).toBe(false);
		expect(
			hasQualifiedD682ActionSequence([
				CLOSED_ACTOR_TOOL_REFS.readFile,
				CLOSED_ACTOR_TOOL_REFS.replaceExact,
				CLOSED_ACTOR_TOOL_REFS.replaceExact,
				CLOSED_ACTOR_TOOL_REFS.workspaceDiff,
				CLOSED_ACTOR_TOOL_REFS.runCommand,
			]),
		).toBe(false);
	});

	it("rejects absolute, traversal, undeclared, duplicate, and oversized coordinates", () => {
		const valid = {
			workItemRef: "work-item-d682-fixture",
			instructionRef: "instruction-d682-fixture",
			readablePaths: ["README.md"],
			writablePaths: ["README.md"],
			commandRefs: ["actor.status"],
			path: "README.md",
			oldText: "old",
			newText: "new",
		};
		for (const path of [
			"/README.md",
			"../README.md",
			"src/../README.md",
			"README\\.md",
			"README.md\u0000suffix",
		]) {
			expect(() => createD682MechanicalActorInput({ ...valid, path })).toThrow(
				/portable|forbidden|backslash/,
			);
		}
		expect(() => createD682MechanicalActorInput({ ...valid, path: "other.md" })).toThrow(
			/exact declared writable path/,
		);
		expect(() =>
			createD682MechanicalActorInput({
				...valid,
				readablePaths: ["README.md", "README.md"],
			}),
		).toThrow(/bounded, unique/);
		expect(() => createD682MechanicalActorInput({ ...valid, oldText: "x".repeat(32_769) })).toThrow(
			/bounded generic fixture contract/,
		);
		expect(() =>
			validateD682MechanicalActorInput({
				...createD682MechanicalActorInput(valid),
				rawProviderResponse: "must-not-survive",
			}),
		).toThrow(/unexpected keys/);
	});

	it("freezes provider path and command enums to the same host-owned actor coordinates", () => {
		const actorInput = createD682MechanicalActorInput({
			workItemRef: "work-item-d682-fixture",
			instructionRef: "instruction-d682-fixture",
			readablePaths: ["README.md", "src/example.ts"],
			writablePaths: ["README.md"],
			commandRefs: ["actor.status"],
			path: "README.md",
			oldText: "broken-placeholder-value",
			newText: "fixed-placeholder-value",
		});
		const inputSchemas = new Map<string, EmpiricalStrictJsonShapeV1>([
			[
				CLOSED_ACTOR_TOOL_REFS.readFile,
				objectShape([{ name: "path", required: true, shape: stringShape }]),
			],
			[
				CLOSED_ACTOR_TOOL_REFS.searchLiteral,
				objectShape([
					{
						name: "maxMatches",
						required: true,
						shape: { kind: "integer", minimum: 1, maximum: 4_096 },
					},
					{ name: "path", required: true, shape: stringShape },
					{ name: "query", required: true, shape: stringShape },
				]),
			],
			[
				CLOSED_ACTOR_TOOL_REFS.replaceExact,
				objectShape([
					{ name: "newText", required: true, shape: stringShape },
					{ name: "oldText", required: true, shape: stringShape },
					{ name: "path", required: true, shape: stringShape },
				]),
			],
			[CLOSED_ACTOR_TOOL_REFS.workspaceDiff, objectShape([])],
			[
				CLOSED_ACTOR_TOOL_REFS.runCommand,
				objectShape([{ name: "commandRef", required: true, shape: stringShape }]),
			],
		]);
		const tools = Object.values(CLOSED_ACTOR_TOOL_REFS).map((toolRef) => {
			const inputSchema = inputSchemas.get(toolRef);
			if (inputSchema === undefined) throw new TypeError("missing test tool schema");
			return {
				toolRef,
				schemaRevision: "closed-task-tools.d682.v2",
				inputSchema,
				inputSchemaDigest: empiricalStrictJsonDigest(inputSchema),
			};
		});
		const catalog: EmpiricalSchemaCatalogV1 = {
			schemaVersion: "graphrefly.private-solution-eval.strict-json-shape.v1",
			catalogRevision: "closed-task-tools.d682.v2",
			tools,
			outputs: [
				{
					schemaRef: "output.d682.fixture",
					role: "actor",
					schemaRevision: "output.d682.fixture.v1",
					schema: objectShape([{ name: "summary", required: true, shape: stringShape }]),
					schemaDigest: empiricalStrictJsonDigest(
						objectShape([{ name: "summary", required: true, shape: stringShape }]),
					),
				},
			],
		};
		validateEmpiricalSchemaCatalog(catalog);

		const specialized = specializeD682MechanicalToolSchemaCatalog({
			catalog,
			actorInput,
			toolRefs: CLOSED_ACTOR_TOOL_REFS,
			sourceSchemaRevision: "closed-task-tools.d682.v2",
			schemaRevision: "closed-task-tools.d682.v3",
			maxSearchMatches: 32,
		});
		const propertyEnum = (toolRef: string, propertyName: string) => {
			const schema = specialized.tools.find((tool) => tool.toolRef === toolRef)?.inputSchema;
			if (schema?.kind !== "object") throw new TypeError("missing object tool schema");
			const property = schema.properties.find((candidate) => candidate.name === propertyName);
			return property?.shape.kind === "string" ? property.shape.enum : undefined;
		};
		const propertyShape = (toolRef: string, propertyName: string) => {
			const schema = specialized.tools.find((tool) => tool.toolRef === toolRef)?.inputSchema;
			if (schema?.kind !== "object") throw new TypeError("missing object tool schema");
			return schema.properties.find((candidate) => candidate.name === propertyName)?.shape;
		};

		expect(specialized.catalogRevision).toBe("closed-task-tools.d682.v3");
		expect(propertyEnum(CLOSED_ACTOR_TOOL_REFS.readFile, "path")).toEqual([
			"README.md",
			"src/example.ts",
		]);
		expect(propertyEnum(CLOSED_ACTOR_TOOL_REFS.searchLiteral, "path")).toEqual([
			"README.md",
			"src/example.ts",
		]);
		expect(propertyEnum(CLOSED_ACTOR_TOOL_REFS.replaceExact, "path")).toEqual(["README.md"]);
		expect(propertyEnum(CLOSED_ACTOR_TOOL_REFS.runCommand, "commandRef")).toEqual(["actor.status"]);
		expect(propertyShape(CLOSED_ACTOR_TOOL_REFS.searchLiteral, "maxMatches")).toEqual({
			kind: "integer",
			minimum: 1,
			maximum: 32,
		});
		expect(propertyShape(CLOSED_ACTOR_TOOL_REFS.replaceExact, "newText")).toEqual({
			kind: "string",
			minLength: 0,
			maxLength: 32_768,
			enum: null,
		});
		expect(
			specialized.tools.every((tool) => tool.schemaRevision === specialized.catalogRevision),
		).toBe(true);
		expect(
			specialized.tools.every(
				(tool) => tool.inputSchemaDigest === empiricalStrictJsonDigest(tool.inputSchema),
			),
		).toBe(true);
		expect(() =>
			validateD682MechanicalToolContract({
				tools: specialized.tools,
				actorInput,
				toolRefs: CLOSED_ACTOR_TOOL_REFS,
				schemaRevision: "closed-task-tools.d682.v3",
				maxSearchMatches: 32,
			}),
		).not.toThrow();

		const replacementIndex = catalog.tools.findIndex(
			(tool) => tool.toolRef === CLOSED_ACTOR_TOOL_REFS.replaceExact,
		);
		const replacement = catalog.tools[replacementIndex];
		if (replacement?.inputSchema.kind !== "object") {
			throw new TypeError("missing replacement fixture schema");
		}
		const substitutedSchema = objectShape([
			{ name: "baseContentDigest", required: false, shape: stringShape },
			...replacement.inputSchema.properties,
		]);
		const substitutedCatalog = {
			...catalog,
			tools: catalog.tools.map((tool, index) =>
				index === replacementIndex
					? {
							...tool,
							inputSchema: substitutedSchema,
							inputSchemaDigest: empiricalStrictJsonDigest(substitutedSchema),
						}
					: tool,
			),
		};
		expect(() =>
			specializeD682MechanicalToolSchemaCatalog({
				catalog: substitutedCatalog,
				actorInput,
				toolRefs: CLOSED_ACTOR_TOOL_REFS,
				sourceSchemaRevision: "closed-task-tools.d682.v2",
				schemaRevision: "closed-task-tools.d682.v3",
				maxSearchMatches: 32,
			}),
		).toThrow(/does not match/);
	});
});
