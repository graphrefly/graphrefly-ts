import { empiricalSha256, empiricalStrictJsonDigest, fail, strictSnapshot } from "./canonical.js";

export const CANONICAL_REPOSITORY_TREE_SCHEMA_VERSION =
	"graphrefly.private-solution-eval.canonical-repository-tree.v1" as const;
export const PRIVATE_REPOSITORY_OVERLAY_SCHEMA_VERSION =
	"graphrefly.private-solution-eval.private-repository-overlay.v1" as const;

export const MAX_CANONICAL_REPOSITORY_ENTRIES = 4096;
export const MAX_CANONICAL_REPOSITORY_TOTAL_BYTES = 64 * 1024 * 1024;
export const MAX_CANONICAL_REPOSITORY_FILE_BYTES = 4 * 1024 * 1024;
export const MAX_CANONICAL_REPOSITORY_PATH_BYTES = 512;
export const MAX_CANONICAL_REPOSITORY_COMPONENT_BYTES = 255;
export const MAX_PRIVATE_REPOSITORY_OVERLAY_REPLACEMENTS = 16;

const PORTABLE_COMPONENT = /^[A-Za-z0-9._@+-]+$/;
const textEncoder = new TextEncoder();

export type CanonicalRepositoryFileModeV1 = "100644" | "100755";

export interface PrivateCanonicalRepositoryFileV1 {
	readonly path: string;
	readonly mode: CanonicalRepositoryFileModeV1;
	readonly bytes: Uint8Array;
}

export interface CanonicalRepositoryTreeEntryV1 {
	readonly path: string;
	readonly mode: CanonicalRepositoryFileModeV1;
	readonly byteLength: number;
	readonly contentDigest: string;
}

export interface CanonicalRepositoryTreeV1 {
	readonly schemaVersion: typeof CANONICAL_REPOSITORY_TREE_SCHEMA_VERSION;
	readonly entries: readonly CanonicalRepositoryTreeEntryV1[];
}

export interface CanonicalRepositoryTreeMaterialV1 {
	readonly tree: CanonicalRepositoryTreeV1;
	readonly treeDigest: string;
	readonly totalBytes: number;
}

const privateFilesByMaterial = new WeakMap<
	CanonicalRepositoryTreeMaterialV1,
	readonly PrivateCanonicalRepositoryFileV1[]
>();

export interface PrivateRepositoryOverlayReplacementV1 {
	readonly path: string;
	readonly baseMode: CanonicalRepositoryFileModeV1;
	readonly baseContentDigest: string;
	readonly replacementByteLength: number;
	readonly replacementContentDigest: string;
	readonly replacementBytes: Uint8Array;
}

export interface PrivateRepositoryOverlayV1 {
	readonly schemaVersion: typeof PRIVATE_REPOSITORY_OVERLAY_SCHEMA_VERSION;
	readonly replacements: readonly PrivateRepositoryOverlayReplacementV1[];
}

export interface AppliedPrivateRepositoryOverlayV1 {
	readonly material: CanonicalRepositoryTreeMaterialV1;
	readonly overlayDigest: string;
}

