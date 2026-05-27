---
title: "shardByTenant()"
description: "Build the `{ shardBy, shardCount }` pair for tenant-isolated sharding.\n`tenantOf` extracts the tenant key from a fragment. Spread into\nreactiveFactStore's confi"
---

Build the `{ shardBy, shardCount }` pair for tenant-isolated sharding.
`tenantOf` extracts the tenant key from a fragment. Spread into
reactiveFactStore's config.

## Signature

```ts
function shardByTenant<T>(
	tenantOf: (f: MemoryFragment<T>) => string,
	opts: ShardByTenantOptions = {},
): ShardByTenantConfig<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| <code>tenantOf</code> | <code>(f: MemoryFragment&lt;T&gt;) =&gt; string</code> |  |
| <code>opts</code> | <code>ShardByTenantOptions</code> |  |
