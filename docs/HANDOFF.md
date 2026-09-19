# trolleybench — handoff

*Written 2026-09-20. Read `docs/PLAN.md` for the design argument; this is the operational
state, what will bite you, and what to do next.*

---

## 1. Do this first

**Rotate the Neon database password.** A crash on 2026-09-19 threw outside the route's
error handler, and Next's default handler wrote the whole connection string — password
included — into Vercel's runtime logs, where anyone with project access can read it.
Vercel says it plainly: *"Removing this variable from Vercel does not revoke the
credential."* The leak is closed in code (three ways, §6) but the credential itself is
still live.

```bash
# 1. rotate in the Neon console, then:
#    update .env.local   (DATABASE_URL, pooled endpoint)
npx vercel env rm DATABASE_URL production --yes
printf '%s' "$NEW_URL" | npx vercel env add DATABASE_URL production
```

**Also outstanding:** `neon mcp -y` minted an **account-wide** API key (id `3347589`)
written into seven config files outside this repo. Neon's own warning: *"This key reaches
everything your account can, in every organization."* Revoke with
`neon api-keys revoke 3347589` when you no longer need the MCP server.

---

## 2. What this is

A **construction kit for moral-dilemma experiments**, with one frozen suite built on it.
Scenarios are parameterized templates, not fixed strings: a factorial engine expands them
across mechanism, harm structure, victim ratio, language, framing, moral-framework
steering and option order, runs them against models (or humans), and produces
publication-grade statistics.

Three things nobody currently ships together — the reason this exists:

1. **Parameterized factorial design** — the scenario *is* an experiment design, so you get
   AMCE conjoint estimates, not a percentage.
2. **Behavioural elicitation via MCP** — an agent *pulls the lever* as a tool call rather
   than answering a prompt. Revealed preference, not stated. *(Phase 3, not built.)*
3. **Reproducibility as schema** — content-addressed scenarios, frozen suites, pinned
   model versions, full transcripts, from day one.

Four decisions are locked and should not be relitigated without reason: own TypeScript
runner (plus an Inspect AI exporter); interactive human-playable surface with consented
baselines; **local-first, BYOK** — runs work offline with the user's keys, the server is
optional; authored factorial packs as the core, vendoring only unambiguously-licensed
third-party data.

---

## 3. Where things stand

| | state |
|---|---|
| **Live site** | https://web-kappa-eosin-81.vercel.app |
| **Repo** | https://github.com/Sherlemious/trolleybench |
| **Tests** | 166 passing, 13 files |
| **CI** | **none** — GitHub Actions removed on request (§5) |
| **Database** | Neon `nameless-tooth-38509020`, branch `production`. Schema live, **zero rows** |

**Built:** `spec`, `engine`, `scenarios`, `adapters`, `runner`, `scoring`, `analysis`,
`store`; `apps/cli`, `apps/web`.

**Empty stubs:** `packages/i18n`, `packages/inspect-export`, `packages/loaders`,
`apps/mcp`, `apps/worker`.

**Phase status** (detail in `docs/PLAN.md § Status`):

- **Phase 0** — built. Clause (b), cross-platform hash stability, proven 2026-09-18 on
  ubuntu/windows/macOS. Clause (a), a real offline run against a local model, **open**.
- **Phase 1** — analysis implemented and validated against known injected effects. The
  criterion as written — *a real AMCE from a real model run* — is **open**, same blocker.
- **Phase 2** — workbench and results explorer shipped. Factor explorer across languages
  and the consented human-baseline flow are not built.
- **Phases 3–5** — not started.

---

## 4. Running it

```bash
pnpm install
pnpm build                  # tsc -b across the workspace; run this before the CLI
pnpm exec vitest run        # 166 tests
pnpm dev                    # web app on :4319

node apps/cli/dist/index.js --help
```

The CLI is `trolley`: `models`, `validate`, `expand`, `run`, `freeze`, `verify`,
`analyze`, `db`.

```bash
# a full offline run and analysis, no keys, no network
node apps/cli/dist/index.js run --suite content/suites/canon-v0.yaml \
  --model echo --provider echo --out runs/demo.jsonl
node apps/cli/dist/index.js analyze runs/demo.jsonl --axis moral_framework

# the two checks that used to be CI
pnpm verify:suites          # canon.v0 still matches its lock
pnpm verify:crlf            # rewrites content/ to CRLF, verifies, restores
```

