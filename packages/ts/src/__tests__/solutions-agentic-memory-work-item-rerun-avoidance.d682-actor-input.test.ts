import { describe, expect, it } from "vitest";
import {
	createD682MechanicalActorInput,
	D682_MECHANICAL_ACTOR_INPUT_SCHEMA,
	validateD682MechanicalActorInput,
} from "../../evals/empirical-memory-rerun-avoidance/d682-mechanical-qualification.js";

describe("D682 bounded generic mechanical actor input", () => {
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
});
