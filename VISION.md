# Identity beyond the login

Status: direction, not a list of shipped features. [Français : commencer ici](docs/community/start-here.md).

We already share digital spaces with people, organizations, software agents and connected machines. Yet we often confuse a recognizable name with an identity, an identity with permission, and past success with a guarantee of future behavior.

AI ID asks what an identity system could look like if humans were not its only participants—and if giving an entity an identity did not mean giving it unlimited power.

## The future we want to explore

A person can bring an assistant to a new service without sharing their entire history. An organization can explain which agent is acting for it without exposing every employee. A device can rotate a compromised key without erasing all continuity. A service can evaluate relevant, attributable evidence without accepting a global reputation score.

These are design goals. The local preview does not yet deliver cross-platform portability, selective-disclosure credentials, device attestation or production recovery.

Identity, relationships, permissions, evidence and reputation should fit together, but remain distinct:

- An entity is the subject we want to recognize.
- A principal is the actor that authenticates, with an explicit binding to an entity.
- A relationship says how entities relate; it is not automatically an authorization.
- A delegation grants a bounded ability to act and has a lifecycle.
- Evidence says what a source observed or asserted in a particular context.
- Reputation is a contextual interpretation of evidence, not a person's worth.

## Universal does not mean uniform

We do not propose one mandatory global identifier, an irreversible public biography or a central authority deciding who deserves to participate online. Different domains need different identifiers, policies and disclosure boundaries. Continuity must coexist with pseudonymity, correction, revocation and limits on correlation.

Nor does calling software an “intelligence” assert consciousness, moral status, legal personhood or legal autonomy. Those are separate questions. This project should remain usable by people who disagree about them.

## Open code, private lives

The intended foundations—contracts, verification logic, reference implementation, SDK and tests—belong in the open. Personal records, private keys, confidential relationships and security investigations do not.

A useful long-term data distinction is between holder-controlled private material, confidential operational records, minimal verification information and audit evidence. These are design boundaries, **not four fully implemented products**. A public hash is not automatically anonymous; correlation and guessing attacks still matter.

There is currently no proprietary runtime module required to run this preview. A future managed service may charge for operation and support. Any proposed closed component must explain why it is necessary, what open alternative exists and whether independent verification and exit remain possible. Keeping user data private does not require keeping the protocol secret.

## Begin with something people can challenge

Our first slice follows one human-to-agent delegation through creation, execution and revocation. The tool only transforms text. Its usefulness is not the transformation: it is making the identity and permission boundaries inspectable.

Next comes stronger assurance, not bigger claims. See the [roadmap](ROADMAP.md). The project aspires to contribute to interoperable standards; it does not declare itself a standard or replace the communities already working on identity.

The most valuable early contribution may be a counterexample: a person excluded by our assumptions, a relationship we cannot describe, or a privacy boundary that does not hold. Bring those cases into the design.