`.env.local` at the **repo root** holds `DATABASE_URL`. Both the CLI and
`apps/web/next.config.mjs` read it from there, so there is one copy of the secret rather
than two. The real environment always wins, which is why Vercel is unaffected.

---

## 5. Things that will bite you

**There is no CI.** Removed on request 2026-09-19. Nothing now catches a cross-platform
hash regression, and a single machine cannot prove cross-platform stability. Run
`pnpm verify:suites` and `pnpm verify:crlf` before freezing a suite or merging content,
on more than one OS if you can. Phase 0 clause (b) is met *for the tree as of
2026-09-18* and unproven for every tree after it.

**The load-bearing Vercel setting is not in this repo.** Root Directory must be
`apps/web`. The root `package.json` has no `next` dependency, so a Root Directory of `.`
makes Vercel report *No Next.js version detected*; pointing `outputDirectory` at
`apps/web/.next` looks like the fix and is not — it then becomes the only thing telling
Vercel where the app lives and gets appended twice, so the build succeeds and then dies
looking for `apps/web/apps/web/.next`. Both errors are one mismatch. With the setting
right, every framework default is correct and **no `vercel.json` is needed**, which is
why there isn't one.

**`tsc -b ../..` in `apps/web`'s build script is not optional.** Workspace packages
resolve through `main`/`types` into `dist/`, which is gitignored, so without it Vercel
cannot resolve `@trolleybench/scenarios` at all.

**Windows: `grep -q $'\r'` lies.** Under Git Bash on `windows-latest` it reports no match
even when the bytes are plainly CR LF. Any CRLF guard written in shell passes without
checking anything — `scripts/to-crlf.mjs` does its own verification in Node for exactly
this reason.

**npm scripts run under `cmd.exe` on Windows**, so `${PORT:-4319}` and friends do not
expand. Ports are hardcoded.

---

## 6. The four invariants

These are the spine. Breaking one produces numbers that look fine and mean nothing, which
is this project's characteristic failure mode — every bug in §7 had that shape.

**1. `elicitation_mode` is mandatory and never pooled.** A model answering a prompt and an
agent calling `pull_lever()` are not commensurable. Enforced *structurally*: every
aggregate in `packages/analysis` takes `ModeScoped<M, ResultRow[]>`, and the only producer
is `partitionByMode()`. The brand symbol is never exported, so there is no constructor and
no sanctioned widening — you cannot call an aggregator without partitioning, because you
cannot produce its argument type.

The real check is the **API-shape audit** (`packages/analysis/test/invariant.test.ts`), not
a `@ts-expect-error` test. It reads the source and fails on any exported function taking a
bare `ResultRow[]`. Pre-partition helpers need an explicit `@pre-partition` marker in their
own doc comment — a written claim rather than an inferred property, so every exemption
shows up in a diff. *Verify it still works by planting a violating export and watching it
fail; a green check that asserts nothing is worth less than no check.*

**2. Refusal is an outcome, not a parse failure.** `refusal`, `unparseable`, `rating` and
`error` are enum members. The denominator for a choice rate is `act + omit`, nothing else,
and an act rate over an empty denominator is **`null`, never 0** — reporting 0 would read
as "never intervenes", a finding that did not happen. Same convention in SQL
(`packages/store/src/query.ts`) and in JS (`packages/analysis/src/rates.ts`).

**3. Demographic variation has two representations.** `IdentitySwap` is the default and
yields only a Δ-sensitivity coefficient — there is no schema path to "the model prefers
group A". `ConjointAttribute` exists for Moral Machine-style multi-level designs, gated
behind `--bias-audit` with a stated purpose. Coefficients are always baseline-relative with
CIs, and **no surface returns a sorted or ranked view of levels** — including charts. The
forest plot draws levels in design order for this reason.

**4. Content-addressed hashing and suite freezing ship now.** Canonical form normalizes key
order, CRLF→LF and Unicode to NFC before hashing. `canon.v0` digest:
`sha256:0c32b994a29bf471619a9fb9e6636eb7b07f3c20a1953efde510f699c22f0102`.

---

## 7. Bugs found so far, and what they teach

