# AI ID · All Intelligences ID

## Identity for every kind of intelligence. Permission for every action.

[Français](README.fr.md) · [The vision](VISION.md) · [Try locally](docs/guides/local-development.md) · [Help shape it](CONTRIBUTING.md)

An AI assistant should not have to start from zero every time it changes platforms. And you should not have to hand it the keys to your entire digital life to let it help you.

AI ID explores a simple idea: **people, agents, organizations and connected things need identities that can last, relationships that can be explained, and permissions that can be withdrawn.**

We are building this in the open. Not a new password manager. Not a universal score for human beings. An experimental foundation for identity and contextual trust, built on existing standards.

> **Experimental developer preview — local use only.** Use invented identities and test data. This repository is not a hosted beta, a production identity provider, a security certification, or a promise that an agent is trustworthy. Do not expose the local services through hosting or tunnels.

## A story before a specification

Imagine an assistant that helps you plan a trip. You want it to be recognizable tomorrow, even if you move to a different app. You might let it compare flights, but not buy a ticket. Later, you could give it a narrowly scoped permission, with an expiry date, and take that permission back.

Three questions should have clear answers:

- **Who is interacting with me?** An identity is not the same thing as a model, a login, or an API key.
- **For whom, and within what limits?** An agent's identity does not automatically authorize its actions.
- **What actually happened?** Evidence needs a source, a context and an expiration—not a universal trust score.

This travel story describes the direction, **not an implemented travel or payment integration**. Today's working example deliberately performs only a harmless text transformation.

## What you can try today

Create a local test domain, sign in, register an agent, grant a short-lived delegation, execute the demo tool, revoke the delegation and observe the next call being refused. Inspect the resulting evidence and audit events.

| In this preview | Still ahead |
| --- | --- |
| Domain-local entities and principals | Cross-platform identity portability and export |
| OIDC sign-in, sessions and passkey enrollment | Account recovery and production authenticator lifecycle |
| Allowlisted inbound OIDC federation | Production federation operations and conformance testing |
| Explicit permissions and expiring, revocable delegation | Proof-of-possession credentials and token exchange |
| HTTP API, local TypeScript SDK and developer console | Published SDK packages and complete response contracts |
| Contextual evidence and an experimental private assessment | Independent reputation issuers and appeals |
| Event history, hash-chained audit and a separate local witness | Isolated signing keys, independent witnesses and durable external anchoring |

The local witness shares the machine's trust boundary. It does not make the installation tamper-proof. A successful login proves neither legal identity nor honesty. Reputation never grants permission.

### Run it

Install **Node.js 24 and npm**, clone or download this repository, then run at its root:

```sh
npm ci
npm run dev
```

Open **http://localhost:4100**. Allow the three local services to start. Use `localhost`, not an IP address. The console and detailed developer documentation are currently in French.

Follow the [step-by-step local guide](docs/guides/local-development.md) to complete the delegation and revocation story. No paid API key or external AI model is required.

```sh
npm run typecheck
npm test
```

Browser tests require Chrome; see the guide for alternatives. The [recorded local verification](docs/implementation/verification-2026-09-26.md) reports 30 passing tests. That is local test evidence, not an independent audit or a claim about the current CI run.

## A big vision, an intentionally small first step

AI ID means **All Intelligences ID**. Agents are the first demonstrator, not the boundary of the idea. Humans, organizations, services, robots and connected devices belong in the long-term design.

“Universal” means shared building blocks, not one compulsory identity for everyone. Persistence should not mean permanent tracking. Portability must not become forced correlation. Open source must not become public personal data.

Our starting principles:

1. **Identity before access.** Keep identity, authentication, authorization and reputation distinct.
2. **Minimum necessary disclosure.** No public dossier of someone's activity or complaints.
3. **Explicit limits.** The service receiving an action decides whether to accept it.
4. **Open foundations.** Publish code, contracts, tests, decisions and known limitations.
5. **Earn confidence through evidence.** No invented certifications, users, partners or community consensus.

Read [VISION.md](VISION.md), the [scope](SCOPE.md) and the [milestone-based roadmap](ROADMAP.md). Architectural decisions are documented [here](docs/architecture/decisions-acceptees.md); the implementation's gaps are [here](docs/implementation/lot-01.md).

## You do not need to be a developer to contribute

Tell us about a situation where you would want an agent to identify itself, show a permission, or explain its past actions. Challenge a privacy assumption. Improve a confusing sentence. Translate a guide. Test the local prototype with invented data.

[Start here](docs/community/start-here.md) or [open a scenario proposal](../../issues/new?template=scenario.yml). GitHub contributions are public and associated with your GitHub account; they are not anonymous. Never share private identity documents, credentials or real incident data.

There is **no hosted signup service or identity reservation** in this release. Following the repository is not registration for a beta. Future supervised pilots will have an explicit scope and participation terms before collecting personal data. Early participation does not promise tokens, ownership, financial rewards, reserved identifiers or preferential trust scores.

If the idea is useful to you, a star helps people find it. A thoughtful question, reproducible test or contribution helps us make it real. Neither is a condition for future access.

## Open source, with clear responsibilities

Original code and documentation in this repository are licensed under [Apache-2.0](LICENSE), unless a file says otherwise. Dependencies retain their own licenses. Commercial use and independent implementations are welcome subject to the license; using the project does not imply endorsement.

The initial maintainer account is [shukra-ai](https://github.com/shukra-ai). This is a maintainer-led experiment, not an established standards body. See [governance](GOVERNANCE.md), [contributing](CONTRIBUTING.md), [conduct](CODE_OF_CONDUCT.md) and [security reporting](SECURITY.md).

**Help build an internet where an intelligence can be recognized without being trusted blindly.**