export function createCanonicalRepositoryTreeMaterial(
	inputFiles: readonly PrivateCanonicalRepositoryFileV1[],
): CanonicalRepositoryTreeMaterialV1 {
	const inputValues = densePlainArray(
		inputFiles,
		MAX_CANONICAL_REPOSITORY_ENTRIES,
		"repositoryTree.entries",
	);
	const files = inputValues.map((input, index) =>
		canonicalFile(input as PrivateCanonicalRepositoryFileV1, index),
	);
	files.sort((left, right) => comparePortablePaths(left.path, right.path));
	const seenPaths = new Set<string>();
	const seenFoldedPaths = new Set<string>();
	let totalBytes = 0;
	for (const file of files) {
		if (seenPaths.has(file.path)) fail("repositoryTree.entries", "contains a duplicate path");
		seenPaths.add(file.path);
		const folded = file.path.toLowerCase();
		if (seenFoldedPaths.has(folded)) {
			fail("repositoryTree.entries", "contains a case-fold path collision");
		}
		seenFoldedPaths.add(folded);
		totalBytes += file.bytes.byteLength;
		if (!Number.isSafeInteger(totalBytes) || totalBytes > MAX_CANONICAL_REPOSITORY_TOTAL_BYTES) {
			fail(
				"repositoryTree.entries",
				`exceeds the ${MAX_CANONICAL_REPOSITORY_TOTAL_BYTES} byte total limit`,
			);
		}
	}
	const entries = files.map((file) =>
		strictSnapshot({
			path: file.path,
			mode: file.mode,
			byteLength: file.bytes.byteLength,
			contentDigest: empiricalSha256(file.bytes),
		}),
	);
	const tree = strictSnapshot({
		schemaVersion: CANONICAL_REPOSITORY_TREE_SCHEMA_VERSION,
		entries,
	});
	const material = Object.freeze({
		tree,
		treeDigest: empiricalStrictJsonDigest(tree),
		totalBytes,
	});
	privateFilesByMaterial.set(material, Object.freeze(files));
	return material;
}

export function privateCanonicalRepositoryFiles(
	material: CanonicalRepositoryTreeMaterialV1,
): readonly PrivateCanonicalRepositoryFileV1[] {
	const files = privateFilesByMaterial.get(material);
	if (files === undefined) fail("repositoryTree", "is not canonical material");
	return Object.freeze(
		files.map((file) =>
			Object.freeze({
				path: file.path,
				mode: file.mode,
				bytes: new Uint8Array(file.bytes),
			}),
		),
	);
}

export function applyPrivateRepositoryOverlay(
	base: CanonicalRepositoryTreeMaterialV1,
	overlayValue: PrivateRepositoryOverlayV1,
): AppliedPrivateRepositoryOverlayV1 {
	const overlay = validatePrivateRepositoryOverlay(overlayValue);
	const filesByPath = new Map(
		privateCanonicalRepositoryFiles(base).map((file) => [file.path, file] as const),
	);
	for (const replacement of overlay.replacements) {
		const baseFile = filesByPath.get(replacement.path);
		if (baseFile === undefined) {
			fail("repositoryOverlay.replacements", "replacement path is not an existing regular file");
		}
		if (
			baseFile.mode !== replacement.baseMode ||
			empiricalSha256(baseFile.bytes) !== replacement.baseContentDigest
		) {
			fail("repositoryOverlay.replacements", "replacement base material does not match");
		}
		if (
			baseFile.bytes.byteLength === replacement.replacementByteLength &&
			replacement.baseContentDigest === replacement.replacementContentDigest
		) {
			fail("repositoryOverlay.replacements", "replacement must change exact file bytes");
		}
		filesByPath.set(
			replacement.path,
			Object.freeze({
				path: replacement.path,
				mode: replacement.baseMode,
				bytes: new Uint8Array(replacement.replacementBytes),
			}),
		);
	}
	const material = createCanonicalRepositoryTreeMaterial([...filesByPath.values()]);
	if (material.treeDigest === base.treeDigest) {
		fail("repositoryOverlay", "overlay must produce a distinct actor tree");
	}
	const publicOverlay = strictSnapshot({
		schemaVersion: overlay.schemaVersion,
		replacements: overlay.replacements.map((replacement) => ({
			path: replacement.path,
			baseMode: replacement.baseMode,
			baseContentDigest: replacement.baseContentDigest,
			replacementByteLength: replacement.replacementByteLength,
			replacementContentDigest: replacement.replacementContentDigest,
		})),
	});
	return Object.freeze({
		material,
		overlayDigest: empiricalStrictJsonDigest(publicOverlay),
	});
}

