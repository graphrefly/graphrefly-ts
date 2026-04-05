/**
 * NestJS + GraphReFly — full integration example (Phase 5.5).
 *
 * A minimal bootable NestJS server demonstrating every integration point:
 *
 * 1. Module registration — forRoot() + forCqrs() with build callbacks
 * 2. Actor/guard from header — GraphReflyGuard extracts Actor from x-actor header
 * 3. CQRS order flow — command → event → projection → saga
 * 4. Scheduled jobs — fromTimer/fromCron as graph nodes
 * 5. WebSocket observe — ObserveGateway for real-time node streams
 * 6. SSE stream — observeSSE() endpoint for order events
 * 7. Admin endpoint — graph.describe() as JSON
 *
 * NOTE: The library's CQRS decorators (@CommandHandler, @SagaHandler, etc.)
 * use TC39 Stage 3 decorators. NestJS requires legacy `experimentalDecorators`.
 * These two modes cannot coexist in the same compilation unit. This example
 * uses the direct CqrsGraph API for CQRS wiring, which is always available
 * regardless of decorator mode. In a project that uses TC39 decorators
 * natively (e.g. with SWC or a future NestJS version), the decorator forms
 * work identically.
 *
 * Run:
 *   pnpm exec tsx --tsconfig examples/tsconfig.json examples/nestjs-order-flow.ts
 *
 * Endpoints:
 *   POST /orders/place        — dispatch PlaceOrder command
 *   GET  /orders/summary      — current order projection state
 *   GET  /orders/stream       — SSE stream of order events
 *   GET  /admin/describe      — full graph.describe() snapshot
 *   ws://localhost:3000       — WebSocket observe gateway
 *
 * Try:
 *   curl -X POST http://localhost:3000/orders/place \
 *     -H "Content-Type: application/json" \
 *     -d '{"id":"order-1","item":"Widget","amount":29.99}'
 *
 *   curl http://localhost:3000/orders/summary
 *   curl -N http://localhost:3000/orders/stream
 *   curl http://localhost:3000/admin/describe | jq .
 *
 *   # With actor context (guard-scoped describe):
 *   curl http://localhost:3000/admin/describe \
 *     -H 'x-actor: {"type":"human","id":"admin-1"}'
 */
import "reflect-metadata";

import {
	Body,
	Controller,
	Get,
	Inject,
	Injectable,
	Module,
	type OnModuleDestroy,
	type OnModuleInit,
	Post,
	Req,
	Res,
	UseGuards,
} from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { WsAdapter } from "@nestjs/platform-ws";
import { SubscribeMessage, WebSocketGateway } from "@nestjs/websockets";
import type { CqrsEvent, CqrsGraph } from "../src/patterns/cqrs.js";
import { COMPLETE, DATA, ERROR, type Messages } from "../src/core/messages.js";
import type { Graph, GraphObserveOne } from "../src/graph/graph.js";
import { fromCron, fromTimer } from "../src/extra/sources.js";
import {
	GraphReflyGuard,
	GraphReflyModule,
	ObserveGateway,
	fromHeader,
	getActor,
	observeSSE,
} from "../src/compat/nestjs/index.js";
import {
	GRAPHREFLY_ROOT_GRAPH,
	getGraphToken,
} from "../src/compat/nestjs/tokens.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface OrderPayload {
	id: string;
	item: string;
	amount: number;
}

interface OrderSummary {
	totalOrders: number;
	totalRevenue: number;
	lastOrderId: string | null;
}

const INITIAL_SUMMARY: OrderSummary = {
	totalOrders: 0,
	totalRevenue: 0,
	lastOrderId: null,
};

// ---------------------------------------------------------------------------
// 2. Actor/guard from header (self-contained, testable with curl)
// ---------------------------------------------------------------------------

// Reads Actor from the `x-actor` request header (JSON-parsed).
// Usage: curl -H 'x-actor: {"type":"human","id":"admin-1"}' ...
// Falls back to DEFAULT_ACTOR when header is absent.
// In production, swap to `fromJwtPayload()` for Passport.js JWT extraction.
const actorGuard = GraphReflyGuard(fromHeader());

// ---------------------------------------------------------------------------
// 3. CQRS order flow — wired via direct CqrsGraph API
// ---------------------------------------------------------------------------

@Controller("orders")
class OrderController implements OnModuleInit, OnModuleDestroy {
	private readonly disposers: Array<() => void> = [];

	constructor(
		@Inject(GRAPHREFLY_ROOT_GRAPH) private graph: Graph,
		@Inject(getGraphToken("orders")) private orders: CqrsGraph,
	) {}

