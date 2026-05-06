// ---------------------------------------------------------------------------
// GraphReflyModule — NestJS dynamic module for GraphReFly integration.
// ---------------------------------------------------------------------------
// Provides `forRoot()` and `forFeature()` following the standard NestJS
// dynamic-module pattern. Lifecycle hooks wire graph creation on init and
// `graph.destroy()` on teardown — TEARDOWN propagates through the graph
// per GRAPHREFLY-SPEC §3.7.
//
// No decorator usage in this file — all DI is done via factory providers
// so the library doesn't require `experimentalDecorators` in consumer's
// tsconfig (only the consumer's NestJS app needs it).
// ---------------------------------------------------------------------------

import {
	type DynamicModule,
	Module,
	type OnModuleDestroy,
	type Provider,
	Scope,
} from "@nestjs/common";
import { ModuleRef } from "@nestjs/core";
import type { AppendLogStorageTier } from "../../extra/storage-tiers.js";
import { Graph, type GraphPersistSnapshot } from "../../graph/graph.js";
import { type CqrsGraph, type CqrsOptions, cqrs } from "../../patterns/cqrs/index.js";
import { GraphReflyEventExplorer } from "./explorer.js";
import {
	GRAPHREFLY_REQUEST_GRAPH,
	GRAPHREFLY_ROOT_GRAPH,
	getGraphToken,
	getNodeToken,
} from "./tokens.js";

// ---------------------------------------------------------------------------
// Option types
// ---------------------------------------------------------------------------

export interface GraphReflyRootOptions {
	/** Root graph name (default: `"root"`). */
	name?: string;
	/** Snapshot to hydrate via `graph.restore()` after build. */
	snapshot?: GraphPersistSnapshot;
	/** Build callback — registers nodes/mounts on the graph. */
	build?: (graph: Graph) => void;
	/** Qualified node paths to expose as injectable providers. */
	nodes?: readonly string[];
	/** Enable a request-scoped graph (injectable via `@InjectGraph("request")`). */
	requestScope?: boolean;
}

export interface GraphReflyCqrsOptions {
	/** Feature name — becomes the mount name in the root graph. */
	name: string;
	/** CQRS graph options (forwarded to `cqrs()` factory). */
	cqrs?: CqrsOptions;
	/** Build callback — registers commands, events, projections, sagas on the CqrsGraph. */
	build?: (graph: CqrsGraph) => void;
	/** Append-log storage tiers for event persistence (wired via `attachEventStorage()`). */
	eventStorage?: readonly AppendLogStorageTier<import("../../patterns/cqrs/index.js").CqrsEvent>[];
	/**
	 * Node paths (local to this feature) to expose as injectable providers.
	 * Tokens are auto-qualified as `featureName::path`.
	 */
	nodes?: readonly string[];
}

export interface GraphReflyFeatureOptions {
	/** Feature name — becomes the mount name in the root graph. */
	name: string;
	/** Build callback — registers nodes/mounts on the feature graph. */
	build?: (graph: Graph) => void;
	/** Snapshot to hydrate after build. */
	snapshot?: GraphPersistSnapshot;
	/**
	 * Node paths (local to this feature) to expose as injectable providers.
	 * Tokens are auto-qualified as `featureName::path` to avoid collisions.
	 */
	nodes?: readonly string[];
}

// ---------------------------------------------------------------------------
// Lifecycle classes (no decorators — DI is handled via factory providers)
// ---------------------------------------------------------------------------

class GraphReflyRootLifecycle implements OnModuleDestroy {
	constructor(readonly graph: Graph) {}

	onModuleDestroy(): void {
		this.graph.destroy();
	}
}

class GraphReflyRequestLifecycle implements OnModuleDestroy {
	readonly graph = new Graph("request");

	onModuleDestroy(): void {
		this.graph.destroy();
	}
}

// ---------------------------------------------------------------------------
// Module
// ---------------------------------------------------------------------------

