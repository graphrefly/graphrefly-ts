import "reflect-metadata";
import { depLatest } from "@graphrefly/ts";
import {
	fromNestGuard,
	fromNestLifecycle,
	fromNestReq,
	type NestBoundaryEnvelope,
	type NestHttpBoundary,
	toNestHttp,
} from "@graphrefly/ts/adapters/nestjs";
import { type Graph, graph } from "@graphrefly/ts/graph";
import {
	Body,
	type CanActivate,
	Controller,
	type ExecutionContext,
	Get,
	Headers,
	Injectable,
	Module,
	type OnModuleDestroy,
	Param,
	Post,
	UseGuards,
} from "@nestjs/common";
import { NestFactory } from "@nestjs/core";

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

function requestId(header: string | undefined, prefix: string, seq: () => number): string {
	const trimmed = header?.trim();
	return trimmed && trimmed.length > 0 ? trimmed : `${prefix}-${seq()}`;
}

function result<T>(status: number, body: T): HttpResult<T> {
	return { status, body };
}

@Injectable()
class GraphBoundaryDemo implements OnModuleDestroy {
	private readonly g: Graph = graph({ name: "nestjs-graph-boundary" });
	private nextSeq = 1;
	private readonly audit = new Map<string, AuditEntry>();
	private stopAudit: () => void = () => undefined;

	private readonly policy = this.g.state<PolicyState>(
		{ acceptOrders: true },
		{ name: "policy/current" },
	);

