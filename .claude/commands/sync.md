---
name: sync
description: Sync README Build Plan + GitHub issues to the current state of .planning/ROADMAP.md. Detects new/changed/shipped phases, updates the README Build Plan row + status paragraph + phase-count jokes, and creates/edits/closes the matching GitHub issue on ThePyProgrammer/aitc. Use after adding a phase (/gsd-add-phase or /gsd-insert-phase), shipping a phase, or whenever the ROADMAP changes in a way worth surfacing.
---

# /sync — keep README and GitHub issues aligned with ROADMAP.md

`.planning/ROADMAP.md` is the source of truth for phases. This command propagates that truth to the two human-facing surfaces that get stale: the README Build Plan, and the GitHub issue tracker at **ThePyProgrammer/aitc**.

Run it every time the ROADMAP changes status for a phase. Don't wait for a batch — user preference is commit-per-change (see their memory).

## Preconditions

- `gh` CLI is authenticated as `ThePyProgrammer` with `repo` scope. (`gh auth status` to verify.)
- Git remote `origin` points to `https://github.com/ThePyProgrammer/aitc`.
- `.planning/ROADMAP.md` and `.planning/STATE.md` exist and are current (GSD commands update them automatically — do not hand-edit).

## What /sync does, in order

### 1. Detect what changed

Read `.planning/ROADMAP.md`. For each phase, classify status from the roadmap markers:

| Roadmap signal | Status | README marker | Issue state |
|---|---|---|---|
| All plan checkboxes `[x]` **and** `**Verification status:** Passed` in the ### header | ✅ Shipped | `✅ shipped (YYYY-MM-DD)` | closed, reason: completed |
| All plan checkboxes `[x]` but `**Verification status:**` missing / UAT checkpoint exists (e.g. Phase 10 10-06-CHECKPOINT) | 🟡 N/N coded — UAT pending | `🟡 N/N coded — UAT pending on NN-MM checkpoint` | open |
| Some `[x]`, some `[ ]` | 🟡 In-flight | `🟡 N/M plans (NN-MM pending)` | open |
| `Plans: 0 plans` + `NN-CONTEXT.md` exists | ⏳ Drafted | `⏳ drafted (NN-CONTEXT.md)` | open |
| `Plans: 0 plans` + no CONTEXT | ⏳ Planning | `⏳ planning` | open |

Cross-check against `git log --oneline -20` for any recent commits referencing `(NN-XX)` — that's stronger evidence of shipped-ness than the roadmap checkboxes, which can lag.

Also check `gh issue list --repo ThePyProgrammer/aitc --state all --limit 30` to see what issues already exist and their state.

### 2. Update the README Build Plan

The plan is a fenced code block at roughly `README.md` lines 99–126 under `## the build plan, featuring scope creep`. **Every phase sits on its own line** in the form:

```
  NN   Phase title                          ← deps       status marker
  NN.M Phase title (INSERTED optional)      ← deps       status marker
```

Rules:
- Each phase row shows its **real dependencies** in the `← N, M` column — not sequential numeric predecessor. "Real deps" = the phases whose output this phase actually consumes. For phases with no CONTEXT yet, inherit from the ROADMAP's `Depends on:` line but **sanity-check against reality** and correct if obviously wrong (e.g. Phase 18 is a Phase 3/6 bug fix, not a Phase 17 dependent).
- Decimal phases (`11.1`) use the same flat format. Don't special-case INSERTED unless it adds information.
- Wave groupings are themed one-liners — keep the current ones unless the character of the wave actually shifts:
  - **Wave 0** — "ok let's actually ship v1" (Phases 1–6, strictly linear foundation)
  - **Wave 1** — "wait, I want more surfaces" (Phases 7–10)
  - **Wave 2** — "the radar should be sicker" (Phases 11–16, radar polish)
  - **Wave 3** — "things you only find out by actually running this" (Phases 17+, post-UAT reality checks)
- A new wave is only warranted when phases stop fitting thematically in any existing wave. Single-phase waves are fine if the theme doesn't match the others.
- Mark the current focus with `← next up` (only one at a time).
- If a phase ships, drop any `← next up` marker and move it to whichever phase the user would logically do next.

### 3. Update the Status paragraph

Just below the code block. Three paragraphs, loosely:

1. **Waves 0 + 1 summary** — what's shipped, what's pending in Phase 10
2. **Wave 2 progress** — current state + any UAT surface findings
3. **Wave 3** — the reality-check dumping ground; for each phase here, explain *why it exists* in one sentence. Wave 3 phases are the interesting story — give them a beat.

When a new phase appears, add a sentence explaining the event that filed it, not just a description of the scope. "Phase N was added because X" reads better than "Phase N will do Y." The why is more durable than the what.

### 4. Update the phase-count jokes (two locations)

**Location A** — intro to the Build Plan at around `README.md:95`. Format:

> Built phase-by-phase through [GSD](.planning/). Started as "oh I'll ship six phases, a cute little tower + radar + merge UI app." **Now there are [N]**, plus a decimal (11.1), and the count keeps going up every time I actually run the thing. [... then one sentence per added-after-v1.0 phase explaining why it was added. Keep it punchy. Preserve the "Classic." closer.]

**Location B** — credits closer at the bottom of the README (around line 167). Format:

> Now it's [N] phases long ([N+1] if you count 11.1) so...

Both numbers update together. **N = count of integer phases**, not including 11.1.

### 5. Sync GitHub issues

For each phase, the issue lives at `https://github.com/ThePyProgrammer/aitc/issues/NN` (number usually but not always matches phase number — check first with `gh issue list`). Actions:

