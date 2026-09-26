# Security policy

## Experimental, not production-ready

There is no production-supported release. Use invented identities and test data on localhost only. Do not expose these development services through hosting, reverse proxies or tunnels. Read the [known gaps](docs/implementation/lot-01.md) and [scope](SCOPE.md).

The development keys and databases share one machine/account. Process separation is not isolated signing or independent witnessing. The local test suite does not establish production security, regulatory compliance or native PostgreSQL concurrency safety.

## Reporting a vulnerability

Do not disclose a suspected vulnerability, exploit, key or private record in a public issue or pull request.

Use this repository's **Security → Report a vulnerability** option if available. That is a private GitHub reporting channel, not the public issue tracker. Include an affected revision, impact, reproduction with synthetic data and any mitigation. Do not attack other systems or collect real identities to demonstrate a problem.

If the private reporting option is absent, ask `shukra-ai` for a private contact route in a public issue titled “Private security contact requested”, **without including technical details or personal information**. There is no separate security email or response-time commitment announced in this preview. No bounty is offered.

## Coordinated handling

Maintainers should acknowledge privately, reproduce within an isolated environment, agree on disclosure and publish a sanitized advisory when appropriate. Do not promise a fix or a date before evaluation. Dependency alerts, automated scans and passing CI are useful signals, not security certification.
