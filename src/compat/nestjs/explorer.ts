// ---------------------------------------------------------------------------
// GraphReflyEventExplorer — discovers @OnGraphEvent, @GraphInterval, @GraphCron
// decorated methods and wires them to the root graph.
// ---------------------------------------------------------------------------
// Registered by `forRoot()`. On module init, reads global decorator registries,
// resolves provider instances via ModuleRef, and creates reactive subscriptions
// / timer nodes. On module destroy, disposes all subscriptions and removes
// schedule nodes from the graph.
//
// Runtime is fully reactive — push-based via graph.observe().
// No polling, no microtasks, no promises. Timer nodes use central fromTimer /
// fromCron primitives.
// ---------------------------------------------------------------------------

import type { OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import type { ModuleRef } from "@nestjs/core";
import { DATA, type Messages } from "../../core/messages.js";
import { fromCron, fromTimer } from "../../extra/sources.js";
import type { Graph, GraphObserveOne } from "../../graph/graph.js";
import {
	CRON_HANDLERS,
	EVENT_HANDLERS,
	type GraphCronMeta,
	type GraphIntervalMeta,
	INTERVAL_HANDLERS,
	type OnGraphEventMeta,
} from "./decorators.js";

/** Monotonic counter for schedule node name disambiguation. */
let scheduleSeq = 0;

export class GraphReflyEventExplorer implements OnModuleInit, OnModuleDestroy {
	private readonly disposers: Array<() => void> = [];
	private readonly scheduleNodeNames: string[] = [];

	constructor(
		private readonly graph: Graph,
		private readonly moduleRef: ModuleRef,
	) {}

	onModuleInit(): void {
		this.wireEvents();
		this.wireIntervals();
		this.wireCrons();
	}

	onModuleDestroy(): void {
		for (const dispose of this.disposers) dispose();
		this.disposers.length = 0;

		for (const name of this.scheduleNodeNames) {
			try {
				this.graph.remove(name);
			} catch {
				// Node may already be gone if graph.destroy() ran first.
			}
		}
		this.scheduleNodeNames.length = 0;
	}

	// -----------------------------------------------------------------------
	// @OnGraphEvent — reactive subscription via graph.observe()
	// -----------------------------------------------------------------------

	private wireEvents(): void {
		for (const [ctor, metas] of EVENT_HANDLERS) {
			const instance = this.resolveInstance(ctor);
			if (!instance) continue;

			for (const meta of metas) {
				this.wireEventHandler(instance, meta);
			}
		}
	}

	private wireEventHandler(instance: object, meta: OnGraphEventMeta): void {
		const method = (instance as Record<string | symbol, Function>)[meta.methodKey];
		if (typeof method !== "function") return;

		const bound = method.bind(instance);

		// Route through graph.observe() so actor guards are respected.
		const handle = this.observeNode(meta.nodeName);
		const unsub = handle.subscribe((msgs: Messages) => {
			for (const m of msgs) {
				if (m[0] === DATA) {
					bound(m[1]);
				}
			}
		});
		this.disposers.push(unsub);
	}

	// -----------------------------------------------------------------------
	// @GraphInterval — reactive via fromTimer central timer primitive
	// -----------------------------------------------------------------------

	private wireIntervals(): void {
		for (const [ctor, metas] of INTERVAL_HANDLERS) {
			const instance = this.resolveInstance(ctor);
			if (!instance) continue;

			for (const meta of metas) {
				this.wireIntervalHandler(instance, ctor, meta);
			}
		}
	}

	private wireIntervalHandler(instance: object, ctor: Function, meta: GraphIntervalMeta): void {
		const method = (instance as Record<string | symbol, Function>)[meta.methodKey];
		if (typeof method !== "function") return;

		const bound = method.bind(instance);
		const className = ctor.name ?? "anonymous";
		const nodeName = `__schedule__.${className}.${String(meta.methodKey)}.${scheduleSeq++}`;

		const timerNode = fromTimer(meta.ms, { period: meta.ms, name: nodeName });
		this.graph.add(nodeName, timerNode);
		this.scheduleNodeNames.push(nodeName);

		// Subscribe through graph.observe() for consistency.
		const handle = this.observeNode(nodeName);
		const unsub = handle.subscribe((msgs: Messages) => {
			for (const m of msgs) {
				if (m[0] === DATA) bound(m[1]);
			}
		});
		this.disposers.push(unsub);
	}

	// -----------------------------------------------------------------------
	// @GraphCron — reactive via fromCron central timer primitive
	// -----------------------------------------------------------------------

	private wireCrons(): void {
		for (const [ctor, metas] of CRON_HANDLERS) {
			const instance = this.resolveInstance(ctor);
			if (!instance) continue;

			for (const meta of metas) {
				this.wireCronHandler(instance, ctor, meta);
			}
		}
	}

	private wireCronHandler(instance: object, ctor: Function, meta: GraphCronMeta): void {
		const method = (instance as Record<string | symbol, Function>)[meta.methodKey];
		if (typeof method !== "function") return;

		const bound = method.bind(instance);
		const className = ctor.name ?? "anonymous";
		const nodeName = `__schedule__.${className}.${String(meta.methodKey)}.${scheduleSeq++}`;

		const cronNode = fromCron(meta.expr, { name: nodeName });
		this.graph.add(nodeName, cronNode);
		this.scheduleNodeNames.push(nodeName);

		// Subscribe through graph.observe() for consistency.
		const handle = this.observeNode(nodeName);
		const unsub = handle.subscribe((msgs: Messages) => {
			for (const m of msgs) {
				if (m[0] === DATA) bound(m[1]);
			}
		});
		this.disposers.push(unsub);
	}

	// -----------------------------------------------------------------------
	// Helpers
	// -----------------------------------------------------------------------

	private observeNode(name: string): GraphObserveOne {
		// Overload resolution picks ObserveResult; cast to the correct single-node type.
		return this.graph.observe(name) as unknown as GraphObserveOne;
	}

	private resolveInstance(ctor: Function): object | null {
		try {
			return this.moduleRef.get(ctor, { strict: false });
		} catch {
			return null;
		}
	}
}
