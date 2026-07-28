import { execFileSync } from "node:child_process";
import {
	chmodSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { empiricalSha256 } from "../../evals/empirical-memory-rerun-avoidance/canonical.js";
import {
	applyPrivateRepositoryOverlay,
	assertPortableRepositoryPath,
	createCanonicalRepositoryTreeMaterial,
	PRIVATE_REPOSITORY_OVERLAY_SCHEMA_VERSION,
	privateCanonicalRepositoryFiles,
	validatePrivateRepositoryOverlay,
} from "../../evals/empirical-memory-rerun-avoidance/canonical-repository-tree.js";
import {
	type ExactLocalSourceRepositoryCapabilityV1,
	materializeHistoryFreeSingleBaselineRepository,
	SingleBaselineRepositoryMaterializationError,
	type SingleBaselineWorkspaceAllocationV1,
	type SingleBaselineWorkspaceAllocatorCapabilityV1,
	verifySingleBaselineRepositoryClosure,
} from "../../evals/empirical-memory-rerun-avoidance/single-baseline-repository-node.js";

const temporaryRoots: string[] = [];
const encoder = new TextEncoder();

interface SourceFixture {
	readonly rootPath: string;
	readonly commitSha: string;
	readonly treeObjectId: string;
	readonly material: ReturnType<typeof createCanonicalRepositoryTreeMaterial>;
}

interface TrackingAllocator extends SingleBaselineWorkspaceAllocatorCapabilityV1 {
	readonly allocations: SingleBaselineWorkspaceAllocationV1[];
	readonly cleaned: SingleBaselineWorkspaceAllocationV1[];
}

afterEach(() => {
	for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function temporaryRoot(label: string): string {
	const root = mkdtempSync(join(tmpdir(), `graphrefly-b112-${label}-`));
	temporaryRoots.push(root);
	return root;
}

function git(rootPath: string, args: readonly string[], input?: string): string {
	return execFileSync("git", ["-C", rootPath, ...args], {
		encoding: "utf8",
		input,
		maxBuffer: 4 * 1024 * 1024,
	}).trim();
}

function sourceFixture(
	options: { readonly symlink?: boolean; readonly extraFiles?: number } = {},
): SourceFixture {
	const rootPath = temporaryRoot("source");
	git(rootPath, ["init", "--quiet", "--initial-branch=main"]);
	git(rootPath, ["config", "user.name", "B112 Test"]);
	git(rootPath, ["config", "user.email", "b112-test@graphrefly.invalid"]);
	const files = [
		{ path: ".gitignore", mode: "100644" as const, bytes: encoder.encode("*.ignored\n") },
		{ path: "README.md", mode: "100644" as const, bytes: encoder.encode("baseline\n") },
		{
			path: "src/run.sh",
			mode: "100755" as const,
			bytes: encoder.encode("#!/bin/sh\nexit 0\n"),
		},
	];
	for (let index = 0; index < (options.extraFiles ?? 0); index += 1) {
		files.push({
			path: `fixtures/item-${String(index).padStart(3, "0")}.txt`,
			mode: "100644",
			bytes: encoder.encode(`fixture-${index}\n`),
		});
	}
	for (const file of files) {
		const target = join(rootPath, ...file.path.split("/"));
		mkdirSync(join(target, ".."), { recursive: true });
		writeFileSync(target, file.bytes, { mode: file.mode === "100755" ? 0o755 : 0o644 });
		chmodSync(target, file.mode === "100755" ? 0o755 : 0o644);
	}
	if (options.symlink) symlinkSync("README.md", join(rootPath, "linked-readme"));
	git(rootPath, ["add", "--all"]);
	git(rootPath, ["commit", "--quiet", "-m", "source fixture"]);
	const commitSha = git(rootPath, ["rev-parse", "HEAD"]);
	const treeObjectId = git(rootPath, ["rev-parse", "HEAD^{tree}"]);
	return {
		rootPath,
		commitSha,
		treeObjectId,
		material: createCanonicalRepositoryTreeMaterial(files),
	};
}

function sourceCapability(fixture: SourceFixture): ExactLocalSourceRepositoryCapabilityV1 {
	return {
		repositoryRef: "graphrefly-ts",
		rootPath: fixture.rootPath,
	};
}

function trackingAllocator(
	options: { readonly prepopulate?: boolean; readonly cleanupResult?: boolean } = {},
): TrackingAllocator {
	const parent = temporaryRoot("allocations");
	const allocations: SingleBaselineWorkspaceAllocationV1[] = [];
	const cleaned: SingleBaselineWorkspaceAllocationV1[] = [];
	return {
		allocations,
		cleaned,
		async allocate() {
			const rootPath = join(parent, `workspace-${allocations.length}`);
			mkdirSync(rootPath, { mode: 0o700 });
			chmodSync(rootPath, 0o700);
			if (options.prepopulate) writeFileSync(join(rootPath, "unexpected"), "unexpected");
			const allocation = Object.freeze({
				rootPath,
				ownershipToken: Object.freeze({ allocation: allocations.length }),
			});
			allocations.push(allocation);
			return allocation;
		},
		async cleanup(allocation) {
			cleaned.push(allocation);
			if (options.cleanupResult === false) return false;
			rmSync(allocation.rootPath, { recursive: true, force: true });
			return true;
		},
	};
}

describe("B112 D658 history-free single-baseline repository materialization", () => {
	it("exports exact committed bytes into one deterministic clean parentless repository", async () => {
		const source = sourceFixture({ extraFiles: 32 });
		const allocator = trackingAllocator();
		const signal = new AbortController().signal;
		const first = await materializeHistoryFreeSingleBaselineRepository(
			sourceCapability(source),
			allocator,
			{
				sourceCommitSha: source.commitSha,
				sourceTreeObjectId: source.treeObjectId,
				overlay: null,
				signal,
			},
		);
		const second = await materializeHistoryFreeSingleBaselineRepository(
			sourceCapability(source),
			allocator,
			{
				sourceCommitSha: source.commitSha,
				sourceTreeObjectId: source.treeObjectId,
				overlay: null,
				signal,
			},
		);

		expect(first.evidence).toMatchObject({
			originalTreeDigest: source.material.treeDigest,
			actorTreeDigest: source.material.treeDigest,
			overlayDigest: null,
			repositoryState: "clean-single-baseline",
			commitCount: 1,
			parentCount: 0,
			remotes: 0,
			reflogs: 0,
			unreachableObjects: 0,
			sharedObjectStore: false,
			fullFilesystemMatch: true,
			sourceHistoryVisible: false,
			overlayVisibleAsDiff: false,
		});
		expect(first.evidence.actorCommitSha).toBe(second.evidence.actorCommitSha);
		expect(first.evidence.gitProcessCount).toBe(second.evidence.gitProcessCount);
		expect(first.evidence.gitProcessCount).toBeLessThan(36);
		const workspaceRoot = first.workspace.rootPathForHostRunner();
		expect(git(workspaceRoot, ["rev-list", "--count", "--all"])).toBe("1");
		expect(git(workspaceRoot, ["rev-list", "--parents", "--all"]).split(" ")).toHaveLength(1);
		expect(git(workspaceRoot, ["remote"])).toBe("");
		expect(git(workspaceRoot, ["status", "--porcelain=v1", "--untracked-files=all"])).toBe("");
		expect(readFileSync(join(workspaceRoot, "README.md"), "utf8")).toBe("baseline\n");
		expect(JSON.stringify(first.workspace)).not.toContain(workspaceRoot);

		const mutableRequest = {
			sourceCommitSha: source.commitSha,
			sourceTreeObjectId: source.treeObjectId,
			overlay: null,
			signal,
		};
		const mutableRequestResultPromise = materializeHistoryFreeSingleBaselineRepository(
			sourceCapability(source),
			allocator,
			mutableRequest,
		);
		mutableRequest.sourceCommitSha = "0".repeat(40);
		mutableRequest.sourceTreeObjectId = "0".repeat(40);
		const mutableRequestResult = await mutableRequestResultPromise;
		expect(mutableRequestResult.evidence.sourceCommitSha).toBe(source.commitSha);
		expect(mutableRequestResult.evidence.sourceTreeObjectId).toBe(source.treeObjectId);

		await first.cleanup();
		await second.cleanup();
		await mutableRequestResult.cleanup();
		expect(allocator.cleaned).toEqual(allocator.allocations);
		await expect(first.cleanup()).rejects.toMatchObject({ code: "cleanup-already-attempted" });
	});

	it("bakes an exact private replacement into the baseline without exposing it as a diff", async () => {
		const source = sourceFixture();
		const allocator = trackingAllocator();
		const replacementBytes = encoder.encode("held-out replacement\n");
		const baseReadme = privateCanonicalRepositoryFiles(source.material).find(
			(file) => file.path === "README.md",
		);
		if (baseReadme === undefined) throw new Error("test fixture missing README");
		const overlay = {
			schemaVersion: PRIVATE_REPOSITORY_OVERLAY_SCHEMA_VERSION,
			replacements: [
				{
					path: "README.md",
					baseMode: baseReadme.mode,
					baseContentDigest: empiricalSha256(baseReadme.bytes),
					replacementByteLength: replacementBytes.byteLength,
					replacementContentDigest: empiricalSha256(replacementBytes),
					replacementBytes,
				},
			],
		};
		const expectedActor = applyPrivateRepositoryOverlay(source.material, overlay);
		const resultPromise = materializeHistoryFreeSingleBaselineRepository(
			sourceCapability(source),
			allocator,
			{
				sourceCommitSha: source.commitSha,
				sourceTreeObjectId: source.treeObjectId,
				overlay,
				signal: new AbortController().signal,
			},
		);
		replacementBytes.fill(0);
		overlay.replacements[0].replacementContentDigest = `sha256:${"0".repeat(64)}`;
		const result = await resultPromise;

		expect(result.evidence.originalTreeDigest).toBe(source.material.treeDigest);
		expect(result.evidence.actorTreeDigest).toBe(expectedActor.material.treeDigest);
		expect(result.evidence.actorTreeDigest).not.toBe(result.evidence.originalTreeDigest);
		expect(result.evidence.overlayDigest).toBe(expectedActor.overlayDigest);
		expect(git(result.workspace.rootPathForHostRunner(), ["status", "--porcelain=v1"])).toBe("");
		expect(readFileSync(join(result.workspace.rootPathForHostRunner(), "README.md"), "utf8")).toBe(
			"held-out replacement\n",
		);
		const serializedEvidence = JSON.stringify(result.evidence);
		expect(serializedEvidence).not.toContain("held-out replacement");
		expect(serializedEvidence).not.toContain(source.rootPath);
		expect(serializedEvidence).not.toContain(result.workspace.rootPathForHostRunner());
		await result.cleanup();
	});

	it("rejects filesystem, ref, object, and permission material outside the exact closure", async () => {
		const source = sourceFixture();
		const result = await materializeHistoryFreeSingleBaselineRepository(
			sourceCapability(source),
			trackingAllocator(),
			{
				sourceCommitSha: source.commitSha,
				sourceTreeObjectId: source.treeObjectId,
				overlay: null,
				signal: new AbortController().signal,
			},
		);
		const workspaceRoot = result.workspace.rootPathForHostRunner();
		writeFileSync(join(workspaceRoot, "extra.ignored"), "ignored by git");
		expect(git(workspaceRoot, ["status", "--porcelain=v1", "--untracked-files=all"])).toBe("");
		await expect(
			verifySingleBaselineRepositoryClosure(
				workspaceRoot,
				source.material,
				result.evidence.actorCommitSha,
				result.evidence.actorGitTreeObjectId,
				new AbortController().signal,
			),
		).rejects.toMatchObject({ code: "repository-closure-failed" });
		rmSync(join(workspaceRoot, "extra.ignored"));

		const extraObjectId = git(workspaceRoot, ["hash-object", "-w", "--stdin"], "private extra");
		git(workspaceRoot, ["update-ref", "refs/tags/extra", extraObjectId]);
		await expect(
			verifySingleBaselineRepositoryClosure(
				workspaceRoot,
				source.material,
				result.evidence.actorCommitSha,
				result.evidence.actorGitTreeObjectId,
				new AbortController().signal,
			),
		).rejects.toMatchObject({ code: "repository-closure-failed" });
		git(workspaceRoot, ["update-ref", "-d", "refs/tags/extra"]);
		await expect(
			verifySingleBaselineRepositoryClosure(
				workspaceRoot,
				source.material,
				result.evidence.actorCommitSha,
				result.evidence.actorGitTreeObjectId,
				new AbortController().signal,
			),
		).rejects.toMatchObject({ code: "repository-closure-failed" });
		await result.cleanup();

		const permissionResult = await materializeHistoryFreeSingleBaselineRepository(
			sourceCapability(source),
			trackingAllocator(),
			{
				sourceCommitSha: source.commitSha,
				sourceTreeObjectId: source.treeObjectId,
				overlay: null,
				signal: new AbortController().signal,
			},
		);
		const permissionWorkspaceRoot = permissionResult.workspace.rootPathForHostRunner();
		chmodSync(join(permissionWorkspaceRoot, "README.md"), 0o4755);
		await expect(
			verifySingleBaselineRepositoryClosure(
				permissionWorkspaceRoot,
				source.material,
				permissionResult.evidence.actorCommitSha,
				permissionResult.evidence.actorGitTreeObjectId,
				new AbortController().signal,
			),
		).rejects.toMatchObject({ code: "repository-closure-failed" });
		await permissionResult.cleanup();
	});

	it("fails closed on tree, overlay, unsupported-entry, allocation, cancellation, and cleanup faults", async () => {
		const source = sourceFixture();
		let requestGetterCalled = false;
		const accessorRequest = Object.create(Object.prototype);
		Object.defineProperties(accessorRequest, {
			sourceCommitSha: {
				enumerable: true,
				get() {
					requestGetterCalled = true;
					return source.commitSha;
				},
			},
			sourceTreeObjectId: { enumerable: true, value: source.treeObjectId },
			overlay: { enumerable: true, value: null },
			signal: { enumerable: true, value: new AbortController().signal },
		});
		await expect(
			materializeHistoryFreeSingleBaselineRepository(
				sourceCapability(source),
				trackingAllocator(),
				accessorRequest as never,
			),
		).rejects.toMatchObject({ code: "invalid-request" });
		expect(requestGetterCalled).toBe(false);

		await expect(
			materializeHistoryFreeSingleBaselineRepository(
				sourceCapability(source),
				trackingAllocator(),
				{
					sourceCommitSha: source.commitSha,
					sourceTreeObjectId: "0".repeat(40),
					overlay: null,
					signal: new AbortController().signal,
				},
			),
		).rejects.toMatchObject({ code: "invalid-source-tree" });

		const readme = privateCanonicalRepositoryFiles(source.material).find(
			(file) => file.path === "README.md",
		);
		if (readme === undefined) throw new Error("test fixture missing README");
		const replacementBytes = encoder.encode("replacement\n");
		await expect(
			materializeHistoryFreeSingleBaselineRepository(
				sourceCapability(source),
				trackingAllocator(),
				{
					sourceCommitSha: source.commitSha,
					sourceTreeObjectId: source.treeObjectId,
					overlay: {
						schemaVersion: PRIVATE_REPOSITORY_OVERLAY_SCHEMA_VERSION,
						replacements: [
							{
								path: "README.md",
								baseMode: readme.mode,
								baseContentDigest: "sha256:".concat("0".repeat(64)),
								replacementByteLength: replacementBytes.byteLength,
								replacementContentDigest: empiricalSha256(replacementBytes),
								replacementBytes,
							},
						],
					},
					signal: new AbortController().signal,
				},
			),
		).rejects.toMatchObject({ code: "invalid-overlay" });

		const linkedSource = sourceFixture({ symlink: true });
		await expect(
			materializeHistoryFreeSingleBaselineRepository(
				sourceCapability(linkedSource),
				trackingAllocator(),
				{
					sourceCommitSha: linkedSource.commitSha,
					sourceTreeObjectId: linkedSource.treeObjectId,
					overlay: null,
					signal: new AbortController().signal,
				},
			),
		).rejects.toMatchObject({ code: "invalid-source-tree" });

		const invalidAllocation = trackingAllocator({ prepopulate: true });
		await expect(
			materializeHistoryFreeSingleBaselineRepository(sourceCapability(source), invalidAllocation, {
				sourceCommitSha: source.commitSha,
				sourceTreeObjectId: source.treeObjectId,
				overlay: null,
				signal: new AbortController().signal,
			}),
		).rejects.toMatchObject({ code: "invalid-allocation" });
		expect(invalidAllocation.cleaned).toEqual(invalidAllocation.allocations);

		const nestedRootPath = join(source.rootPath, "nested-workspace");
		mkdirSync(nestedRootPath, { mode: 0o700 });
		const nestedAllocation = Object.freeze({
			rootPath: nestedRootPath,
			ownershipToken: Object.freeze({ allocation: "nested" }),
		});
		const nestedCleaned: SingleBaselineWorkspaceAllocationV1[] = [];
		await expect(
			materializeHistoryFreeSingleBaselineRepository(
				sourceCapability(source),
				{
					async allocate() {
						return nestedAllocation;
					},
					async cleanup(allocation) {
						nestedCleaned.push(allocation);
						rmSync(allocation.rootPath, { recursive: true, force: true });
						return true;
					},
				},
				{
					sourceCommitSha: source.commitSha,
					sourceTreeObjectId: source.treeObjectId,
					overlay: null,
					signal: new AbortController().signal,
				},
			),
		).rejects.toMatchObject({ code: "invalid-allocation" });
		expect(nestedCleaned).toEqual([nestedAllocation]);

		const accessorRootPath = temporaryRoot("accessor-allocation");
		let ownershipGetterCalled = false;
		const accessorAllocation = Object.create(Object.prototype);
		Object.defineProperties(accessorAllocation, {
			rootPath: { enumerable: true, value: accessorRootPath },
			ownershipToken: {
				enumerable: true,
				get() {
					ownershipGetterCalled = true;
					return Object.freeze({ allocation: "accessor" });
				},
			},
		});
		const accessorCleaned: SingleBaselineWorkspaceAllocationV1[] = [];
		await expect(
			materializeHistoryFreeSingleBaselineRepository(
				sourceCapability(source),
				{
					async allocate() {
						return accessorAllocation as SingleBaselineWorkspaceAllocationV1;
					},
					async cleanup(allocation) {
						accessorCleaned.push(allocation);
						rmSync(accessorRootPath, { recursive: true, force: true });
						return true;
					},
				},
				{
					sourceCommitSha: source.commitSha,
					sourceTreeObjectId: source.treeObjectId,
					overlay: null,
					signal: new AbortController().signal,
				},
			),
		).rejects.toMatchObject({ code: "invalid-allocation" });
		expect(ownershipGetterCalled).toBe(false);
		expect(accessorCleaned).toEqual([accessorAllocation]);

		const transactionalRootPath = join(temporaryRoot("transactional-parent"), "workspace");
		let transactionalCleanupCalled = false;
		await expect(
			materializeHistoryFreeSingleBaselineRepository(
				sourceCapability(source),
				{
					async allocate() {
						mkdirSync(transactionalRootPath, { mode: 0o700 });
						rmSync(transactionalRootPath, { recursive: true });
						throw new Error("allocation rejected after transactional cleanup");
					},
					async cleanup() {
						transactionalCleanupCalled = true;
						return true;
					},
				},
				{
					sourceCommitSha: source.commitSha,
					sourceTreeObjectId: source.treeObjectId,
					overlay: null,
					signal: new AbortController().signal,
				},
			),
		).rejects.toMatchObject({ code: "allocation-failed" });
		expect(transactionalCleanupCalled).toBe(false);
		expect(() => readFileSync(transactionalRootPath)).toThrow();

		const cleanupFailure = trackingAllocator({ prepopulate: true, cleanupResult: false });
		await expect(
			materializeHistoryFreeSingleBaselineRepository(sourceCapability(source), cleanupFailure, {
				sourceCommitSha: source.commitSha,
				sourceTreeObjectId: source.treeObjectId,
				overlay: null,
				signal: new AbortController().signal,
			}),
		).rejects.toMatchObject({ code: "cleanup-failed" });
		expect(cleanupFailure.cleaned).toHaveLength(1);

		const postAllocationAbort = new AbortController();
		const postAllocationAllocator = trackingAllocator();
		const allocateThenAbort = postAllocationAllocator.allocate.bind(postAllocationAllocator);
		postAllocationAllocator.allocate = async (signal) => {
			const allocation = await allocateThenAbort(signal);
			postAllocationAbort.abort();
			return allocation;
		};
		await expect(
			materializeHistoryFreeSingleBaselineRepository(
				sourceCapability(source),
				postAllocationAllocator,
				{
					sourceCommitSha: source.commitSha,
					sourceTreeObjectId: source.treeObjectId,
					overlay: null,
					signal: postAllocationAbort.signal,
				},
			),
		).rejects.toMatchObject({ code: "cancelled" });
		expect(postAllocationAllocator.cleaned).toEqual(postAllocationAllocator.allocations);
		expect(postAllocationAllocator.cleaned).toHaveLength(1);

		const aborted = new AbortController();
		aborted.abort();
		await expect(
			materializeHistoryFreeSingleBaselineRepository(
				sourceCapability(source),
				trackingAllocator(),
				{
					sourceCommitSha: source.commitSha,
					sourceTreeObjectId: source.treeObjectId,
					overlay: null,
					signal: aborted.signal,
				},
			),
		).rejects.toMatchObject({ code: "cancelled" });
	});

	it("uses a portable byte-stable path and exact replacement contract", () => {
		expect(sep).toBe("/");
		expect(assertPortableRepositoryPath("packages/ts/src/index.ts", "path")).toBe(
			"packages/ts/src/index.ts",
		);
		for (const path of ["/absolute", "../escape", "a/./b", "a/.git/config", "a\\b", "a b"]) {
			expect(() => assertPortableRepositoryPath(path, "path")).toThrow(/portable|forbidden|path/);
		}
		expect(() =>
			createCanonicalRepositoryTreeMaterial([
				{ path: "A.txt", mode: "100644", bytes: encoder.encode("a") },
				{ path: "a.txt", mode: "100644", bytes: encoder.encode("b") },
			]),
		).toThrow(/case-fold path collision/);
		const material = createCanonicalRepositoryTreeMaterial([
			{ path: "README.md", mode: "100644", bytes: encoder.encode("baseline\n") },
		]);
		const firstPrivateView = privateCanonicalRepositoryFiles(material);
		firstPrivateView[0].bytes.fill(0);
		expect(new TextDecoder().decode(privateCanonicalRepositoryFiles(material)[0].bytes)).toBe(
			"baseline\n",
		);
		const baseFile = privateCanonicalRepositoryFiles(material)[0];
		const noOpOverlay = {
			schemaVersion: PRIVATE_REPOSITORY_OVERLAY_SCHEMA_VERSION,
			replacements: [
				{
					path: baseFile.path,
					baseMode: baseFile.mode,
					baseContentDigest: empiricalSha256(baseFile.bytes),
					replacementByteLength: baseFile.bytes.byteLength,
					replacementContentDigest: empiricalSha256(baseFile.bytes),
					replacementBytes: new Uint8Array(baseFile.bytes),
				},
			],
		};
		expect(() => applyPrivateRepositoryOverlay(material, noOpOverlay)).toThrow(
			/replacement must change/,
		);

		let overlayGetterCalled = false;
		const accessorOverlay = Object.create(Object.prototype);
		Object.defineProperties(accessorOverlay, {
			schemaVersion: {
				enumerable: true,
				get() {
					overlayGetterCalled = true;
					return PRIVATE_REPOSITORY_OVERLAY_SCHEMA_VERSION;
				},
			},
			replacements: { enumerable: true, value: [] },
		});
		expect(() => validatePrivateRepositoryOverlay(accessorOverlay as never)).toThrow(/accessor/);
		expect(overlayGetterCalled).toBe(false);

		const customReplacementArray: unknown[] = [];
		Object.setPrototypeOf(customReplacementArray, Object.freeze({}));
		expect(() =>
			validatePrivateRepositoryOverlay({
				schemaVersion: PRIVATE_REPOSITORY_OVERLAY_SCHEMA_VERSION,
				replacements: customReplacementArray as never,
			}),
		).toThrow(/plain dense array/);

		const typedArraySubclass = class extends Uint8Array {};
		expect(() =>
			createCanonicalRepositoryTreeMaterial([
				{ path: "subclass.bin", mode: "100644", bytes: new typedArraySubclass([1]) },
			]),
		).toThrow(/exact Uint8Array/);

		const oversizedTree: unknown[] = [];
		oversizedTree.length = 4097;
		expect(() => createCanonicalRepositoryTreeMaterial(oversizedTree as never)).toThrow(
			/no greater than 4096/,
		);
		const oversizedOverlay: unknown[] = [];
		oversizedOverlay.length = 17;
		expect(() =>
			validatePrivateRepositoryOverlay({
				schemaVersion: PRIVATE_REPOSITORY_OVERLAY_SCHEMA_VERSION,
				replacements: oversizedOverlay as never,
			}),
		).toThrow(/no greater than 16/);

		const hiddenMaterial = {
			path: "hidden.txt",
			mode: "100644" as const,
			bytes: encoder.encode("hidden"),
			[Symbol("hidden")]: "not canonical",
		};
		expect(() => createCanonicalRepositoryTreeMaterial([hiddenMaterial])).toThrow(
			/unexpected|missing/,
		);
		const symbolArray = [hiddenMaterial];
		Object.defineProperty(symbolArray, Symbol("hidden"), { value: true });
		expect(() => createCanonicalRepositoryTreeMaterial(symbolArray)).toThrow(/dense|extra/);
		expect(
			new SingleBaselineRepositoryMaterializationError("cleanup-failed").message,
		).not.toContain(tmpdir());
	});
});
