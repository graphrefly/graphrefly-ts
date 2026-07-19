---
"@graphrefly/ts": minor
---

Revise the managed untrusted JavaScript compatibility contract to v2 with a validated cleanup timeout and an exact-context allocation fence, then serialize cancellation, timeout, allocation, kill, destroy, fencing, and concurrent disposal so each attempt has one bounded cleanup owner, retries topology release, and publishes terminal and cleanup lifecycle truth in canonical order.
