# Security policy

## Reporting a vulnerability

Please report security problems privately, not in a public issue.

Use GitHub's private reporting: **Security tab > Report a vulnerability** on
[Sherlemious/trolleybench](https://github.com/Sherlemious/trolleybench/security/advisories/new).

Include what you found, how to reproduce it, and what it lets someone do. You can expect an
acknowledgement within a week. This is a small volunteer project, so fixes are best effort, but
reports that expose credentials or user data are handled first.

## In scope

- The hosted site and API at `trolley-bench.sherlemious.com` (`/api/v1/*`, `/api/mcp`, `/api/results`).
- The code in this repository, including anything that could leak a database connection string or an API key.
- Ways to bypass the hosted run limits or tamper with other submitters' results.

## Out of scope

- Findings that need an already-compromised device or browser.
- Denial of service by sheer volume.
- Reports about third-party services (Vercel, Neon, Google Analytics) that are not specific to this project.
- Disagreements with scenario content or scoring. Open a normal issue for those.

## Secrets

Never put an API key, token or connection string in an issue, pull request or commit. If you find
one in this repository's history, report it privately as above so it can be rotated.