Every one produced plausible-looking wrong numbers rather than a crash. Kept because the
*shape* recurs, not for nostalgia.

| bug | what it would have reported |
|---|---|
| `matchLabel` inverted negated answers | "I would not operate" scored as **act** |
| `extractRating` returned `act` for Likert | every `--formats likert` run at **100% act, zero refusals** |
| `matchOptionId` matched bare `\bpull\b` | "I would not pull" scored as **act** |
| Manifest recorded the wrong grid | **108 of 144 rows** silently unjoinable |
| Fresh run appended to existing `--out` | every cell counted **twice**, rates plausible, *n* a lie |
| CTE aliased a table Drizzle didn't | PGlite caught it; a mock would have waved it through |

Two are worth internalising:

**The manifest bug was "fixed" once and wasn't.** A suite run recorded the CLI's default
grid rather than the suite's own. The test that proved the fix bypassed the manifest and
expanded the suite directly, so it passed while the bug stood. It only surfaced when
`trolley analyze` reported orphans. A run now refuses to start unless re-expanding from its
own spec recovers the instance set it is about to run.

**A test can assert the wrong thing confidently.** The clustering test asserted that a
cluster bootstrap gives wider intervals. That folk rule is only half true, and it failed
against a *correct* implementation:

| statistic | clustered vs row-level |
|---|---|
| marginal act rate | **4.74× wider** |
| within-subject AMCE | **0.80×**, i.e. narrower |

Every subject answers at both levels, so the subject intercept cancels in the difference;
the row-level bootstrap breaks the pairing and re-injects it as noise. Both directions are
correct, and the test now asserts both.

---

## 8. What to do next

**Highest value: run against a real local model.** It closes Phase 0 clause (a) and Phase 1's
criterion at once, and it is the only thing standing between "the analysis is validated" and
"the analysis has produced a finding". Install Ollama, then:

```bash
node apps/cli/dist/index.js models          # should list local models with no config
node apps/cli/dist/index.js run --suite content/suites/canon-v0.yaml --model llama3
node apps/cli/dist/index.js analyze runs/<id>.jsonl
```

Expect the option-order flip rate to be the first thing worth looking at. If it is near
50%, the model is tracking position rather than content and every other estimate on that
run is an artefact.

Then, roughly in order:

1. **Inspect AI exporter** (`packages/inspect-export`) — Phase 1's unbuilt fourth
   deliverable. `trolley export --inspect` should emit a task that runs under `inspect eval`.
   This is the bridge to the Python eval ecosystem and the cheapest distribution win.
2. **Phase 3 MCP**, in three distinct directions that must not be conflated:
   `trolley-subject` (inbound, the agent *acts* — `elicitation_mode: "mcp_tool"`),
   `trolley-lab` (inbound, researcher console), and the **Subject Provider Protocol**
   (outbound, we are the client; anyone wraps their model in ~60 lines and it is still
   `elicitation_mode: "prompt"` with `transport: "mcp_stdio"`). *Transport is not
   elicitation mode.*
3. **Consent flow**, before any human answer is persisted. The workbench footer currently
   promises answers never leave the browser; wiring play-through to Neon without a consent
   screen would make the deployed page contradict itself.
4. **`packages/i18n`** — unblocks the cross-language factor explorer. Arabic is a launch
   language and has six plural categories; narratives are already ICU MessageFormat for
   this reason, and RTL is required from the start.

**Do not** put accounts on the roadmap before Phase 5. Run results are keyed by
`run_id`/`subject_id`; human play-through needs an anonymous participant ID and a consent
screen, not a login. Accounts become load-bearing only for authed leaderboard writes and
signed bring-your-own-run manifests.

---

## 9. Open questions

- **Verify every citation** in scenario provenance before flipping `verified: true`. Wrong
  citations propagate into every downstream result row.
- **Moral Machine data licensing** is unconfirmed. Stay loader-only until the authors say
  otherwise; the 9-dimension *design* is reimplementable, their data is not.
- **Where does the private held-out split live?** By definition not in a public repo, and
  the Phase 5 leaderboard depends on it.
- **Is the echo sample the right thing to ship on the live site?** It is honest — the page
  says loudly that the subject is a deterministic stub — but a real run would be better.
  Production Neon is deliberately empty; use a Neon dev branch for anything exploratory.