	onModuleInit() {
		// --- Command handler: PlaceOrder → emits "orderPlaced" event ---
		this.orders.command<OrderPayload>("placeOrder", (payload, { emit }) => {
			console.log(`  [cmd] PlaceOrder: ${payload.id} — ${payload.item} ($${payload.amount})`);
			emit("orderPlaced", {
				orderId: payload.id,
				item: payload.item,
				amount: payload.amount,
			});
		});

		// --- Event handler: react to orderPlaced events ---
		const evtHandle = this.orders.observe("orderPlaced") as unknown as GraphObserveOne;
		let lastEvtSeq = 0;
		const evtUnsub = evtHandle.subscribe((msgs: Messages) => {
			for (const m of msgs) {
				const t = m[0];
				if (t === COMPLETE || t === ERROR) return;
				if (t !== DATA) continue;
				const snap = m[1] as { value: { entries: readonly CqrsEvent[] } };
				for (const entry of snap.value.entries) {
					if (entry.seq > lastEvtSeq) {
						const p = entry.payload as { orderId: string };
						console.log(`  [evt] OrderPlaced: ${p.orderId} (seq=${entry.seq})`);
						lastEvtSeq = entry.seq;
					}
				}
			}
		});
		this.disposers.push(evtUnsub);

		// --- Projection: fold events into summary ---
		this.orders.projection<OrderSummary>(
			"orderSummary",
			["orderPlaced"],
			(initial, events) => {
				let summary = { ...initial };
				for (const evt of events) {
					const p = evt.payload as { orderId: string; amount: number };
					summary = {
						totalOrders: summary.totalOrders + 1,
						totalRevenue: summary.totalRevenue + p.amount,
						lastOrderId: p.orderId,
					};
				}
				return summary;
			},
			INITIAL_SUMMARY,
		);

		// --- Query handler: react to projection changes ---
		const projHandle = this.orders.observe("orderSummary") as unknown as GraphObserveOne;
		const projUnsub = projHandle.subscribe((msgs: Messages) => {
			for (const m of msgs) {
				const t = m[0];
				if (t === COMPLETE || t === ERROR) return;
				if (t !== DATA) continue;
				const s = m[1] as OrderSummary;
				console.log(
					`  [qry] Summary: ${s.totalOrders} orders, $${s.totalRevenue.toFixed(2)} revenue`,
				);
			}
		});
		this.disposers.push(projUnsub);

		// --- Saga: orchestrate side effects ---
		this.orders.saga("fulfillment", ["orderPlaced"], (event: CqrsEvent) => {
			const p = event.payload as { orderId: string };
			console.log(`  [saga] Fulfillment for ${p.orderId} — shipping initiated`);
		});
	}

	onModuleDestroy() {
		for (const dispose of this.disposers) dispose();
	}

	// POST /orders/place
	@Post("place")
	placeOrder(@Body() body: OrderPayload) {
		this.orders.dispatch("placeOrder", body);
		return { status: "ok", orderId: body.id };
	}

	// GET /orders/summary
	@Get("summary")
	getSummary() {
		return this.orders.resolve("orderSummary").get();
	}

	// GET /orders/stream — SSE stream of order events
	@Get("stream")
	streamOrders(
		@Req() req: unknown,
		@Res() res: {
			setHeader: (k: string, v: string) => void;
			writeHead: (s: number) => void;
			write: (d: string) => boolean;
			end: () => void;
			on: (e: string, cb: () => void) => void;
		},
	) {
		res.setHeader("Content-Type", "text/event-stream");
		res.setHeader("Cache-Control", "no-cache");
		res.setHeader("Connection", "keep-alive");
		res.writeHead(200);

		const stream = observeSSE(this.graph, "orders::orderPlaced", {
			actor: getActor(req),
			keepAliveMs: 15_000,
		});
		const reader = stream.getReader();
		const decoder = new TextDecoder();
		let closed = false;

		// Transport bridge — reads from the ReadableStream and writes to HTTP response.
		const pump = () => {
			reader
				.read()
				.then(({ done, value }) => {
					if (closed) return;
					if (done) {
						res.end();
						return;
					}
					res.write(decoder.decode(value));
					pump();
				})
				.catch(() => {
					if (!closed) res.end();
				});
		};
		pump();

		res.on("close", () => {
			closed = true;
			reader.cancel().catch(() => {});
		});
	}
}

// ---------------------------------------------------------------------------
// 4. Scheduled jobs — fromTimer / fromCron as graph nodes
// ---------------------------------------------------------------------------

@Injectable()
class ScheduleService implements OnModuleInit, OnModuleDestroy {
	private metricsCount = 0;
	private readonly disposers: Array<() => void> = [];

	constructor(@Inject(GRAPHREFLY_ROOT_GRAPH) private readonly graph: Graph) {}

