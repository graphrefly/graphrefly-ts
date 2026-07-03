const STORAGE_NAMESPACE_PREFIX = "storage-namespace";

function tupleKey(parts: readonly string[]): string {
	return JSON.stringify(parts);
}

function parseTupleKey(value: string): readonly string[] | undefined {
	let parsed: unknown;
	try {
		parsed = JSON.parse(value);
	} catch {
		return undefined;
	}
	if (!Array.isArray(parsed) || !parsed.every((part) => typeof part === "string")) {
		return undefined;
	}
	return Object.freeze([...parsed]);
}

export function storagePhysicalKey(namespace: string, logicalKey: string): string {
	return `${STORAGE_NAMESPACE_PREFIX}:${tupleKey([namespace, logicalKey])}`;
}

export function decodeStoragePhysicalKey(
	namespace: string,
	rawKey: string,
	malformedMessage: string,
): string | undefined {
	const tupleKeyValue = rawKey.startsWith(`${STORAGE_NAMESPACE_PREFIX}:`)
		? rawKey.slice(STORAGE_NAMESPACE_PREFIX.length + 1)
		: undefined;
	if (tupleKeyValue === undefined) return undefined;
	const tuple = parseTupleKey(tupleKeyValue);
	if (tuple === undefined || tuple[0] !== namespace) return undefined;
	if (tuple.length !== 2) {
		throw new TypeError(malformedMessage);
	}
	return tuple[1];
}

export function contentAddressedStorageKey(keyPrefix: string, hashHex: string): string {
	return `${keyPrefix}:${tupleKey([hashHex])}`;
}
