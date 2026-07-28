import { spawn } from "node:child_process";
import { chmod, lstat, mkdir, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { empiricalSha256, strictSnapshot } from "./canonical.js";
import {
	applyPrivateRepositoryOverlay,
	type CanonicalRepositoryFileModeV1,
	type CanonicalRepositoryTreeMaterialV1,
	createCanonicalRepositoryTreeMaterial,
	type PrivateCanonicalRepositoryFileV1,
	type PrivateRepositoryOverlayV1,
	privateCanonicalRepositoryFiles,
	validatePrivateRepositoryOverlay,
} from "./canonical-repository-tree.js";

const GIT_OBJECT_ID = /^[a-f0-9]{40}$/;
const MAX_GIT_CONTROL_OUTPUT_BYTES = 4 * 1024 * 1024;
const MAX_GIT_STDERR_BYTES = 64 * 1024;
const MAX_GIT_BLOB_BATCH_BYTES = 65 * 1024 * 1024;
const FIXED_COMMIT_MESSAGE = "GraphReFly B112 history-free single baseline\n";
const FIXED_GIT_ENV = Object.freeze({
	GIT_ATTR_NOSYSTEM: "1",
	GIT_CONFIG_GLOBAL: "/dev/null",
	GIT_CONFIG_NOSYSTEM: "1",
	GIT_CONFIG_SYSTEM: "/dev/null",
	GIT_LITERAL_PATHSPECS: "1",
	GIT_NO_LAZY_FETCH: "1",
	GIT_NO_REPLACE_OBJECTS: "1",
	GIT_OPTIONAL_LOCKS: "0",
	LANG: "C",
	LC_ALL: "C",
	PATH: "/usr/bin:/bin",
});

export type SingleBaselineRepositoryFailureCode =
	| "allocation-failed"
	| "cancelled"
	| "cleanup-already-attempted"
	| "cleanup-failed"
	| "git-operation-failed"
	| "invalid-allocation"
	| "invalid-overlay"
	| "invalid-request"
	| "invalid-source-repository"
	| "invalid-source-tree"
	| "repository-closure-failed"
	| "unsupported-host-platform";

export class SingleBaselineRepositoryMaterializationError extends Error {
	readonly code: SingleBaselineRepositoryFailureCode;

	constructor(code: SingleBaselineRepositoryFailureCode) {
		super(`B112 single-baseline repository materialization failed: ${code}`);
		this.name = "SingleBaselineRepositoryMaterializationError";
		this.code = code;
	}
}

export interface ExactLocalSourceRepositoryCapabilityV1 {
	readonly repositoryRef: "graphrefly-ts";
	readonly rootPath: string;
}

export interface SingleBaselineWorkspaceAllocationV1 {
	readonly rootPath: string;
	readonly ownershipToken: unknown;
}

export interface SingleBaselineWorkspaceAllocatorCapabilityV1 {
	/**
	 * Returns ownership only after allocation is complete. Rejection is transactional: the allocator
	 * must remove any resource created before it can return the exact ownership token.
	 */
	allocate(signal: AbortSignal): Promise<SingleBaselineWorkspaceAllocationV1>;
	cleanup(allocation: SingleBaselineWorkspaceAllocationV1): Promise<boolean>;
}

export interface HistoryFreeSingleBaselineRepositoryRequestV1 {
	readonly sourceCommitSha: string;
	readonly sourceTreeObjectId: string;
	readonly overlay: PrivateRepositoryOverlayV1 | null;
	readonly signal: AbortSignal;
}

export interface HistoryFreeSingleBaselineRepositoryEvidenceV1 {
	readonly schemaVersion: "graphrefly.private-solution-eval.single-baseline-repository-evidence.v1";
	readonly repositoryRef: "graphrefly-ts";
	readonly sourceCommitSha: string;
	readonly sourceTreeObjectId: string;
	readonly originalTreeDigest: string;
	readonly actorTreeDigest: string;
	readonly overlayDigest: string | null;
	readonly actorGitTreeObjectId: string;
	readonly actorCommitSha: string;
	readonly entryCount: number;
	readonly totalBytes: number;
	readonly gitProcessCount: number;
	readonly repositoryState: "clean-single-baseline";
	readonly commitCount: 1;
	readonly parentCount: 0;
	readonly remotes: 0;
	readonly reflogs: 0;
	readonly unreachableObjects: 0;
	readonly sharedObjectStore: false;
	readonly fullFilesystemMatch: true;
	readonly sourceHistoryVisible: false;
	readonly overlayVisibleAsDiff: false;
}

export interface SingleBaselineRepositoryWorkspaceCapabilityV1 {
	readonly kind: "graphrefly.private-solution-eval.single-baseline-workspace.v1";
	rootPathForHostRunner(): string;
}

export interface HistoryFreeSingleBaselineRepositoryMaterializationV1 {
	readonly workspace: SingleBaselineRepositoryWorkspaceCapabilityV1;
	readonly evidence: HistoryFreeSingleBaselineRepositoryEvidenceV1;
	cleanup(): Promise<void>;
}

interface GitProcessCounter {
	count: number;
}

interface GitRunOptions {
	readonly input?: Uint8Array;
	readonly maxOutputBytes?: number;
	readonly environment?: Readonly<Record<string, string>>;
	readonly signal: AbortSignal;
	readonly counter: GitProcessCounter;
}

interface SourceTreeReadResult {
	readonly material: CanonicalRepositoryTreeMaterialV1;
}

/**
 * Materializes D658's package-private repository boundary on a POSIX-path host. Version 1 requires
 * POSIX permission semantics for its exact 0700 staging and 0644/0755 filesystem closure evidence.
 */
export async function materializeHistoryFreeSingleBaselineRepository(
	source: ExactLocalSourceRepositoryCapabilityV1,
	allocator: SingleBaselineWorkspaceAllocatorCapabilityV1,
	request: HistoryFreeSingleBaselineRepositoryRequestV1,
): Promise<HistoryFreeSingleBaselineRepositoryMaterializationV1> {
	if (sep !== "/") {
		throw new SingleBaselineRepositoryMaterializationError("unsupported-host-platform");
	}
	const sourceSnapshot = validateSourceSnapshot(source);
	const requestSnapshot = validateRequestSnapshot(request);
	assertNotCancelled(requestSnapshot.signal);
	const sourceRoot = await validateSourceCapability(sourceSnapshot);
	const counter = { count: 0 };
	const sourceTree = await readExactSourceTree(
		sourceRoot,
		requestSnapshot.sourceCommitSha,
		requestSnapshot.sourceTreeObjectId,
		requestSnapshot.signal,
		counter,
	);
	let actorMaterial = sourceTree.material;
	let overlayDigest: string | null = null;
	if (requestSnapshot.overlay !== null) {
		try {
			const applied = applyPrivateRepositoryOverlay(sourceTree.material, requestSnapshot.overlay);
			actorMaterial = applied.material;
			overlayDigest = applied.overlayDigest;
		} catch {
			throw new SingleBaselineRepositoryMaterializationError("invalid-overlay");
		}
	}
	if (
		(requestSnapshot.overlay === null &&
			actorMaterial.treeDigest !== sourceTree.material.treeDigest) ||
		(requestSnapshot.overlay !== null &&
			actorMaterial.treeDigest === sourceTree.material.treeDigest)
	) {
		throw new SingleBaselineRepositoryMaterializationError("invalid-overlay");
	}

	let allocation: SingleBaselineWorkspaceAllocationV1;
	try {
		allocation = await allocator.allocate(requestSnapshot.signal);
	} catch {
		throw new SingleBaselineRepositoryMaterializationError("allocation-failed");
	}
	try {
		const validatedAllocation = await validateAllocation(allocation);
		allocation = validatedAllocation.allocation;
		const workspaceRoot = validatedAllocation.rootPath;
		if (pathsOverlap(sourceRoot, workspaceRoot)) {
			throw new SingleBaselineRepositoryMaterializationError("invalid-allocation");
		}
		await writeActorFiles(
			workspaceRoot,
			privateCanonicalRepositoryFiles(actorMaterial),
			requestSnapshot.signal,
		);
		const repository = await createFreshRepository(
			workspaceRoot,
			actorMaterial,
			requestSnapshot.signal,
			counter,
		);
		if (
			(requestSnapshot.overlay === null &&
				repository.treeObjectId !== requestSnapshot.sourceTreeObjectId) ||
			(requestSnapshot.overlay !== null &&
				repository.treeObjectId === requestSnapshot.sourceTreeObjectId)
		) {
			throw new SingleBaselineRepositoryMaterializationError("repository-closure-failed");
		}
		const closure = await verifySingleBaselineRepositoryClosure(
			workspaceRoot,
			actorMaterial,
			repository.commitSha,
			repository.treeObjectId,
			requestSnapshot.signal,
			counter,
		);
		assertNotCancelled(requestSnapshot.signal);
		const evidence = strictSnapshot({
			schemaVersion:
				"graphrefly.private-solution-eval.single-baseline-repository-evidence.v1" as const,
			repositoryRef: "graphrefly-ts" as const,
			sourceCommitSha: requestSnapshot.sourceCommitSha,
			sourceTreeObjectId: requestSnapshot.sourceTreeObjectId,
			originalTreeDigest: sourceTree.material.treeDigest,
			actorTreeDigest: actorMaterial.treeDigest,
			overlayDigest,
			actorGitTreeObjectId: repository.treeObjectId,
			actorCommitSha: repository.commitSha,
			entryCount: actorMaterial.tree.entries.length,
			totalBytes: actorMaterial.totalBytes,
			gitProcessCount: counter.count,
			repositoryState: "clean-single-baseline" as const,
			commitCount: 1 as const,
			parentCount: 0 as const,
			remotes: 0 as const,
			reflogs: 0 as const,
			unreachableObjects: 0 as const,
			sharedObjectStore: false as const,
			fullFilesystemMatch: closure.fullFilesystemMatch,
			sourceHistoryVisible: false as const,
			overlayVisibleAsDiff: false as const,
		});
		assertNotCancelled(requestSnapshot.signal);
		return createMaterializationResult(workspaceRoot, allocation, allocator, evidence);
	} catch (error) {
		const cleanupSucceeded = await attemptCleanupOnce(allocator, allocation);
		if (!cleanupSucceeded) {
			throw new SingleBaselineRepositoryMaterializationError("cleanup-failed");
		}
		if (error instanceof SingleBaselineRepositoryMaterializationError) throw error;
		throw new SingleBaselineRepositoryMaterializationError("git-operation-failed");
	}
}

export async function verifySingleBaselineRepositoryClosure(
	workspaceRoot: string,
	expectedMaterial: CanonicalRepositoryTreeMaterialV1,
	expectedCommitSha: string,
	expectedTreeObjectId: string,
	signal: AbortSignal,
	counter: GitProcessCounter = { count: 0 },
): Promise<{ readonly fullFilesystemMatch: true }> {
	try {
		assertNotCancelled(signal);
		const commitCount = asciiTrim(
			await runGit(workspaceRoot, ["rev-list", "--count", "--all"], {
				signal,
				counter,
			}),
		);
		const parents = asciiTrim(
			await runGit(workspaceRoot, ["rev-list", "--parents", "--all"], {
				signal,
				counter,
			}),
		).split(/\n/u);
		if (
			commitCount !== "1" ||
			parents.length !== 1 ||
			parents[0] !== expectedCommitSha ||
			parents[0].split(" ").length !== 1
		) {
			throw new SingleBaselineRepositoryMaterializationError("repository-closure-failed");
		}
		const headTree = asciiTrim(
			await runGit(workspaceRoot, ["rev-parse", "HEAD^{tree}"], {
				signal,
				counter,
			}),
		);
		if (headTree !== expectedTreeObjectId) {
			throw new SingleBaselineRepositoryMaterializationError("repository-closure-failed");
		}
		if (
			asciiTrim(
				await runGit(workspaceRoot, ["symbolic-ref", "HEAD"], {
					signal,
					counter,
				}),
			) !== "refs/heads/main" ||
			asciiTrim(
				await runGit(workspaceRoot, ["for-each-ref", "--format=%(refname)"], {
					signal,
					counter,
				}),
			) !== "refs/heads/main"
		) {
			throw new SingleBaselineRepositoryMaterializationError("repository-closure-failed");
		}
		for (const args of [
			["remote"],
			["reflog", "show", "--all"],
			["status", "--porcelain=v1", "--untracked-files=all"],
		] as const) {
			if (asciiTrim(await runGit(workspaceRoot, [...args], { signal, counter })) !== "") {
				throw new SingleBaselineRepositoryMaterializationError("repository-closure-failed");
			}
		}
		if (
			asciiTrim(
				await runGit(workspaceRoot, ["fsck", "--no-reflogs", "--unreachable", "--no-progress"], {
					signal,
					counter,
				}),
			) !== ""
		) {
			throw new SingleBaselineRepositoryMaterializationError("repository-closure-failed");
		}
		const reachableObjects = objectIdSet(
			await runGit(workspaceRoot, ["rev-list", "--objects", "HEAD"], {
				signal,
				counter,
			}),
			true,
		);
		const allObjects = objectIdSet(
			await runGit(
				workspaceRoot,
				["cat-file", "--batch-all-objects", "--batch-check=%(objectname)"],
				{
					signal,
					counter,
				},
			),
			false,
		);
		if (
			reachableObjects.size !== allObjects.size ||
			[...reachableObjects].some((objectId) => !allObjects.has(objectId))
		) {
			throw new SingleBaselineRepositoryMaterializationError("repository-closure-failed");
		}
		const commonDirectory = asciiTrim(
			await runGit(workspaceRoot, ["rev-parse", "--git-common-dir"], {
				signal,
				counter,
			}),
		);
		if (resolve(workspaceRoot, commonDirectory) !== resolve(workspaceRoot, ".git")) {
			throw new SingleBaselineRepositoryMaterializationError("repository-closure-failed");
		}
		const gitDirectoryMetadata = await lstat(join(workspaceRoot, ".git"));
		if (!gitDirectoryMetadata.isDirectory() || gitDirectoryMetadata.isSymbolicLink()) {
			throw new SingleBaselineRepositoryMaterializationError("repository-closure-failed");
		}
		for (const privateGitPath of [
			".git/objects/info/alternates",
			".git/info/grafts",
			".git/shallow",
			".git/logs",
			".git/hooks",
		]) {
			if (await pathExists(join(workspaceRoot, privateGitPath))) {
				throw new SingleBaselineRepositoryMaterializationError("repository-closure-failed");
			}
		}
		await assertFullFilesystemMatch(workspaceRoot, expectedMaterial, signal);
		assertNotCancelled(signal);
		return Object.freeze({ fullFilesystemMatch: true as const });
	} catch (error) {
		if (error instanceof SingleBaselineRepositoryMaterializationError) throw error;
		throw new SingleBaselineRepositoryMaterializationError("repository-closure-failed");
	}
}

async function readExactSourceTree(
	sourceRoot: string,
	commitSha: string,
	treeObjectId: string,
	signal: AbortSignal,
	counter: GitProcessCounter,
): Promise<SourceTreeReadResult> {
	if (!GIT_OBJECT_ID.test(commitSha) || !GIT_OBJECT_ID.test(treeObjectId)) {
		throw new SingleBaselineRepositoryMaterializationError("invalid-source-tree");
	}
	try {
		const sourceTopLevel = asciiTrim(
			await runGit(sourceRoot, ["rev-parse", "--show-toplevel"], { signal, counter }),
		);
		if (resolve(sourceTopLevel) !== sourceRoot) {
			throw new SingleBaselineRepositoryMaterializationError("invalid-source-repository");
		}
		const resolvedCommit = asciiTrim(
			await runGit(sourceRoot, ["rev-parse", "--verify", `${commitSha}^{commit}`], {
				signal,
				counter,
			}),
		);
		const commitType = asciiTrim(
			await runGit(sourceRoot, ["cat-file", "-t", commitSha], { signal, counter }),
		);
		const resolvedTree = asciiTrim(
			await runGit(sourceRoot, ["rev-parse", `${commitSha}^{tree}`], { signal, counter }),
		);
		const treeType = asciiTrim(
			await runGit(sourceRoot, ["cat-file", "-t", treeObjectId], { signal, counter }),
		);
		if (
			resolvedCommit !== commitSha ||
			commitType !== "commit" ||
			resolvedTree !== treeObjectId ||
			treeType !== "tree"
		) {
			throw new SingleBaselineRepositoryMaterializationError("invalid-source-tree");
		}
		const treeBytes = await runGit(sourceRoot, ["ls-tree", "-r", "-z", "--full-tree", commitSha], {
			signal,
			counter,
			maxOutputBytes: MAX_GIT_CONTROL_OUTPUT_BYTES,
		});
		const treeEntries = parseGitTreeEntries(treeBytes);
		const blobs =
			treeEntries.length === 0
				? []
				: parseGitBlobBatch(
						await runGit(sourceRoot, ["cat-file", "--batch"], {
							signal,
							counter,
							input: new TextEncoder().encode(
								`${treeEntries.map((entry) => entry.objectId).join("\n")}\n`,
							),
							maxOutputBytes: MAX_GIT_BLOB_BATCH_BYTES,
						}),
						treeEntries,
					);
		return Object.freeze({
			material: createCanonicalRepositoryTreeMaterial(
				treeEntries.map((entry, index) => ({
					path: entry.path,
					mode: entry.mode,
					bytes: blobs[index],
				})),
			),
		});
	} catch (error) {
		if (
			error instanceof SingleBaselineRepositoryMaterializationError &&
			(error.code === "cancelled" || error.code === "invalid-source-repository")
		) {
			throw error;
		}
		throw new SingleBaselineRepositoryMaterializationError("invalid-source-tree");
	}
}

async function createFreshRepository(
	workspaceRoot: string,
	actorMaterial: CanonicalRepositoryTreeMaterialV1,
	signal: AbortSignal,
	counter: GitProcessCounter,
): Promise<{ readonly treeObjectId: string; readonly commitSha: string }> {
	const templatePath = join(workspaceRoot, ".graphrefly-empty-template");
	const actorFiles = privateCanonicalRepositoryFiles(actorMaterial);
	try {
		await mkdir(templatePath, { mode: 0o700 });
		await runGit(
			workspaceRoot,
			[
				"init",
				"--quiet",
				"--object-format=sha1",
				"--initial-branch=main",
				`--template=${templatePath}`,
			],
			{ signal, counter },
		);
		await rm(templatePath, { recursive: true });
		await runGit(workspaceRoot, ["config", "core.logAllRefUpdates", "false"], {
			signal,
			counter,
		});
		await runGit(workspaceRoot, ["config", "core.fileMode", "true"], {
			signal,
			counter,
		});
		if (actorFiles.length === 0) {
			await runGit(workspaceRoot, ["read-tree", "--empty"], { signal, counter });
		} else {
			const objectIds = asciiTrim(
				await runGit(workspaceRoot, ["hash-object", "--no-filters", "-w", "--stdin-paths"], {
					signal,
					counter,
					input: new TextEncoder().encode(`${actorFiles.map((file) => file.path).join("\n")}\n`),
					maxOutputBytes: MAX_GIT_CONTROL_OUTPUT_BYTES,
				}),
			).split(/\n/u);
			if (
				objectIds.length !== actorFiles.length ||
				objectIds.some((objectId) => !GIT_OBJECT_ID.test(objectId))
			) {
				throw new SingleBaselineRepositoryMaterializationError("git-operation-failed");
			}
			const indexInput = actorFiles
				.map((file, index) => `${file.mode} ${objectIds[index]}\t${file.path}\n`)
				.join("");
			await runGit(workspaceRoot, ["update-index", "--add", "--index-info"], {
				signal,
				counter,
				input: new TextEncoder().encode(indexInput),
			});
		}
		const treeObjectId = asciiTrim(
			await runGit(workspaceRoot, ["write-tree"], { signal, counter }),
		);
		if (!GIT_OBJECT_ID.test(treeObjectId)) {
			throw new SingleBaselineRepositoryMaterializationError("git-operation-failed");
		}
		const commitSha = asciiTrim(
			await runGit(workspaceRoot, ["commit-tree", treeObjectId], {
				signal,
				counter,
				input: new TextEncoder().encode(FIXED_COMMIT_MESSAGE),
				environment: {
					GIT_AUTHOR_DATE: "2000-01-01T00:00:00Z",
					GIT_AUTHOR_EMAIL: "b112@graphrefly.invalid",
					GIT_AUTHOR_NAME: "GraphReFly B112",
					GIT_COMMITTER_DATE: "2000-01-01T00:00:00Z",
					GIT_COMMITTER_EMAIL: "b112@graphrefly.invalid",
					GIT_COMMITTER_NAME: "GraphReFly B112",
				},
			}),
		);
		if (!GIT_OBJECT_ID.test(commitSha)) {
			throw new SingleBaselineRepositoryMaterializationError("git-operation-failed");
		}
		await runGit(workspaceRoot, ["update-ref", "refs/heads/main", commitSha], {
			signal,
			counter,
		});
		await runGit(workspaceRoot, ["symbolic-ref", "HEAD", "refs/heads/main"], {
			signal,
			counter,
		});
		return Object.freeze({ treeObjectId, commitSha });
	} catch (error) {
		if (error instanceof SingleBaselineRepositoryMaterializationError) throw error;
		throw new SingleBaselineRepositoryMaterializationError("git-operation-failed");
	} finally {
		await rm(templatePath, { recursive: true, force: true }).catch(() => undefined);
	}
}

async function writeActorFiles(
	workspaceRoot: string,
	files: readonly PrivateCanonicalRepositoryFileV1[],
	signal: AbortSignal,
): Promise<void> {
	for (const file of files) {
		assertNotCancelled(signal);
		const target = join(workspaceRoot, ...file.path.split("/"));
		assertContainedPath(workspaceRoot, target);
		await mkdir(dirname(target), { recursive: true, mode: 0o700 });
		await writeFile(target, file.bytes, {
			flag: "wx",
			mode: file.mode === "100755" ? 0o755 : 0o644,
		});
		await chmod(target, file.mode === "100755" ? 0o755 : 0o644);
	}
}

async function assertFullFilesystemMatch(
	workspaceRoot: string,
	expectedMaterial: CanonicalRepositoryTreeMaterialV1,
	signal: AbortSignal,
): Promise<void> {
	const expectedFiles = new Map(expectedMaterial.tree.entries.map((entry) => [entry.path, entry]));
	const expectedDirectories = new Set<string>();
	for (const path of expectedFiles.keys()) {
		const components = path.split("/");
		for (let index = 1; index < components.length; index += 1) {
			expectedDirectories.add(components.slice(0, index).join("/"));
		}
	}
	const observedFiles = new Set<string>();
	const observedDirectories = new Set<string>();
	const walk = async (directory: string): Promise<void> => {
		assertNotCancelled(signal);
		for (const entry of await readdir(directory, { withFileTypes: true })) {
			if (directory === workspaceRoot && entry.name === ".git") continue;
			const absolutePath = join(directory, entry.name);
			assertContainedPath(workspaceRoot, absolutePath);
			const relativePath = relative(workspaceRoot, absolutePath).split(sep).join("/");
			const metadata = await lstat(absolutePath);
			if (metadata.isSymbolicLink()) {
				throw new SingleBaselineRepositoryMaterializationError("repository-closure-failed");
			}
			if (metadata.isDirectory()) {
				observedDirectories.add(relativePath);
				await walk(absolutePath);
				continue;
			}
			if (!metadata.isFile() || metadata.nlink !== 1) {
				throw new SingleBaselineRepositoryMaterializationError("repository-closure-failed");
			}
			const expected = expectedFiles.get(relativePath);
			if (
				expected === undefined ||
				metadata.size !== expected.byteLength ||
				(metadata.mode & 0o7777) !== (expected.mode === "100755" ? 0o755 : 0o644) ||
				empiricalSha256(await readFile(absolutePath)) !== expected.contentDigest
			) {
				throw new SingleBaselineRepositoryMaterializationError("repository-closure-failed");
			}
			observedFiles.add(relativePath);
		}
	};
	await walk(workspaceRoot);
	if (
		observedFiles.size !== expectedFiles.size ||
		[...expectedFiles.keys()].some((path) => !observedFiles.has(path)) ||
		observedDirectories.size !== expectedDirectories.size ||
		[...expectedDirectories].some((path) => !observedDirectories.has(path))
	) {
		throw new SingleBaselineRepositoryMaterializationError("repository-closure-failed");
	}
}

function parseGitTreeEntries(bytes: Uint8Array): readonly {
	readonly mode: CanonicalRepositoryFileModeV1;
	readonly objectId: string;
	readonly path: string;
}[] {
	const buffer = Buffer.from(bytes);
	const entries: {
		mode: CanonicalRepositoryFileModeV1;
		objectId: string;
		path: string;
	}[] = [];
	let offset = 0;
	while (offset < buffer.length) {
		const nul = buffer.indexOf(0, offset);
		if (nul < 0) throw new SingleBaselineRepositoryMaterializationError("invalid-source-tree");
		const record = buffer.subarray(offset, nul);
		const tab = record.indexOf(9);
		if (tab < 0) throw new SingleBaselineRepositoryMaterializationError("invalid-source-tree");
		const header = decodeAscii(record.subarray(0, tab));
		const path = decodeAscii(record.subarray(tab + 1));
		const match = /^(\d{6}) ([a-z]+) ([a-f0-9]{40})$/.exec(header);
		if (match === null || match[2] !== "blob" || (match[1] !== "100644" && match[1] !== "100755")) {
			throw new SingleBaselineRepositoryMaterializationError("invalid-source-tree");
		}
		entries.push({
			mode: match[1] as CanonicalRepositoryFileModeV1,
			objectId: match[3],
			path,
		});
		offset = nul + 1;
	}
	return Object.freeze(entries);
}

function parseGitBlobBatch(
	bytes: Uint8Array,
	entries: readonly { readonly objectId: string }[],
): readonly Uint8Array[] {
	const buffer = Buffer.from(bytes);
	const blobs: Uint8Array[] = [];
	let offset = 0;
	for (const entry of entries) {
		const newline = buffer.indexOf(10, offset);
		if (newline < 0) throw new SingleBaselineRepositoryMaterializationError("invalid-source-tree");
		const header = decodeAscii(buffer.subarray(offset, newline));
		const match = /^([a-f0-9]{40}) blob ([0-9]+)$/.exec(header);
		const byteLength = match === null ? Number.NaN : Number(match[2]);
		if (
			match === null ||
			match[1] !== entry.objectId ||
			!Number.isSafeInteger(byteLength) ||
			byteLength < 0 ||
			newline + 1 + byteLength >= buffer.length ||
			buffer[newline + 1 + byteLength] !== 10
		) {
			throw new SingleBaselineRepositoryMaterializationError("invalid-source-tree");
		}
		blobs.push(new Uint8Array(buffer.subarray(newline + 1, newline + 1 + byteLength)));
		offset = newline + 1 + byteLength + 1;
	}
	if (offset !== buffer.length) {
		throw new SingleBaselineRepositoryMaterializationError("invalid-source-tree");
	}
	return Object.freeze(blobs);
}

function objectIdSet(bytes: Uint8Array, permitsPathSuffix: boolean): ReadonlySet<string> {
	const text = asciiTrim(bytes);
	if (text === "") {
		throw new SingleBaselineRepositoryMaterializationError("repository-closure-failed");
	}
	const result = new Set<string>();
	for (const line of text.split("\n")) {
		const objectId = permitsPathSuffix ? line.split(" ", 1)[0] : line;
		if (!GIT_OBJECT_ID.test(objectId) || result.has(objectId)) {
			throw new SingleBaselineRepositoryMaterializationError("repository-closure-failed");
		}
		result.add(objectId);
	}
	return result;
}

function validateSourceSnapshot(
	value: ExactLocalSourceRepositoryCapabilityV1,
): ExactLocalSourceRepositoryCapabilityV1 {
	const source = exactOwnDataRecord(
		value,
		["repositoryRef", "rootPath"],
		"invalid-source-repository",
	);
	if (
		source.repositoryRef !== "graphrefly-ts" ||
		typeof source.rootPath !== "string" ||
		!isAbsolute(source.rootPath)
	) {
		throw new SingleBaselineRepositoryMaterializationError("invalid-source-repository");
	}
	return Object.freeze({
		repositoryRef: "graphrefly-ts" as const,
		rootPath: source.rootPath,
	});
}

function validateRequestSnapshot(
	value: HistoryFreeSingleBaselineRepositoryRequestV1,
): HistoryFreeSingleBaselineRepositoryRequestV1 {
	const request = exactOwnDataRecord(
		value,
		["overlay", "signal", "sourceCommitSha", "sourceTreeObjectId"],
		"invalid-request",
	);
	if (
		typeof request.sourceCommitSha !== "string" ||
		!GIT_OBJECT_ID.test(request.sourceCommitSha) ||
		typeof request.sourceTreeObjectId !== "string" ||
		!GIT_OBJECT_ID.test(request.sourceTreeObjectId) ||
		(request.overlay !== null &&
			(typeof request.overlay !== "object" || request.overlay === null)) ||
		!(request.signal instanceof AbortSignal)
	) {
		throw new SingleBaselineRepositoryMaterializationError("invalid-request");
	}
	let overlay: PrivateRepositoryOverlayV1 | null = null;
	if (request.overlay !== null) {
		try {
			overlay = validatePrivateRepositoryOverlay(request.overlay as PrivateRepositoryOverlayV1);
		} catch {
			throw new SingleBaselineRepositoryMaterializationError("invalid-overlay");
		}
	}
	return Object.freeze({
		sourceCommitSha: request.sourceCommitSha,
		sourceTreeObjectId: request.sourceTreeObjectId,
		overlay,
		signal: request.signal,
	});
}

function exactOwnDataRecord(
	value: unknown,
	keys: readonly string[],
	code: SingleBaselineRepositoryFailureCode,
): Record<string, unknown> {
	if (
		typeof value !== "object" ||
		value === null ||
		Array.isArray(value) ||
		(Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) ||
		Object.getOwnPropertySymbols(value).length !== 0
	) {
		throw new SingleBaselineRepositoryMaterializationError(code);
	}
	const descriptors = Object.getOwnPropertyDescriptors(value);
	const actualKeys = Object.keys(descriptors).sort();
	const expectedKeys = [...keys].sort();
	if (
		actualKeys.length !== expectedKeys.length ||
		actualKeys.some((key, index) => key !== expectedKeys[index]) ||
		Object.values(descriptors).some(
			(descriptor) => !descriptor.enumerable || !("value" in descriptor),
		)
	) {
		throw new SingleBaselineRepositoryMaterializationError(code);
	}
	return Object.fromEntries(
		keys.map((key) => [key, (descriptors[key] as PropertyDescriptor & { value: unknown }).value]),
	);
}

async function validateSourceCapability(
	source: ExactLocalSourceRepositoryCapabilityV1,
): Promise<string> {
	if (
		source.repositoryRef !== "graphrefly-ts" ||
		typeof source.rootPath !== "string" ||
		!isAbsolute(source.rootPath)
	) {
		throw new SingleBaselineRepositoryMaterializationError("invalid-source-repository");
	}
	try {
		const metadata = await lstat(source.rootPath);
		if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
			throw new SingleBaselineRepositoryMaterializationError("invalid-source-repository");
		}
		return await realpath(source.rootPath);
	} catch {
		throw new SingleBaselineRepositoryMaterializationError("invalid-source-repository");
	}
}

