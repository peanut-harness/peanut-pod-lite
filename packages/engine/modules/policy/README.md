# @peanut/pod-engine/policy

Public, dependency-free access-policy primitives shared by the Cocos MCP Hub and capability plugins.

The package intentionally does not contain entitlement verification, signing keys, proprietary workflow definitions, or asset data handling.

`CoreCocosMcpCapabilityCatalog` is fail-closed: only the 38 explicitly listed read-only operations are public. `CoreCocosNativeWriteCapabilityCatalog` is the companion open-source migration ledger for 45 Cocos write/destructive operations. Every one remains free (`local` access) but requires a local approval lease; destructive operations retain explicit confirmation. Together the catalogs expose editor/asset/scene/Prefab/preview-refresh/builder, Lumen, and reference-image. Artifact-producing `preview.capture` is a Pro capability, not a Core tool. SnowB remains a private paid-support integration.

SnowB, Figma/PSD and UI Prefab integrations are not native Core capabilities and remain private paid-support integrations. Other operation families retain their existing ledger assignment until separately classified.

`McpApprovalLeaseStore` is a generic in-memory local confirmation primitive. It binds a short-lived approval to a bridge connection, resource scope, operation allowlist, and maximum risk; it does not implement commercial entitlement.

`CoreCocosMcpExecutionDispatcher` is the host-neutral, fail-closed execution seam. A Creator host supplies adapters for the operations it implements; the dispatcher rejects unknown operations, duplicate registrations, missing adapters, and write requests without `approvalId` before a host call is made.

`Creator38MigrationWorkstreamCatalog` partitions the same 83 trusted definitions into five non-overlapping acceptance workstreams. It is migration metadata only; it does not change ownership, availability, schema, risk, or approval behavior.