| Transition | gh command |
|---|---|
| Status unchanged, body needs a content refresh | `gh issue edit <num> --body-file /tmp/aitc-NN.md` |
| Phase newly shipped | edit body first (add Verification section + Post-Ship Follow-up if applicable), then `gh issue close --reason completed` |
| Phase newly filed | `gh issue create --title "Phase NN: <title>" --body-file /tmp/aitc-NN.md` |
| New decimal / inserted | same as newly filed; title includes `(INSERTED)` suffix if decimal |

Keep issue bodies at `/tmp/aitc-NN.md` during the run, delete after. Do not commit temp body files.

### 6. Commit the README

One commit. Message format:

```
docs: <verb> Phase N in README Build Plan

<1–2 paragraph body explaining what changed and why. Lead with the
concrete change: "Phase N shipped YYYY-MM-DD — verified …" or
"Phase N inserted as a bug-fix phase after …".>

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

Do NOT commit the temp issue body files. Do not batch multiple-phase changes into one commit unless they genuinely landed together in the roadmap.

## Issue body template

Use this shape (adapt per-phase; a shipped phase will have more detail than a planning one):

```markdown
**Status:** <marker> · **Wave:** <N> — <theme> · **Depends on:** <real deps> · **Plans:** <N / M>

## Goal
<1–2 sentences. Source: the phase's `**Goal:**` line in ROADMAP.md, or Goal section of CONTEXT.md if present.>

## Scope
<5–10 bullets of concrete deliverables. Source: CONTEXT.md Scope section, or the roadmap `**Scope:**` block, or the plan SUMMARY.md files for shipped phases.>

## Key Decisions
<3–8 bullets in the form `- **D-NN (name):** <one-line>`. Pull real D-IDs from CONTEXT.md. Omit the section entirely if no decisions exist yet.>

## Plans
<One line per plan file, linked. For shipped phases, each plan has a one-line description; for planning phases, plans don't exist yet so this section may be omitted.>

## Success Criteria / Outstanding / Open design questions
<Three mutually exclusive variants depending on status:
  - Shipped → Success Criteria (all met) + a Verification section if applicable
  - In-flight → Outstanding: what's left, linked to the remaining plan
  - Planning / Drafted → Open design questions (enumerated, with choices when they're real multiple-choice)
>

## Links
<Always include phase directory, CONTEXT.md (if exists), VERIFICATION.md (if shipped), UI-SPEC.md (if UI hint).>
```

## Style rules to preserve

- **Tone is meme-y but informative.** "Classic." / "Why else would I build this" / "that's funny for exactly one demo" are the register. Don't veer into enterprise-onboarding voice. Don't remove existing jokes unless they've become factually wrong.
- **"Phases run strictly in numeric order / no cheating" is banned.** The build plan now shows real deps. Do not reintroduce the numeric-order framing.
- **No emojis outside the README Build Plan + issue bodies.** Status markers (✅ 🟡 ⏳) are fine there; don't add to commit messages or narrative prose.
- **One commit per change** (user preference, per memory). Don't squash README + issue-body edits with any other unrelated work.
- **Don't delete-recreate issues.** Always edit existing ones via `gh issue edit --body-file`. Deleting an issue loses its number + any conversation.

## Repo-specific facts successors need

- **GitHub repo:** `ThePyProgrammer/aitc`. Not `pragnition/htx/aitc` or any other path.
- **Phase directory naming:** `.planning/phases/NN-<slug>/` for integer, `.planning/phases/NN.M-<slug>/` for decimal inserts. Slug is auto-generated from description; truncate happens mid-word sometimes.
- **Issue numbering diverges from phase numbering.** As of 2026-04-21, Phases 1–17 map to issues 1–17, Phase 11.1 is issue 18, Phase 18 is issue 19, Phase 19 is issue 20. Always grep `gh issue list` by phase title, not by number.
- **Two planning files matter for status:** `.planning/ROADMAP.md` (phase-level narrative) and `.planning/STATE.md` (execution state, auto-updated by GSD). Prefer ROADMAP for content, STATE for current-focus marker.
- **Wave 3 is the "reality check" dumping ground.** Anything UAT-surfaced that isn't a Wave 2 radar concern probably lands here. Don't invent Wave 4 unless the theme clearly breaks.

## Gotchas encountered in prior runs

1. **Stale ROADMAP plan checkboxes.** ROADMAP.md sometimes shows `- [ ]` for plans that already have SUMMARY.md files — check `ls .planning/phases/NN-*/` and `git log | grep "(NN-"` to confirm real status.
2. **Empty phase directories.** Newly-inserted phases (`.planning/phases/NN-…/`) may only contain `.gitkeep` initially. That's fine — body explains "no plans yet," next step is `/gsd-plan-phase NN`.
3. **Phase description in the roadmap H3 heading is sometimes the whole pitch verbatim.** Shorten aggressively for the README Build Plan and the issue title.
4. **The `permission_mode` bypass commit `06fbf1e`** is referenced in Phase 8's issue body as a post-ship follow-up. If you ship anything analogous, note it under a **Post-Ship Follow-up** heading on the closed issue, not as a new issue.
5. **Files to gitignore.** `.claude/aitc-mcp-*.json` is already gitignored (commit `fb2c3b1`). If Phase 10 runs spawn other per-session junk, extend the rule — don't let it sit in `git status`.

## Quick self-check before finishing

- [ ] Build Plan has every phase, each on one line, with `← deps` populated
- [ ] `← next up` marker is on exactly one phase
- [ ] Status paragraph mentions every recent change
- [ ] Both phase-count jokes (intro + credits) match the actual count
- [ ] Every open phase has a corresponding open issue; every closed phase has a closed issue
- [ ] Commit message follows the `docs: <verb> Phase N …` template
- [ ] No `/tmp/aitc-*.md` files remain

When in doubt about tone, skim the most recent three README commits (`git log --oneline README.md | head -5`) — they're the house style.