async function validateAllocation(allocation: SingleBaselineWorkspaceAllocationV1): Promise<{
	readonly rootPath: string;
	readonly allocation: SingleBaselineWorkspaceAllocationV1;
}> {
	const descriptors =
		typeof allocation === "object" && allocation !== null
			? (Object.getOwnPropertyDescriptors(allocation) as Record<string, PropertyDescriptor>)
			: {};
	const keys = Object.keys(descriptors).sort();
	const rootPathDescriptor = descriptors.rootPath;
	const ownershipTokenDescriptor = descriptors.ownershipToken;
	if (
		typeof allocation !== "object" ||
		allocation === null ||
		(Object.getPrototypeOf(allocation) !== Object.prototype &&
			Object.getPrototypeOf(allocation) !== null) ||
		Object.getOwnPropertySymbols(allocation).length !== 0 ||
		keys.length !== 2 ||
		keys[0] !== "ownershipToken" ||
		keys[1] !== "rootPath" ||
		rootPathDescriptor === undefined ||
		!("value" in rootPathDescriptor) ||
		!rootPathDescriptor.enumerable ||
		typeof rootPathDescriptor.value !== "string" ||
		!isAbsolute(rootPathDescriptor.value) ||
		ownershipTokenDescriptor === undefined ||
		!("value" in ownershipTokenDescriptor) ||
		!ownershipTokenDescriptor.enumerable ||
		ownershipTokenDescriptor.value === undefined
	) {
		throw new SingleBaselineRepositoryMaterializationError("invalid-allocation");
	}
	const allocationRootPath = rootPathDescriptor.value;
	try {
		Object.freeze(allocation);
		const metadata = await lstat(allocationRootPath);
		if (
			!metadata.isDirectory() ||
			metadata.isSymbolicLink() ||
			(metadata.mode & 0o777) !== 0o700 ||
			(await readdir(allocationRootPath)).length !== 0
		) {
			throw new SingleBaselineRepositoryMaterializationError("invalid-allocation");
		}
		return Object.freeze({
			rootPath: await realpath(allocationRootPath),
			allocation,
		});
	} catch (error) {
		if (error instanceof SingleBaselineRepositoryMaterializationError) throw error;
		throw new SingleBaselineRepositoryMaterializationError("invalid-allocation");
	}
}

