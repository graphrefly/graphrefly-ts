import "reflect-metadata";
import { depLatest } from "@graphrefly/ts";
import {
	createNestGraphBoundaryInterceptor,
	fromNestLifecycle,
	fromNestReq,
	GraphHttpReply,
	GraphLifecycle,
	GraphReq,
	type NestBoundaryEnvelope,
	type NestExecutionContextLike,
	type NestGraphBoundaryInterceptor,
	type NestReplyEnvelope,
} from "@graphrefly/ts/adapters/nestjs";
import { type Graph, graph } from "@graphrefly/ts/graph";
import {
	Body,
	type CallHandler,
	Controller,
	type ExecutionContext,
	Get,
	Headers,
	Injectable,
	Logger,
	Module,
	type NestInterceptor,
	type OnModuleDestroy,
	Param,
	Post,
	UseInterceptors,
} from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { from, type Observable } from "rxjs";

interface HttpHost<T> {
	readonly requestId: string;
	readonly body: T;
	readonly path?: string;
}

interface HttpResult<T = unknown> {
	readonly status: number;
	readonly body: T;
}

interface PolicyState {
	readonly acceptOrders: boolean;
	readonly reason?: string;
}

interface OrderRequest {
	readonly orderId: string;
	readonly item: string;
	readonly quantity: number;
}

interface AuditEntry {
	readonly requestId: string;
	readonly accepted: boolean;
	readonly orderId?: string;
	readonly reason?: string;
}

function requestId(prefix: string, seq: () => number, ...candidates: unknown[]): string {
	for (const candidate of candidates) {
		const value = Array.isArray(candidate) ? candidate[0] : candidate;
		if (typeof value !== "string") continue;
		const trimmed = value.trim();
		if (trimmed.length > 0) return trimmed;
	}
	return `${prefix}-${seq()}`;
}

function result<T>(status: number, body: T): HttpResult<T> {
	return { status, body };
}

const g = graph({ name: "nestjs-graph-boundary" });

const policy = g.state<PolicyState>({ acceptOrders: true }, { name: "policy/current" });

const echoIn = fromNestReq<HttpHost<{ readonly message?: string }>, { readonly message?: string }>(
	g,
	{
		bindingId: "node.echo.in",
		payload: (host) => host.body,
		requestId: (host) => host.requestId,
	},
);

const echoOut = g.node<NestReplyEnvelope<HttpResult>>(
	[echoIn.node],
	(ctx) => {
		const envelope = depLatest(ctx, 0) as NestBoundaryEnvelope<{ readonly message?: string }>;
		if (envelope.requestId === undefined) return;
		ctx.down([
			[
				"DATA",
				{
					requestId: envelope.requestId,
					bindingId: "http.echo.out",
					version: 1,
					payload: result(200, { echo: envelope.payload.message ?? "" }),
				},
			],
		]);
	},
	{ name: "http.echo.out" },
);

const ordersIn = fromNestReq<HttpHost<OrderRequest>, OrderRequest>(g, {
	bindingId: "node.orders.in",
	payload: (host) => host.body,
	requestId: (host) => host.requestId,
});

const ordersAudit = g.node<AuditEntry>(
	[ordersIn.node, policy],
	(ctx) => {
		const envelope = depLatest(ctx, 0) as NestBoundaryEnvelope<OrderRequest>;
		if (envelope.requestId === undefined) return;
		const currentPolicy = depLatest(ctx, 1) as PolicyState;
		const accepted = currentPolicy.acceptOrders && envelope.payload.quantity > 0;
		ctx.down([
			[
				"DATA",
				{
					requestId: envelope.requestId,
					accepted,
					orderId: envelope.payload.orderId,
					reason: accepted ? undefined : (currentPolicy.reason ?? "orders are not admitted"),
				},
			],
		]);
	},
	{ name: "orders.audit" },
);

const ordersOut = g.node<NestReplyEnvelope<HttpResult>>(
	[ordersAudit],
	(ctx) => {
		const audit = depLatest(ctx, 0) as AuditEntry;
		ctx.down([
			[
				"DATA",
				{
					requestId: audit.requestId,
					bindingId: "http.orders.out",
					version: 1,
					payload: audit.accepted
						? result(202, { accepted: true, orderId: audit.orderId })
						: result(403, { accepted: false, reason: audit.reason }),
				},
			],
		]);
	},
	{ name: "http.orders.out" },
);