export function validatePrivateRepositoryOverlay(
	value: PrivateRepositoryOverlayV1,
): PrivateRepositoryOverlayV1 {
	const overlay = exactDataRecord(value, ["replacements", "schemaVersion"], "repositoryOverlay");
	if (
		overlay.schemaVersion !== PRIVATE_REPOSITORY_OVERLAY_SCHEMA_VERSION ||
		!Array.isArray(overlay.replacements)
	) {
		fail("repositoryOverlay", "has a malformed schema or replacement list");
	}
	const replacementValues = densePlainArray(
		overlay.replacements,
		MAX_PRIVATE_REPOSITORY_OVERLAY_REPLACEMENTS,
		"repositoryOverlay.replacements",
	);
	if (
		replacementValues.length < 1 ||
		replacementValues.length > MAX_PRIVATE_REPOSITORY_OVERLAY_REPLACEMENTS
	) {
		fail(
			"repositoryOverlay.replacements",
			`expected between 1 and ${MAX_PRIVATE_REPOSITORY_OVERLAY_REPLACEMENTS} replacements`,
		);
	}
	const replacements = replacementValues.map((entry, index) => {
		const path = `repositoryOverlay.replacements[${index}]`;
		const replacement = exactDataRecord(
			entry,
			[
				"baseContentDigest",
				"baseMode",
				"path",
				"replacementByteLength",
				"replacementBytes",
				"replacementContentDigest",
			],
			path,
		);
		const portablePath = assertPortableRepositoryPath(replacement.path, `${path}.path`);
		const baseMode = fileMode(replacement.baseMode, `${path}.baseMode`);
		const baseContentDigest = sha256Digest(
			replacement.baseContentDigest,
			`${path}.baseContentDigest`,
		);
		const replacementBytes = copyExactBytes(
			replacement.replacementBytes,
			`${path}.replacementBytes`,
		);
		if (
			replacementBytes.byteLength > MAX_CANONICAL_REPOSITORY_FILE_BYTES ||
			replacement.replacementByteLength !== replacementBytes.byteLength
		) {
			fail(`${path}.replacementByteLength`, "does not match bounded replacement bytes");
		}
		const replacementContentDigest = sha256Digest(
			replacement.replacementContentDigest,
			`${path}.replacementContentDigest`,
		);
		if (replacementContentDigest !== empiricalSha256(replacementBytes)) {
			fail(`${path}.replacementContentDigest`, "does not match replacement bytes");
		}
		return Object.freeze({
			path: portablePath,
			baseMode,
			baseContentDigest,
			replacementByteLength: replacementBytes.byteLength,
			replacementContentDigest,
			replacementBytes,
		});
	});
	for (let index = 1; index < replacements.length; index += 1) {
		const order = comparePortablePaths(replacements[index - 1].path, replacements[index].path);
		if (order === 0) fail("repositoryOverlay.replacements", "contains a duplicate path");
		if (order > 0) fail("repositoryOverlay.replacements", "must be sorted by path bytes");
	}
	return Object.freeze({
		schemaVersion: PRIVATE_REPOSITORY_OVERLAY_SCHEMA_VERSION,
		replacements: Object.freeze(replacements),
	});
}

export function assertPortableRepositoryPath(value: unknown, path: string): string {
	if (typeof value !== "string" || value.length === 0 || value.startsWith("/")) {
		return fail(path, "must be a non-empty relative portable ASCII path");
	}
	if (
		value.includes("\\") ||
		textEncoder.encode(value).byteLength > MAX_CANONICAL_REPOSITORY_PATH_BYTES
	) {
		fail(path, "contains a backslash or exceeds the path byte limit");
	}
	const components = value.split("/");
	for (const component of components) {
		if (
			component === "" ||
			component === "." ||
			component === ".." ||
			component.toLowerCase() === ".git" ||
			!PORTABLE_COMPONENT.test(component) ||
			textEncoder.encode(component).byteLength > MAX_CANONICAL_REPOSITORY_COMPONENT_BYTES
		) {
			fail(path, "contains a forbidden or non-portable path component");
		}
	}
	return value;
}

