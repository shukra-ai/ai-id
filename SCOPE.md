# Scope and claim boundaries

Status: experimental, September 2026. The [local implementation report](docs/implementation/lot-01.md) is the detailed feature inventory.

## Working local slice

Domain-local entities; immutable principal-to-entity binding; hosted local OIDC authentication; sessions; passkey enrollment and login; allowlisted inbound OIDC federation; explicit resource permissions; short-lived one-hop delegation; an HTTP API; local TypeScript SDK; developer console; contextual evidence; a private experimental assessment; events and hash-chained audit checkpoints.

“Hosted Auth” is a process name here, not an Internet-hosted public service. “Public API” means an integrator-facing contract, not an unauthenticated or Internet-accessible API. The built-in demo tool has no external business effect. Agent API keys are short-lived bearer credentials, not proof-of-possession credentials.

## Not delivered

Cross-platform identity portability, export/import, holder wallets, VC/DID credentials, selective disclosure, physical-device attestation, complete controller qualification, team invitations, account recovery, external signing isolation, production infrastructure, complete API response schemas, native PostgreSQL concurrency validation, independent audit, conformance certification, operational support or hosted registrations.

## Not the purpose of this release

KYC or KAYC verification; real identity documents; biometrics collection; payments; legally binding representation; automatic agent purchasing; legal dispute resolution; public complaints registers; a universal social score; a blockchain; token issuance; identity sales or permanent identifier reservations.

KAYC and other assurance profiles may be explored separately. A descriptive entity record is not a verified legal identity. A delegation is a technical permission, not a determination of legal authority or meaningful human consent.

## Safety boundary

Localhost only, synthetic records only. Do not deploy or tunnel this preview to the Internet. The production configuration refusal is a guardrail, not a way to make a proxy-exposed development instance safe. Do not use it for consequential access, financial, health, employment or other high-stakes decisions.