function createMaterializationResult(
	workspaceRoot: string,
	allocation: SingleBaselineWorkspaceAllocationV1,
	allocator: SingleBaselineWorkspaceAllocatorCapabilityV1,
	evidence: HistoryFreeSingleBaselineRepositoryEvidenceV1,
): HistoryFreeSingleBaselineRepositoryMaterializationV1 {
	let cleanupAttempted = false;
	const workspace = Object.freeze(
		new (class implements SingleBaselineRepositoryWorkspaceCapabilityV1 {
			readonly kind = "graphrefly.private-solution-eval.single-baseline-workspace.v1" as const;
			rootPathForHostRunner(): string {
				return workspaceRoot;
			}
		})(),
	);
	return Object.freeze({
		workspace,
		evidence,
		async cleanup(): Promise<void> {
			if (cleanupAttempted) {
				throw new SingleBaselineRepositoryMaterializationError("cleanup-already-attempted");
			}
			cleanupAttempted = true;
			if (!(await attemptCleanupOnce(allocator, allocation))) {
				throw new SingleBaselineRepositoryMaterializationError("cleanup-failed");
			}
		},
	});
}

async function attemptCleanupOnce(
	allocator: SingleBaselineWorkspaceAllocatorCapabilityV1,
	allocation: SingleBaselineWorkspaceAllocationV1,
): Promise<boolean> {
	try {
		return (await allocator.cleanup(allocation)) === true;
	} catch {
		return false;
	}
}

