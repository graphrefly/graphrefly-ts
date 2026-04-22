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
import type { CqrsGraph } from "../../patterns/cqrs.js";
import {
	COMMAND_HANDLERS,
	type CommandHandlerMeta,
	CQRS_EVENT_HANDLERS,
	CRON_HANDLERS,
	type DecoratorBoundMethod,
	type DecoratorHostConstructor,
	EVENT_HANDLERS,
	type EventHandlerMeta,
	type GraphCronMeta,
	type GraphIntervalMeta,
	INTERVAL_HANDLERS,
	type OnGraphEventMeta,
	QUERY_HANDLERS,
	type QueryHandlerMeta,
	SAGA_HANDLERS,
	type SagaHandlerMeta,
} from "./decorators.js";
import { getGraphToken } from "./tokens.js";

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
		this.wireCqrsCommands();
		this.wireCqrsEvents();
		this.wireCqrsQueries();
		this.wireCqrsSagas();
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
		const method = (instance as Record<string | symbol, DecoratorBoundMethod>)[meta.methodKey];
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

	private wireIntervalHandler(
		instance: object,
		ctor: DecoratorHostConstructor,
		meta: GraphIntervalMeta,
	): void {
		const method = (instance as Record<string | symbol, DecoratorBoundMethod>)[meta.methodKey];
		if (typeof method !== "function") return;

		const bound = method.bind(instance);
		const className = ctor.name ?? "anonymous";
		const nodeName = `__schedule__.${className}.${String(meta.methodKey)}.${scheduleSeq++}`;

		const timerNode = fromTimer(meta.ms, { period: meta.ms, name: nodeName });
		this.graph.add(timerNode);
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

	private wireCronHandler(
		instance: object,
		ctor: DecoratorHostConstructor,
		meta: GraphCronMeta,
	): void {
		const method = (instance as Record<string | symbol, DecoratorBoundMethod>)[meta.methodKey];
		if (typeof method !== "function") return;

		const bound = method.bind(instance);
		const className = ctor.name ?? "anonymous";
		const nodeName = `__schedule__.${className}.${String(meta.methodKey)}.${scheduleSeq++}`;

		const cronNode = fromCron(meta.expr, { name: nodeName });
		this.graph.add(cronNode);
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
	// @CommandHandler — register method as CqrsGraph command handler
	// -----------------------------------------------------------------------

	private wireCqrsCommands(): void {
		for (const [ctor, metas] of COMMAND_HANDLERS) {
			const instance = this.resolveInstance(ctor);
			if (!instance) continue;

			for (const meta of metas) {
				this.wireCqrsCommand(instance, meta);
			}
		}
	}

	private wireCqrsCommand(instance: object, meta: CommandHandlerMeta): void {
		const method = (instance as Record<string | symbol, DecoratorBoundMethod>)[meta.methodKey];
		if (typeof method !== "function") return;

		const bound = method.bind(instance);
		const cqrsGraph = this.resolveCqrsGraph(meta.cqrsName);
		if (!cqrsGraph) return;

		cqrsGraph.command(meta.commandName, bound);
	}

	// -----------------------------------------------------------------------
	// @EventHandler — subscribe method to CQRS event stream
	// -----------------------------------------------------------------------

	private wireCqrsEvents(): void {
		for (const [ctor, metas] of CQRS_EVENT_HANDLERS) {
			const instance = this.resolveInstance(ctor);
			if (!instance) continue;

			for (const meta of metas) {
				this.wireCqrsEventHandler(instance, meta);
			}
		}
	}

	private wireCqrsEventHandler(instance: object, meta: EventHandlerMeta): void {
		const method = (instance as Record<string | symbol, DecoratorBoundMethod>)[meta.methodKey];
		if (typeof method !== "function") return;

		const bound = method.bind(instance);
		const cqrsGraph = this.resolveCqrsGraph(meta.cqrsName);
		if (!cqrsGraph) return;

		// Ensure the event stream exists.
		cqrsGraph.event(meta.eventName);

		// Snapshot the highest seq already in the log so we only deliver new events.
		// Tracking by seq (monotonic per-graph) is robust against reactive log trim.
		const eventNode = cqrsGraph.resolve(meta.eventName);
		const existingEntries = eventNode.cache as readonly { seq: number }[] | undefined;
		let lastSeq =
			existingEntries && existingEntries.length > 0
				? existingEntries[existingEntries.length - 1].seq
				: 0;

		// Subscribe reactively via graph.observe() — respects actor guards.
		const handle = this.observeNodeOn(cqrsGraph, meta.eventName);
		const unsub = handle.subscribe((msgs: Messages) => {
			for (const m of msgs) {
				if (m[0] === DATA) {
					const entries = m[1] as readonly { seq: number }[];
					for (const entry of entries) {
						if (entry.seq > lastSeq) {
							bound(entry);
							lastSeq = entry.seq;
						}
					}
				}
			}
		});
		this.disposers.push(unsub);
	}

	// -----------------------------------------------------------------------
	// @QueryHandler — subscribe method to CQRS projection changes
	// -----------------------------------------------------------------------

	private wireCqrsQueries(): void {
		for (const [ctor, metas] of QUERY_HANDLERS) {
			const instance = this.resolveInstance(ctor);
			if (!instance) continue;

			for (const meta of metas) {
				this.wireCqrsQuery(instance, meta);
			}
		}
	}

	private wireCqrsQuery(instance: object, meta: QueryHandlerMeta): void {
		const method = (instance as Record<string | symbol, DecoratorBoundMethod>)[meta.methodKey];
		if (typeof method !== "function") return;

		const bound = method.bind(instance);
		const cqrsGraph = this.resolveCqrsGraph(meta.cqrsName);
		if (!cqrsGraph) return;

		// Subscribe reactively to the projection node — push on every DATA.
		const handle = this.observeNodeOn(cqrsGraph, meta.projectionName);
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
	// @SagaHandler — register method as CqrsGraph saga (subgraph side effect)
	// -----------------------------------------------------------------------

	private wireCqrsSagas(): void {
		for (const [ctor, metas] of SAGA_HANDLERS) {
			const instance = this.resolveInstance(ctor);
			if (!instance) continue;

			for (const meta of metas) {
				this.wireCqrsSaga(instance, meta);
			}
		}
	}

	private wireCqrsSaga(instance: object, meta: SagaHandlerMeta): void {
		const method = (instance as Record<string | symbol, DecoratorBoundMethod>)[meta.methodKey];
		if (typeof method !== "function") return;

		const bound = method.bind(instance);
		const cqrsGraph = this.resolveCqrsGraph(meta.cqrsName);
		if (!cqrsGraph) return;

		cqrsGraph.saga(meta.sagaName, meta.eventNames, bound);
	}

	// -----------------------------------------------------------------------
	// Helpers
	// -----------------------------------------------------------------------

	private observeNode(name: string): GraphObserveOne {
		// Overload resolution picks ObserveResult; cast to the correct single-node type.
		return this.graph.observe(name) as unknown as GraphObserveOne;
	}

	private observeNodeOn(graph: Graph, name: string): GraphObserveOne {
		return graph.observe(name) as unknown as GraphObserveOne;
	}

	private resolveCqrsGraph(name: string): CqrsGraph | null {
		try {
			return this.moduleRef.get(getGraphToken(name), { strict: false }) as CqrsGraph;
		} catch {
			console.warn(
				`[GraphReFly] CqrsGraph "${name}" not found in DI — ` +
					`did you import GraphReflyModule.forCqrs({ name: "${name}" })?`,
			);
			return null;
		}
	}

	private resolveInstance(ctor: DecoratorHostConstructor): object | null {
		try {
			return this.moduleRef.get(ctor, { strict: false });
		} catch {
			return null;
		}
	}
}
