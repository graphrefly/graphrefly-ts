/**
 * Filesystem-watching source. Isolated from `./sources.ts` so bundlers
 * targeting the browser can import browser-safe sources (`fromTimer`,
 * `fromRaf`, etc.) without pulling in `node:fs`/`node:path`.
 */

import { existsSync, watch } from "node:fs";
import { resolve as resolvePath } from "node:path";
import {
	DATA,
	ERROR,
	type Message,
	type Node,
	type NodeOptions,
	node,
	wallClockNs,
} from "@graphrefly/pure-ts/core";
import { globToRegExp, matchesAnyPattern } from "@graphrefly/pure-ts/extra";

type ExtraOpts = Omit<NodeOptions<unknown>, "describeKind">;

function sourceOpts<T = unknown>(opts?: ExtraOpts): NodeOptions<T> {
	return { describeKind: "producer", ...opts } as NodeOptions<T>;
}

export type FSEventType = "change" | "rename" | "create" | "delete";
export type FSEvent = {
	type: FSEventType;
	path: string;
	root: string;
	relative_path: string;
	src_path?: string;
	dest_path?: string;
	timestamp_ns: number;
};

export type FromFSWatchOptions = ExtraOpts & {
	recursive?: boolean;
	debounce?: number;
	include?: string[];
	exclude?: string[];
};

/**
 * Watches filesystem paths and emits debounced change events.
 *
 * Uses `fs.watch` only (no polling fallback). Teardown closes all watchers.
 *
 * @category extra
 */
export function fromFSWatch(paths: string | string[], opts?: FromFSWatchOptions): Node<FSEvent> {
	const list = Array.isArray(paths) ? paths : [paths];
	if (list.length === 0) {
		throw new RangeError("fromFSWatch expects at least one path");
	}
	const { recursive = true, debounce = 100, include, exclude, ...rest } = opts ?? {};
	const includePatterns = include?.map(globToRegExp) ?? [];
	const excludePatterns = (exclude ?? ["**/node_modules/**", "**/.git/**", "**/dist/**"]).map(
		globToRegExp,
	);
	return node<FSEvent>((_data, a) => {
		const pending = new Map<string, FSEvent>();
		const watchers: ReturnType<typeof watch>[] = [];
		let stopped = false;
		let terminalEmitted = false;
		let generation = 0;
		const closeWatchers = () => {
			for (const watcher of watchers.splice(0)) watcher.close();
		};
		const emitError = (err: unknown) => {
			if (terminalEmitted) return;
			terminalEmitted = true;
			stopped = true;
			if (timer !== undefined) clearTimeout(timer);
			timer = undefined;
			pending.clear();
			closeWatchers();
			a.down([[ERROR, err]]);
		};
		let timer: ReturnType<typeof setTimeout> | undefined;
		const flush = (token: number) => {
			timer = undefined;
			if (stopped || terminalEmitted) return;
			if (pending.size === 0) return;
			const batchMessages: Message[] = [];
			for (const evt of pending.values()) batchMessages.push([DATA, evt]);
			pending.clear();
			if (stopped || terminalEmitted || token !== generation) return;
			a.down(batchMessages);
		};
		try {
			for (const basePath of list) {
				const watcher = watch(
					basePath,
					{ recursive },
					(eventType: "rename" | "change", fileName: string | Buffer | null) => {
						if (stopped || terminalEmitted) return;
						if (fileName == null) return;
						const rel = String(fileName).replaceAll("\\", "/");
						const abs = resolvePath(basePath, String(fileName));
						const normalized = abs.replaceAll("\\", "/");
						const root = resolvePath(basePath).replaceAll("\\", "/");
						const relForMatch = rel.startsWith("./") ? rel.slice(2) : rel;
						const included =
							includePatterns.length === 0 ||
							matchesAnyPattern(normalized, includePatterns) ||
							matchesAnyPattern(relForMatch, includePatterns);
						if (!included) return;
						const excluded =
							matchesAnyPattern(normalized, excludePatterns) ||
							matchesAnyPattern(relForMatch, excludePatterns);
						if (excluded) return;
						let kind: FSEventType = "change";
						if (eventType === "rename") {
							try {
								kind = existsSync(normalized) ? "create" : "delete";
							} catch {
								kind = "rename";
							}
						}
						pending.set(normalized, {
							type: kind,
							path: normalized,
							root,
							relative_path: relForMatch,
							timestamp_ns: wallClockNs(),
						});
						if (timer !== undefined) clearTimeout(timer);
						const token = generation;
						timer = setTimeout(() => flush(token), debounce);
					},
				);
				watcher.on("error", (err) => emitError(err));
				watchers.push(watcher);
			}
		} catch (err) {
			emitError(err);
		}
		return () => {
			stopped = true;
			generation += 1;
			if (timer !== undefined) clearTimeout(timer);
			timer = undefined;
			closeWatchers();
			pending.clear();
		};
	}, sourceOpts(rest));
}