	private readonly echoIn = fromNestReq<
		HttpHost<{ readonly message?: string }>,
		{ readonly message?: string }
	>(this.g, {
		bindingId: "http.echo.in",
		payload: (host) => host.body,
		requestId: (host) => host.requestId,
	});
	private readonly echoOut = this.g.node<NestBoundaryEnvelope<HttpResult>>(
		[this.echoIn.node],
		(ctx) => {
			const envelope = depLatest(ctx, 0) as NestBoundaryEnvelope<{ readonly message?: string }>;
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
	private readonly echoHttp = toNestHttp(this.echoOut, { bindingId: "http.echo.out" });

	private readonly orderGuard = fromNestGuard<HttpHost<OrderRequest>, { readonly path?: string }>(
		this.g,
		{
			bindingId: "guard.orders.in",
			payload: (host) => ({ path: host.path }),
			requestId: (host) => host.requestId,
		},
	);
	private readonly ordersIn = fromNestReq<HttpHost<OrderRequest>, OrderRequest>(this.g, {
		bindingId: "http.orders.in",
		payload: (host) => host.body,
		requestId: (host) => host.requestId,
	});
	private readonly ordersAudit = this.g.node<AuditEntry>(
		[this.ordersIn.node, this.policy],
		(ctx) => {
			const envelope = depLatest(ctx, 0) as NestBoundaryEnvelope<OrderRequest>;
			const policy = depLatest(ctx, 1) as PolicyState;
			const accepted = policy.acceptOrders && envelope.payload.quantity > 0;
			const audit: AuditEntry = {
				requestId: envelope.requestId,
				accepted,
				orderId: envelope.payload.orderId,
				reason: accepted ? undefined : (policy.reason ?? "orders are not admitted"),
			};
			ctx.down([["DATA", audit]]);
		},
		{ name: "orders.audit" },
	);
	private readonly ordersOut = this.g.node<NestBoundaryEnvelope<HttpResult>>(
		[this.ordersAudit],
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
	private readonly ordersHttp = toNestHttp(this.ordersOut, { bindingId: "http.orders.out" });

	private readonly lifecycleIn = fromNestLifecycle<
		HttpHost<{ readonly event: "teardown" }>,
		{ readonly event: "teardown" }
	>(this.g, {
		bindingId: "lifecycle.app.in",
		payload: (host) => host.body,
		requestId: (host) => host.requestId,
	});

	constructor() {
		this.stopAudit = this.ordersAudit.subscribe((msg) => {
			if (msg[0] === "DATA") {
				const entry = msg[1] as AuditEntry;
				this.audit.set(entry.requestId, entry);
			}
		});
	}

	makeRequestId(header: string | undefined, prefix: string): string {
		return requestId(header, prefix, () => this.nextSeq++);
	}

	emitGuard(host: HttpHost<OrderRequest>): void {
		this.orderGuard.emit(host);
	}

	echo(host: HttpHost<{ readonly message?: string }>): Promise<HttpResult> {
		return this.roundTrip(this.echoHttp, this.echoIn, host);
	}

	order(host: HttpHost<OrderRequest>): Promise<HttpResult> {
		return this.roundTrip(this.ordersHttp, this.ordersIn, host);
	}

	setPolicy(policy: PolicyState): PolicyState {
		this.policy.set(policy);
		return policy;
	}

	auditEntry(requestId: string): AuditEntry | undefined {
		return this.audit.get(requestId);
	}

	teardown(host: HttpHost<{ readonly event: "teardown" }>): HttpResult {
		this.lifecycleIn.emit(host);
		return result(202, { lifecycle: "teardown-envelope-emitted", requestId: host.requestId });
	}

	onModuleDestroy(): void {
		this.stopAudit();
		this.echoHttp.dispose();
		this.ordersHttp.dispose();
	}

	private roundTrip<THost, TPayload>(
		http: NestHttpBoundary<HttpResult>,
		ingress: { emit(host: THost): NestBoundaryEnvelope<TPayload> },
		host: THost & { readonly requestId: string },
	): Promise<HttpResult> {
		return new Promise<HttpResult>((resolve, reject) => {
			let cleanup: (() => boolean) | undefined;
			try {
				cleanup = http.attach({
					requestId: host.requestId,
					handle: { resolve, reject },
				});
				ingress.emit(host);
			} catch (error) {
				cleanup?.();
				reject(error);
			}
		});
	}

	describe(): ReturnType<Graph["describe"]> {
		return this.g.describe();
	}
}

@Injectable()
class OrdersBoundaryGuard implements CanActivate {
	constructor(private readonly demo: GraphBoundaryDemo) {}

	canActivate(context: ExecutionContext): boolean {
		const req = context
			.switchToHttp()
			.getRequest<{ headers?: Record<string, string>; path?: string }>();
		this.demo.emitGuard({
			requestId: this.demo.makeRequestId(req.headers?.["x-request-id"], "guard"),
			body: { orderId: "guard-preview", item: "unknown", quantity: 1 },
			path: req.path,
		});
		return true;
	}
}

@Controller()
class DemoController {
	constructor(private readonly demo: GraphBoundaryDemo) {}

	@Post("echo")
	echo(
		@Body() body: { readonly message?: string },
		@Headers("x-request-id") header?: string,
	): Promise<HttpResult> {
		return this.demo.echo({
			requestId: this.demo.makeRequestId(header, "echo"),
			body,
			path: "/echo",
		});
	}

	@Post("policy")
	policy(@Body() body: Partial<PolicyState>): PolicyState {
		return this.demo.setPolicy({
			acceptOrders: body.acceptOrders ?? true,
			reason: body.reason,
		});
	}

	@Post("orders")
	@UseGuards(OrdersBoundaryGuard)
	orders(
		@Body() body: OrderRequest,
		@Headers("x-request-id") header?: string,
	): Promise<HttpResult> {
		return this.demo.order({
			requestId: this.demo.makeRequestId(header, "order"),
			body,
			path: "/orders",
		});
	}

	@Get("audit/:requestId")
	audit(@Param("requestId") id: string): HttpResult {
		return result(200, this.demo.auditEntry(id) ?? null);
	}

	@Post("lifecycle/teardown")
	teardown(@Headers("x-request-id") header?: string): HttpResult {
		return this.demo.teardown({
			requestId: this.demo.makeRequestId(header, "teardown"),
			body: { event: "teardown" },
			path: "/lifecycle/teardown",
		});
	}

	@Get("graph")
	graph(): ReturnType<GraphBoundaryDemo["describe"]> {
		return this.demo.describe();
	}
}

@Module({
	controllers: [DemoController],
	providers: [GraphBoundaryDemo, OrdersBoundaryGuard],
})
class AppModule {}

const app = await NestFactory.create(AppModule);
const port = Number(process.env.PORT ?? 3000);
await app.listen(port);
console.log(`NestJS GraphBoundary demo listening on http://localhost:${port}`);