const lifecycleIn = fromNestLifecycle<unknown, { readonly event: string }>(g, {
	bindingId: "lifecycle.app.in",
	payload: () => ({ event: "teardown" }),
});

function isObservable(value: unknown): value is Observable<unknown> {
	return (
		value !== null &&
		typeof value === "object" &&
		typeof (value as { subscribe?: unknown }).subscribe === "function"
	);
}

@Injectable()
class GraphRouteInterceptor implements NestInterceptor, OnModuleDestroy {
	private seq = 1;
	private readonly boundary: NestGraphBoundaryInterceptor = createNestGraphBoundaryInterceptor({
		host: (context) => {
			const req = context.switchToHttp?.().getRequest<{
				body?: unknown;
				headers?: Record<string, string | string[] | undefined>;
				id?: string;
				path?: string;
				requestId?: string;
			}>() ?? { body: {}, headers: {}, path: undefined };
			const prefix = String(context.getHandler().name || "graph");
			return {
				requestId: requestId(
					prefix,
					() => this.seq++,
					req.requestId,
					req.id,
					req.headers?.["x-request-id"],
					req.headers?.["x-correlation-id"],
				),
				body: req.body ?? {},
				path: req.path,
			};
		},
		requestId: (host) => host.requestId,
	});

	intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
		const value = this.boundary.intercept(context as unknown as NestExecutionContextLike, next);
		return isObservable(value) ? value : from(Promise.resolve(value));
	}

	onModuleDestroy(): void {
		this.boundary.dispose();
	}
}

@Injectable()
class GraphAuditLogger implements OnModuleDestroy {
	private readonly logger = new Logger("GraphAudit");
	private readonly audit = new Map<string, AuditEntry>();
	private readonly stop = g.observe("orders.audit").subscribe((event) => {
		if (event.msg[0] !== "DATA") return;
		const entry = event.msg[1] as AuditEntry;
		this.audit.set(entry.requestId, entry);
		this.logger.log(
			`orders.audit ${entry.requestId} accepted=${entry.accepted}${
				entry.reason ? ` reason=${entry.reason}` : ""
			}`,
		);
	});

	auditEntry(requestId: string): AuditEntry | undefined {
		return this.audit.get(requestId);
	}

	onModuleDestroy(): void {
		this.stop();
	}
}

@Injectable()
class GraphBoundaryDemo {
	setPolicy(nextPolicy: PolicyState): PolicyState {
		policy.set(nextPolicy);
		return nextPolicy;
	}

	teardown(): HttpResult {
		return result(202, { lifecycle: "teardown-envelope-emitted" });
	}

	describe(): ReturnType<Graph["describe"]> {
		return g.describe();
	}
}

@Controller()
class DemoController {
	constructor(
		private readonly demo: GraphBoundaryDemo,
		private readonly auditLogger: GraphAuditLogger,
	) {}

	@Post("echo")
	@UseInterceptors(GraphRouteInterceptor)
	@GraphReq(echoIn, { bindingId: "http.echo.in" })
	@GraphHttpReply(echoOut, { bindingId: "http.echo.out" })
	echo(): void {}

	@Post("policy")
	policy(@Body() body: Partial<PolicyState>): PolicyState {
		return this.demo.setPolicy({
			acceptOrders: body.acceptOrders ?? true,
			reason: body.reason,
		});
	}

	@Post("orders")
	@UseInterceptors(GraphRouteInterceptor)
	@GraphReq(ordersIn, { bindingId: "http.orders.in" })
	@GraphHttpReply(ordersOut, { bindingId: "http.orders.out" })
	orders(): void {}

	@Get("audit/:requestId")
	audit(@Param("requestId") id: string): HttpResult {
		return result(200, this.auditLogger.auditEntry(id) ?? null);
	}

	@Post("lifecycle/teardown")
	@UseInterceptors(GraphRouteInterceptor)
	@GraphLifecycle(lifecycleIn, { bindingId: "lifecycle.app.in" })
	teardown(@Headers("x-request-id") _header?: string): HttpResult {
		return this.demo.teardown();
	}

	@Get("graph")
	graph(): ReturnType<GraphBoundaryDemo["describe"]> {
		return this.demo.describe();
	}
}

@Module({
	controllers: [DemoController],
	providers: [GraphBoundaryDemo, GraphAuditLogger, GraphRouteInterceptor],
})
class AppModule {}

const app = await NestFactory.create(AppModule);
const port = Number(process.env.PORT ?? 3000);
await app.listen(port);
console.log(`NestJS GraphBoundary demo listening on http://localhost:${port}`);
