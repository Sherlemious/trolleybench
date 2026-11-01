# Contributing to trolleybench

Thanks for helping. The most useful contributions, roughly in order:

1. **Run a model** and submit it (site: *Run a model*, or `trolley run`, or the MCP/HTTP API). More models make the results page worth reading.
2. **Check a citation.** Every human baseline in `content/baselines/` and every entry in `content/papers/references.yaml` is unverified until a person has read the source. See [Sources](https://trolley-bench.sherlemious.com/sources).
3. **Propose or author a scenario pack.**
4. **Report bugs** and rough edges in the CLI, the site or the docs.

## Setup

Requires Node >= 20.11 and pnpm 10.

```bash
pnpm install
pnpm build            # tsc -b across the workspace; build before using the CLI
pnpm test             # typecheck plus the test suite
pnpm dev              # the site on http://localhost:4319
```

A full offline run with no keys and no network:

```bash
node apps/cli/dist/index.js run --pack classic --model echo --provider echo --limit 20
```

Before opening a pull request, run `pnpm test` and, if you touched anything under
`content/` or the engine, `pnpm verify:suites` and `pnpm verify:crlf`.

## The invariants

These are enforced by the type system and the schema. Changes that weaken them will not be
merged, because each is a way this kind of benchmark quietly produces wrong numbers.

- `elicitation_mode` is mandatory and never pooled. Answering a prompt and acting through a tool are different measurements.
- Refusal and unparseable replies are outcomes, reported beside every rate, never dropped.
- Demographic variation defaults to a swap pair and a sensitivity coefficient. No surface returns a ranking of groups.
- Scenarios are content-addressed and suites are frozen. Reproducibility is part of the schema.

The reasoning is in the [README](README.md) and [`docs/PLAN.md`](docs/PLAN.md).

## Scenario packs

Packs live in `content/packs/<name>/pack.yaml`, with presentation (tab names, intro text,
which suite the site runs) in `site.yaml` beside it, so wording never moves a hash.

- Run `trolley validate` and `trolley expand` to check a pack and see its design size.
- Changing a pack's rendered text changes instance hashes. A frozen suite (`content/suites/*.lock.json`) will fail `trolley verify` until it is deliberately re-frozen, and that is a version bump, not a quiet edit.
- Exclude incoherent cells with explicit constraints rather than rendering nonsense.
- Cite where a scenario or a human number comes from, and leave `verified: false` unless you have personally checked the source.
- Authored content is licensed CC-BY-4.0 and code Apache-2.0. By contributing you agree your contribution is under the matching licence.

## Pull requests

- Keep one change per pull request, and say what you ran to check it.
- Match the surrounding style. The codebase is strict TypeScript with Zod schemas at the edges.
- Add or update tests for behaviour changes.
- Do not commit run output (`runs/`), `.env*` files or API keys. If you think you have committed a secret, say so in the pull request and rotate the key.

## Reporting problems

Use the issue templates. For security issues, see [SECURITY.md](SECURITY.md) and do not open a public issue.

## Training data

If you are training a model, exclude this repository. The canary string in the README exists so contamination can be detected.