function runGit(
	rootPath: string,
	args: readonly string[],
	options: GitRunOptions,
): Promise<Uint8Array> {
	assertNotCancelled(options.signal);
	options.counter.count += 1;
	return new Promise((resolveOutput, rejectOutput) => {
		let settled = false;
		let outputBytes = 0;
		let errorBytes = 0;
		let exceeded = false;
		const stdout: Buffer[] = [];
		const child = spawn(
			"git",
			[
				"-C",
				rootPath,
				"-c",
				"core.hooksPath=/dev/null",
				"-c",
				"commit.gpgSign=false",
				"-c",
				"tag.gpgSign=false",
				...args,
			],
			{
				env: {
					...FIXED_GIT_ENV,
					HOME: rootPath,
					XDG_CONFIG_HOME: rootPath,
					...options.environment,
				},
				signal: options.signal,
				stdio: ["pipe", "pipe", "pipe"],
			},
		);
		const rejectOnce = (code: SingleBaselineRepositoryFailureCode): void => {
			if (settled) return;
			settled = true;
			rejectOutput(new SingleBaselineRepositoryMaterializationError(code));
		};
		child.stdout.on("data", (chunk: Buffer) => {
			outputBytes += chunk.byteLength;
			if (outputBytes > (options.maxOutputBytes ?? MAX_GIT_CONTROL_OUTPUT_BYTES)) {
				exceeded = true;
				child.kill("SIGKILL");
				return;
			}
			stdout.push(chunk);
		});
		child.stderr.on("data", (chunk: Buffer) => {
			errorBytes += chunk.byteLength;
			if (errorBytes > MAX_GIT_STDERR_BYTES) {
				exceeded = true;
				child.kill("SIGKILL");
			}
		});
		child.on("error", () =>
			rejectOnce(options.signal.aborted ? "cancelled" : "git-operation-failed"),
		);
		child.on("close", (code) => {
			if (settled) return;
			if (options.signal.aborted) {
				rejectOnce("cancelled");
				return;
			}
			if (exceeded || code !== 0) {
				rejectOnce("git-operation-failed");
				return;
			}
			settled = true;
			resolveOutput(new Uint8Array(Buffer.concat(stdout)));
		});
		child.stdin.on("error", () => undefined);
		child.stdin.end(options.input);
	});
}

