/**
 * Messaging audit-record schemas (DS-13.5.E, locked 2026-05-01 alt A).
 *
 * Per-site discriminated-union audit records for the four messaging mutation
 * sites that route through `mutate`:
 *
 * - {@link TopicPublishRecord} — `Topic.publish`
 * - {@link SubscriptionAckRecord} — `Subscription.ack`
 * - {@link SubscriptionPullAndAckRecord} — `Subscription.pullAndAck`
 * - {@link HubRemoveTopicRecord} — `Hub.removeTopic`
 *
 * **Opt-in usage.** None of the four mutation sites enable an audit log by
 * default — caller wires audit visibility by composing `mutate` with
 * an audit `ReactiveLogBundle<R>` of the matching record type and an
 * `onSuccess`/`onFailure` builder:
 *
 * ```ts
 * import { createAuditLog, mutate } from "@graphrefly/graphrefly/extra";
 * import {
 *   type TopicPublishRecord,
 *   topicPublishKeyOf,
 * } from "@graphrefly/graphrefly/patterns/messaging";
 *
 * const audit = createAuditLog<TopicPublishRecord>({ name: "publishes" });
 * const publish = mutate(
 *   (item: MyMessage) => topic.publish(item),
 *   {
 *     frame: "inline",
 *     log: audit,
 *     onSuccessRecord: ([item], _r, m) => ({
 *       t_ns: m.t_ns,
 *       seq: m.seq,
 *       kind: "topic.publish",
 *       topicName: topic.name,
 *       itemKey: keyOf(item),
 *     }),
 *   },
 * );
 * ```
 *
 * **Stability.** The `kind` discriminator strings are pre-1.0 stable;
 * renaming downstream breaks external auditors.
 *
 * **Composability.** All four records extend {@link BaseAuditRecord} so they
 * carry the cross-cutting `t_ns` / `seq?` / `handlerVersion?` fields stamped
 * by `mutate` (Audit 2 / Audit 5).
 *
 * **Per-record keyOf.** Each record exports a recommended `keyOf` for
 * keyed-storage adapters (Rule G.27-keyOf-recommended) — partition the audit
 * log by the most natural identity (`topicName::itemKey`,
 * `subscriptionId::cursor`, etc.).
 *
 * **Hub.addTopic deferred.** No `HubAddTopicRecord` ships now; the lazy
 * topic-creation site has no caller signal asking for an audit record.
 * Re-add when a consumer surfaces.
 *
 * @category patterns
 * @module patterns/messaging/audit-records
 */

import type { BaseAuditRecord } from "../../extra/mutation/index.js";

// ── Topic.publish ────────────────────────────────────────────────────────

/**
 * Audit record for a single {@link TopicGraph.publish} call.
 *
 * - `topicName` — the topic the publish targeted.
 * - `itemKey` — caller-supplied identity for the published item (typically
 *   the result of the topic's own `keyOf` derivation, when one exists).
 */
export interface TopicPublishRecord extends BaseAuditRecord {
	readonly kind: "topic.publish";
	readonly topicName: string;
	readonly itemKey: string;
}

/**
 * Recommended `keyOf` for {@link TopicPublishRecord} — formats as
 * `${topicName}::${itemKey}` for keyed-storage partitioning. Caller may
 * override per Rule G.27-keyOf-recommended.
 */
export const topicPublishKeyOf = (r: TopicPublishRecord): string => `${r.topicName}::${r.itemKey}`;

// ── Subscription.ack ─────────────────────────────────────────────────────

/**
 * Audit record for a single {@link SubscriptionGraph.ack} call.
 *
 * - `subscriptionId` — the subscription the ack advanced.
 * - `cursor` — the post-ack cursor position.
 */
export interface SubscriptionAckRecord extends BaseAuditRecord {
	readonly kind: "subscription.ack";
	readonly subscriptionId: string;
	readonly cursor: number;
}

/**
 * Recommended `keyOf` for {@link SubscriptionAckRecord} — formats as
 * `${subscriptionId}::${cursor}`.
 */
export const subscriptionAckKeyOf = (r: SubscriptionAckRecord): string =>
	`${r.subscriptionId}::${r.cursor}`;

// ── Subscription.pullAndAck ──────────────────────────────────────────────

/**
 * Audit record for a single {@link SubscriptionGraph.pullAndAck} call.
 *
 * - `subscriptionId` — the subscription the pullAndAck advanced.
 * - `cursor` — the post-pullAndAck cursor position.
 * - `itemCount` — number of items returned to the caller in this call.
 */
export interface SubscriptionPullAndAckRecord extends BaseAuditRecord {
	readonly kind: "subscription.pullAndAck";
	readonly subscriptionId: string;
	readonly cursor: number;
	readonly itemCount: number;
}

/**
 * Recommended `keyOf` for {@link SubscriptionPullAndAckRecord} — formats as
 * `${subscriptionId}::${cursor}` (identical shape to ack records so the
 * combined audit-log partitioning matches a per-cursor-frame view).
 */
export const subscriptionPullAndAckKeyOf = (r: SubscriptionPullAndAckRecord): string =>
	`${r.subscriptionId}::${r.cursor}`;

// ── Hub.removeTopic ──────────────────────────────────────────────────────

/**
 * Audit record for a single {@link MessagingHubGraph.removeTopic} call.
 *
 * - `topicName` — the topic that was unmounted from the hub.
 */
export interface HubRemoveTopicRecord extends BaseAuditRecord {
	readonly kind: "hub.removeTopic";
	readonly topicName: string;
}

/**
 * Recommended `keyOf` for {@link HubRemoveTopicRecord} — the topic name itself
 * is already the natural identity.
 */
export const hubRemoveTopicKeyOf = (r: HubRemoveTopicRecord): string => r.topicName;

// ── Discriminated-union convenience ──────────────────────────────────────

/**
 * Discriminated union over every messaging audit record. Useful for callers
 * that aggregate records from multiple sites into one log; switch on
 * `record.kind` to narrow.
 */
export type MessagingAuditRecord =
	| TopicPublishRecord
	| SubscriptionAckRecord
	| SubscriptionPullAndAckRecord
	| HubRemoveTopicRecord;
