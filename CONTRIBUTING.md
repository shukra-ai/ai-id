# Contributing / Contribuer

You do not need permission to propose an improvement, and you do not need to write code. French and English are welcome. Start with [the community guide](docs/community/start-here.md).

## Useful first contributions

- Describe one real-world need using fictional people and data.
- Point out a confusing explanation or a missing translation.
- Reproduce the local demo and explain where you got stuck.
- Challenge an assumption about privacy, exclusion, recovery or delegation.
- Add a focused test or fix with a clear explanation.

Use the issue templates for public, non-sensitive reports. Search existing issues before opening a duplicate. Do not post identity documents, real credentials, private conversation exports or third-party personal data. Public posts are associated with your GitHub account, even if you use a pseudonym. For vulnerabilities, follow [SECURITY.md](SECURITY.md).

## Code changes

Read the [local guide](docs/guides/local-development.md), [accepted decisions](docs/architecture/decisions-acceptees.md) and [implementation gaps](docs/implementation/lot-01.md). Discuss changes to identity semantics, permissions, cryptography or storage boundaries before a large implementation.

Work in a branch or fork. Keep changes small, add tests and explain observable behavior. Run `npm run typecheck` and `npm test`; report any test you could not run. Use only synthetic fixtures. Never commit `.local/`, environment files, keys, logs, screenshots with private data or account exports.

Do not replace established cryptographic primitives with custom algorithms. Do not “fix” a failing authorization test by widening permissions. Distinguish behavior that is specified, implemented and independently verified.

## Authorship and assistance

Contribute only material you have the right to submit. Contributions intended for inclusion are under the repository's Apache-2.0 license unless explicitly agreed otherwise. Preserve third-party notices. No copyright assignment is requested.

AI-assisted work is welcome. Explain substantial assistance and how you verified the result; the submitting human remains accountable for review, provenance and correctness. Do not invent test outcomes, references or reviewer approval.

## Decisions and response expectations

This is an early, maintainer-led project. A proposal is not a commitment to merge it or a promise of response time. Maintainers should explain consequential decisions and record accepted architectural changes. See [GOVERNANCE.md](GOVERNANCE.md) and the [code of conduct](CODE_OF_CONDUCT.md).