// NestJS dynamic modules convention: static `forRoot` / `forFeature` factories on a `@Module` class.
@Module({})
// biome-ignore lint/complexity/noStaticOnlyClass: NestJS `DynamicModule` pattern (`@Module` + static factories)
export class GraphReflyModule {
	/**
	 * Register the root `Graph` singleton in the NestJS DI container.
	 *
	 * The root graph is `@Global()` — injectable everywhere without importing
	 * the module again. Use `@InjectGraph()` to inject it.
	 *
	 * Lifecycle:
	 * - **init:** Graph created in factory. If `build` is provided, it runs
	 *   first (registers nodes/mounts). If `snapshot` is provided, values
	 *   are restored via `graph.restore()`.
	 * - **destroy:** Calls `graph.destroy()` — sends `[[TEARDOWN]]` to all
	 *   nodes, including mounted feature subgraphs (cascading teardown).
	 */
	static forRoot(opts?: GraphReflyRootOptions): DynamicModule {
		const options = opts ?? {};
		const graphName = options.name ?? "root";

		const providers: Provider[] = [
			{
				provide: GRAPHREFLY_ROOT_GRAPH,
				useFactory: () => {
					const g = new Graph(graphName);
					if (options.build) options.build(g);
					if (options.snapshot) g.restore(options.snapshot);
					return g;
				},
			},
			{
				provide: Symbol.for("graphrefly:root-lifecycle"),
				useFactory: (graph: Graph) => new GraphReflyRootLifecycle(graph),
				inject: [GRAPHREFLY_ROOT_GRAPH],
			},
			{
				provide: GraphReflyEventExplorer,
				useFactory: (graph: Graph, moduleRef: InstanceType<typeof ModuleRef>) =>
					new GraphReflyEventExplorer(graph, moduleRef),
				inject: [GRAPHREFLY_ROOT_GRAPH, ModuleRef],
			},
		];

		// Node factory providers — each declared path gets a factory that
		// resolves the node from the root graph at injection time.
		if (options.nodes) {
			for (const path of options.nodes) {
				providers.push({
					provide: getNodeToken(path),
					useFactory: (graph: Graph) => graph.resolve(path),
					inject: [GRAPHREFLY_ROOT_GRAPH],
				});
			}
		}

		// Request-scoped graph provider (opt-in).
		if (options.requestScope) {
			providers.push(
				{
					provide: Symbol.for("graphrefly:request-lifecycle"),
					useFactory: () => new GraphReflyRequestLifecycle(),
					scope: Scope.REQUEST,
				},
				{
					provide: GRAPHREFLY_REQUEST_GRAPH,
					useFactory: (lifecycle: GraphReflyRequestLifecycle) => lifecycle.graph,
					inject: [Symbol.for("graphrefly:request-lifecycle")],
					scope: Scope.REQUEST,
				},
			);
		}

		return {
			module: GraphReflyModule,
			global: true,
			providers,
			exports: [
				GRAPHREFLY_ROOT_GRAPH,
				...(options.nodes ?? []).map(getNodeToken),
				...(options.requestScope ? [GRAPHREFLY_REQUEST_GRAPH] : []),
			],
		};
	}

	/**
	 * Register a feature subgraph that auto-mounts into the root graph.
	 *
	 * The feature graph is created in the factory, built/restored, then
	 * mounted into root via `root.mount(name, featureGraph)`. On app
	 * shutdown, root's `graph.destroy()` cascades TEARDOWN through all
	 * mounted subgraphs (no explicit remove needed).
	 *
	 * Node tokens are auto-qualified as `featureName::path` to prevent
	 * collisions between features declaring nodes with the same local name.
	 *
	 * Injectable via `@InjectGraph(name)`.
	 */
	static forFeature(opts: GraphReflyFeatureOptions): DynamicModule {
		const providers: Provider[] = [
			{
				provide: getGraphToken(opts.name),
				useFactory: (rootGraph: Graph) => {
					const g = new Graph(opts.name);
					if (opts.build) opts.build(g);
					if (opts.snapshot) g.restore(opts.snapshot);
					rootGraph.mount(opts.name, g);
					return g;
				},
				inject: [GRAPHREFLY_ROOT_GRAPH],
			},
		];

		// Node factory providers for feature-scoped nodes.
		// Tokens are qualified as `featureName::path` to avoid cross-feature collisions.
		if (opts.nodes) {
			for (const path of opts.nodes) {
				providers.push({
					provide: getNodeToken(`${opts.name}::${path}`),
					useFactory: (graph: Graph) => graph.resolve(path),
					inject: [getGraphToken(opts.name)],
				});
			}
		}

		return {
			module: GraphReflyModule,
			providers,
			exports: [
				getGraphToken(opts.name),
				...(opts.nodes ?? []).map((p) => getNodeToken(`${opts.name}::${p}`)),
			],
		};
	}

	/**
	 * Register a CQRS subgraph that auto-mounts into the root graph.
	 *
	 * Creates a `CqrsGraph` via the `cqrs()` factory (roadmap §4.5), mounts it
	 * into the root graph, and exposes it for DI via `@InjectGraph(name)`.
	 *
	 * CQRS decorators (`@CommandHandler`, `@EventHandler`, `@QueryHandler`,
	 * `@SagaHandler`) are discovered by the explorer and wired to this graph
	 * on module init.
	 *
	 * @example
	 * ```ts
	 * GraphReflyModule.forCqrs({
	 *   name: "orders",
	 *   build: (g) => {
	 *     g.event("orderPlaced");
	 *     g.projection({ name: "orderCount", events: ["orderPlaced"], reducer: (_s, evts) => evts.length, initial: 0 });
	 *   },
	 * })
	 * ```
	 */
	static forCqrs(opts: GraphReflyCqrsOptions): DynamicModule {
		const providers: Provider[] = [
			{
				provide: getGraphToken(opts.name),
				useFactory: (rootGraph: Graph) => {
					const g = cqrs(opts.name, opts.cqrs);
					if (opts.eventStorage) g.attachEventStorage(opts.eventStorage);
					if (opts.build) opts.build(g);
					rootGraph.mount(opts.name, g);
					return g;
				},
				inject: [GRAPHREFLY_ROOT_GRAPH],
			},
		];

		if (opts.nodes) {
			for (const path of opts.nodes) {
				providers.push({
					provide: getNodeToken(`${opts.name}::${path}`),
					useFactory: (graph: Graph) => graph.resolve(path),
					inject: [getGraphToken(opts.name)],
				});
			}
		}

		return {
			module: GraphReflyModule,
			providers,
			exports: [
				getGraphToken(opts.name),
				...(opts.nodes ?? []).map((p) => getNodeToken(`${opts.name}::${p}`)),
			],
		};
	}
}