function assertNotCancelled(signal: AbortSignal): void {
	if (signal.aborted) throw new SingleBaselineRepositoryMaterializationError("cancelled");
}

function decodeAscii(bytes: Uint8Array): string {
	for (const byte of bytes) {
		if (byte < 0x20 || byte > 0x7e) {
			throw new SingleBaselineRepositoryMaterializationError("invalid-source-tree");
		}
	}
	return Buffer.from(bytes).toString("ascii");
}

function asciiTrim(bytes: Uint8Array): string {
	for (const byte of bytes) {
		if (byte !== 0x09 && byte !== 0x0a && byte !== 0x0d && (byte < 0x20 || byte > 0x7e)) {
			throw new SingleBaselineRepositoryMaterializationError("git-operation-failed");
		}
	}
	return Buffer.from(bytes).toString("ascii").trim();
}

function assertContainedPath(rootPath: string, targetPath: string): void {
	const relativePath = relative(rootPath, targetPath);
	if (relativePath === "" || relativePath === ".." || relativePath.startsWith(`..${sep}`)) {
		throw new SingleBaselineRepositoryMaterializationError("repository-closure-failed");
	}
}

function pathsOverlap(left: string, right: string): boolean {
	return isSameOrDescendant(left, right) || isSameOrDescendant(right, left);
}

function isSameOrDescendant(parent: string, candidate: string): boolean {
	const relativePath = relative(parent, candidate);
	return relativePath === "" || (relativePath !== ".." && !relativePath.startsWith(`..${sep}`));
}

async function pathExists(path: string): Promise<boolean> {
	try {
		await lstat(path);
		return true;
	} catch (error) {
		if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
			return false;
		}
		throw new SingleBaselineRepositoryMaterializationError("repository-closure-failed");
	}
}
