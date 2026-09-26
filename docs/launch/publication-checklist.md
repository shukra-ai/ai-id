# Publication checklist

Use this checklist for a specific revision. An unchecked item is not a claim of completion. Keep execution receipts separate from this reusable checklist.

## Content and privacy

- [ ] Read the intended file manifest; never upload the entire workspace by default.
- [ ] Review secret-pattern scan results and human-readable content. A scan is not a guarantee.
- [ ] Exclude `.local`, keys, databases, `.env*`, installed dependencies, account exports, private chats and unrelated folders.
- [ ] Check Git history if publishing an existing repository; otherwise use a deliberately new history.
- [ ] Verify license, third-party attribution and dependency license inventory.
- [ ] Confirm every capability claim against implementation and tests; no invented partners or certifications.
- [ ] Check English/French parity, relative links and issue forms.

## Reproducibility

- [ ] Install from the curated files in a clean staging directory with `npm ci`.
- [ ] Run typecheck and tests there, not just in an existing development install.
- [ ] Review dependency audit results and document unresolved findings.
- [ ] Run CI in GitHub; report its actual state without equating green CI with certification.

## Repository settings

- [ ] Verify owner `shukra-ai`, repository name and public visibility.
- [ ] Configure a private vulnerability reporting route and verify availability.
- [ ] Use least-privilege CI without project secrets or privileged execution of pull-request code.
- [ ] Review branch rules and maintainer account protections with the owner; do not silently change authentication or recovery settings.
- [ ] Verify the rendered README, LICENSE and contribution links on GitHub.

## Not part of repository publication

Do not expose the local authentication service. Public signup, hosted deployment, mailing-list collection, ambassador account creation and external campaign posts require their own defined scope and checks. See [strategy](strategy.md) and [roadmap](../../ROADMAP.md).
