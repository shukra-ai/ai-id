# Roadmap: progress measured by evidence

No production launch date is promised. Milestones below describe acceptance gates, not completed features. The [engineering plan](docs/architecture/phase-2-contrats-et-plan.md) contains the detailed contracts and M0–M5 sequence.

## 0 · Open developer preview — current slice

- Runnable local identity → delegation → execution → revocation example.
- Source, tests, limitations and architecture decisions available for review.
- Plain-language scenario proposals and documentation contributions welcome.
- Local test evidence recorded; hosted CI must be evaluated from its actual runs.

## 1 · Reproducible foundations

Exit evidence: a clean-checkout installation and CI run; complete request/response contracts; compatibility tests for the SDK; versioned migrations; reproducible security and privacy counterexamples; documented dependency review.

## 2 · Stronger trust boundaries

Exit evidence: isolated typed signing and non-extractable key strategy; distinct workload identities; native PostgreSQL concurrency, rollback and revocation tests; bounded delegation/token exchange profile with proof of possession; negative tests for compromised components; externally pinned witness trust and retention design.

## 3 · Supervised pilot readiness

Exit evidence: account recovery and authenticator revocation; team/controller lifecycle; backup/restore rehearsal; monitoring and incident ownership; deletion/export policy; abuse handling; independent security review; deployment isolation; a clear privacy notice and bounded pilot terms.

Only then consider an invitation-only hosted experiment with explicit limitations, withdrawal and support arrangements. A checkbox saying “beta” does not replace these gates.

## 4 · Interoperability experiments

Exit evidence: at least one independent integration, explicit identifier/correlation boundaries, tested export and migration, credential/status profiles where useful, published compatibility results. Protocol ideas remain experimental until validated against other implementations.

## 5 · Broader participation

Explore additional entity types and community governance based on demonstrated needs. Recognition of contributors may be opt-in attribution and opportunities to co-design; it must not alter identity assurance, authorization or reputation. No financial or access entitlement is promised for early participation.