	onModuleInit() {
		// Metrics heartbeat every 10s — visible in graph.describe()
		const timerNode = fromTimer(10_000, { period: 10_000, name: "__schedule__.metrics" });
		this.graph.add("__schedule__.metrics", timerNode);

		const timerHandle = this.graph.observe("__schedule__.metrics") as unknown as GraphObserveOne;
		const timerUnsub = timerHandle.subscribe((msgs: Messages) => {
			for (const m of msgs) {
				if (m[0] === DATA) {
					this.metricsCount++;
					console.log(`  [schedule] Metrics heartbeat #${this.metricsCount}`);
				}
			}
		});
		this.disposers.push(timerUnsub);

		// Daily cleanup cron (midnight) — registered but won't fire in short demo runs
		const cronNode = fromCron("0 0 * * *", { name: "__schedule__.dailyCleanup" });
		this.graph.add("__schedule__.dailyCleanup", cronNode);

		const cronHandle = this.graph.observe(
			"__schedule__.dailyCleanup",
		) as unknown as GraphObserveOne;
		const cronUnsub = cronHandle.subscribe((msgs: Messages) => {
			for (const m of msgs) {
				if (m[0] === DATA) console.log("  [schedule] Daily cleanup executed");
			}
		});
		this.disposers.push(cronUnsub);
	}

	onModuleDestroy() {
		for (const dispose of this.disposers) dispose();
		try {
			this.graph.remove("__schedule__.metrics");
		} catch { /* already gone */ }
		try {
			this.graph.remove("__schedule__.dailyCleanup");
		} catch { /* already gone */ }
	}
}

// ---------------------------------------------------------------------------
// 5. WebSocket observe gateway
// ---------------------------------------------------------------------------

@WebSocketGateway()
class GraphWsGateway implements OnModuleDestroy {
	private gw: ObserveGateway;

	constructor(@Inject(GRAPHREFLY_ROOT_GRAPH) graph: Graph) {
		this.gw = new ObserveGateway(graph);
	}

	handleConnection(client: unknown) {
		this.gw.handleConnection(client);
		console.log("  [ws] Client connected");
	}

	handleDisconnect(client: unknown) {
		this.gw.handleDisconnect(client);
		console.log("  [ws] Client disconnected");
	}

	@SubscribeMessage("observe")
	onObserve(client: unknown, data: unknown) {
		this.gw.handleMessage(client, data);
	}

	onModuleDestroy() {
		this.gw.destroy();
	}
}

// ---------------------------------------------------------------------------
// 7. Admin endpoint — graph.describe()
// ---------------------------------------------------------------------------

@Controller("admin")
@UseGuards(actorGuard)
class AdminController {
	constructor(@Inject(GRAPHREFLY_ROOT_GRAPH) private graph: Graph) {}

	@Get("describe")
	describe(@Req() req: unknown) {
		const actor = getActor(req);
		return this.graph.describe({ actor });
	}
}

// ---------------------------------------------------------------------------
// App module
// ---------------------------------------------------------------------------

@Module({
	imports: [
		// Root graph singleton (global)
		GraphReflyModule.forRoot({ name: "app" }),

		// CQRS orders subgraph — auto-mounts as app::orders.
		// We declare the event stream here; commands/projections/sagas are
		// wired imperatively in OrderController.onModuleInit() to avoid
		// TC39 vs legacy decorator conflicts.
		GraphReflyModule.forCqrs({
			name: "orders",
			build: (g) => {
				g.event("orderPlaced");
			},
		}),
	],
	controllers: [OrderController, AdminController],
	providers: [GraphWsGateway, ScheduleService],
})
class AppModule {}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

async function bootstrap() {
	const app = await NestFactory.create(AppModule, { logger: ["error", "warn", "log"] });
	app.useWebSocketAdapter(new WsAdapter(app));

	await app.listen(3000);

	console.log(`
  GraphReFly + NestJS — Order Flow Example
  http://localhost:3000

  Endpoints:
    POST /orders/place     — dispatch PlaceOrder command
    GET  /orders/summary   — current order projection
    GET  /orders/stream    — SSE stream of order events
    GET  /admin/describe   — graph topology snapshot
    ws://localhost:3000    — WebSocket observe gateway

  Try:
    curl -X POST http://localhost:3000/orders/place \\
      -H "Content-Type: application/json" \\
      -d '{"id":"order-1","item":"Widget","amount":29.99}'

    curl http://localhost:3000/orders/summary
    curl -N http://localhost:3000/orders/stream
    curl http://localhost:3000/admin/describe | jq .

    # With actor context:
    curl http://localhost:3000/admin/describe \\
      -H 'x-actor: {"type":"human","id":"admin-1"}'
`);
}

bootstrap();