export function comparePortablePaths(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalFile(
	value: PrivateCanonicalRepositoryFileV1,
	index: number,
): PrivateCanonicalRepositoryFileV1 {
	const path = `repositoryTree.entries[${index}]`;
	const file = exactDataRecord(value, ["bytes", "mode", "path"], path);
	const bytes = copyExactBytes(file.bytes, `${path}.bytes`);
	return Object.freeze({
		path: assertPortableRepositoryPath(file.path, `${path}.path`),
		mode: fileMode(file.mode, `${path}.mode`),
		bytes,
	});
}

function copyExactBytes(value: unknown, path: string): Uint8Array {
	if (!(value instanceof Uint8Array) || Object.getPrototypeOf(value) !== Uint8Array.prototype) {
		return fail(path, "must be an exact Uint8Array");
	}
	if (value.byteLength > MAX_CANONICAL_REPOSITORY_FILE_BYTES) {
		fail(path, `exceeds the ${MAX_CANONICAL_REPOSITORY_FILE_BYTES} byte file limit`);
	}
	return new Uint8Array(value);
}

function plainRecord(value: unknown, path: string): Record<string, unknown> {
	if (
		typeof value !== "object" ||
		value === null ||
		Array.isArray(value) ||
		(Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
	) {
		return fail(path, "must be a plain object");
	}
	return value as Record<string, unknown>;
}

function exactDataRecord(
	value: unknown,
	keys: readonly string[],
	path: string,
): Record<string, unknown> {
	const record = plainRecord(value, path);
	const descriptors = Object.getOwnPropertyDescriptors(record);
	const actual = Object.keys(descriptors).sort();
	const expected = [...keys].sort();
	if (
		Object.getOwnPropertySymbols(record).length !== 0 ||
		actual.length !== expected.length ||
		actual.some((entry, index) => entry !== expected[index]) ||
		Object.values(descriptors).some(
			(descriptor) => !descriptor.enumerable || !("value" in descriptor),
		)
	) {
		fail(path, "has unexpected, missing, accessor, or non-enumerable fields");
	}
	return Object.fromEntries(
		keys.map((key) => [key, (descriptors[key] as PropertyDescriptor & { value: unknown }).value]),
	);
}

function densePlainArray(value: unknown, maximumLength: number, path: string): readonly unknown[] {
	if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
		return fail(path, "must be a plain dense array");
	}
	const descriptors = Object.getOwnPropertyDescriptors(value) as Record<string, PropertyDescriptor>;
	const lengthDescriptor = descriptors.length;
	if (
		lengthDescriptor === undefined ||
		!("value" in lengthDescriptor) ||
		typeof lengthDescriptor.value !== "number" ||
		!Number.isSafeInteger(lengthDescriptor.value) ||
		lengthDescriptor.value < 0 ||
		lengthDescriptor.value > maximumLength
	) {
		return fail(path, `must have an exact data length no greater than ${maximumLength}`);
	}
	const length = lengthDescriptor.value as number;
	const expectedKeys = Array.from({ length }, (_, index) => String(index));
	const actualKeys = Object.keys(descriptors)
		.filter((key) => key !== "length")
		.sort((left, right) => Number(left) - Number(right));
	if (
		Object.getOwnPropertySymbols(value).length !== 0 ||
		actualKeys.length !== expectedKeys.length ||
		actualKeys.some((key, index) => key !== expectedKeys[index])
	) {
		return fail(path, "must be dense and contain no extra fields");
	}
	const result: unknown[] = [];
	for (const key of expectedKeys) {
		const descriptor = descriptors[key];
		if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) {
			return fail(path, "must contain only enumerable data entries");
		}
		result.push(descriptor.value);
	}
	return Object.freeze(result);
}

function fileMode(value: unknown, path: string): CanonicalRepositoryFileModeV1 {
	if (value !== "100644" && value !== "100755") {
		return fail(path, "expected regular mode 100644 or 100755");
	}
	return value;
}

function sha256Digest(value: unknown, path: string): string {
	if (typeof value !== "string" || !/^sha256:[a-f0-9]{64}$/.test(value)) {
		return fail(path, "must be a lowercase sha256 digest");
	}
	return value;
}
