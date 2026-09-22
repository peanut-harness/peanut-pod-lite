# CPM signing protocol v1

CPM uses separate signature purposes for the public CLI release and Lite
product catalog. Both payloads are UTF-8 encoded compact JSON with the exact
field order below. Signers and verifiers MUST reject missing fields rather than
serializing arbitrary JSON.

| Purpose | `kind` | Signed fields, in order |
| --- | --- | --- |
| CPM CLI release | `cpm-release-v1` | `schemaVersion`, `kind`, `id`, `version`, `channel`, `url`, `sha256` |
| Lite product release | `lite-product-v1` | `schemaVersion`, `kind`, `id`, `version`, `channel`, `sourceCommit`, `hostUrl`, `hostSha256`, `hostPackageDigest`, `coreUrl`, `coreSha256`, `corePackageDigest`, `creatorProfiles` |

`schemaVersion` is the number `1`. `creatorProfiles` preserves the declared
array order. URLs MUST be immutable HTTPS locations; versions MUST NOT be
republished with different bytes or identities.

CLI and product releases use independent purpose keys. A trust-anchor set may
contain one active key or, during an announced rotation, the current and next
keys. A release is accepted when exactly one declared anchor verifies it.
Removing the old anchor is a separate release after all supported clients have
received the dual-anchor transition. Runtime environment variables MUST NOT
replace the public trust-anchor set.

`tests/fixtures/signing-vectors.json` contains only a public test key, signed
payloads, and signatures. It is copied unchanged into the CPM installer
verifier suite; no private key is stored in either repository.
