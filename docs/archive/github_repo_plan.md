# c33d as an Open-Science Project — Repository Design & Implementation Plan

*July 9 2026. Plan only — no changes made. Covers positioning, README architecture, open-science
infrastructure, contributor scaling, and a phased task list.*

---

## 0. What the repository must communicate (the one-sentence layers)

A visitor decides in ~30 seconds. The repo must deliver these claims in order, each backed by
something visible:

1. **For anyone:** "Describe an object in chat; an AI builds it as a *parametric* 3D model you can
   reshape with sliders — in your browser, no install." → hero GIF proves it.
2. **For makers/designers:** "It's Grasshopper-style node modeling where the AI writes the graph and
   you stay in control — every model stays editable, exportable (STEP), and remixable." → live demo
   (Vercel deployment already exists — make it the top link).
3. **For AI/research people:** "It's also an open research platform for *parametric design
   intelligence*: a verify-before-store knowledge loop, a perception–action agent architecture over a
   CAD kernel, and the first evaluation suite that scores models on whether their designs survive
   parameter changes." → docs/research + eval results.

That third claim is the project's unique scientific asset — no published text-to-CAD benchmark
measures parametric integrity. Present it confidently but as "evaluation methodology," letting others
call it a benchmark.

## 1. Current state (audit, honest)

Template Vite README (front door says nothing) · 3-commit history · remote still `c3d.git` (rename
redirect) · significant uncommitted work (formula fix, research docs, `.vercel/`) · `.agents/AGENTS.md`
+ `KNOWLEDGE.json` published without explanation · no LICENSE, no CONTRIBUTING, no CI, no releases ·
research docs exist (7 strong documents) but unlinked and undiscoverable · `EXAMPLES.json`/`EVAL_RESULTS.json`
untracked with no stated data policy. Everything below fixes these deliberately rather than ad hoc.

## 2. README architecture (progressive disclosure)

Single README.md, ~150 lines max, wide-audience top → technical bottom. Long material links out to docs/.

1. **Hero block** — name, one-line tagline ("AI that designs editable 3D models — parametric CAD you
   can talk to"), 15–30s GIF (prompt → graph grows → model appears → slider drags → whole design
   rescales *coherently*; that slider moment IS the thesis), badges (license, CI, live demo, DOI once
   minted), link row: **Try it · How it works · Research · Contributing**.
2. **What it does** (3 short paragraphs, zero jargon) — chat → node graph → real CAD geometry
   (OpenCascade B-Rep, STEP-exportable, 3D-printable); why parametric matters (one edit reshapes the
   whole design without breaking it); works with your own model API keys (Gemini/OpenAI/local Ollama —
   bring-your-own-model, nothing phones home).
3. **Quickstart** — 4 commands + "or use the hosted demo." Nothing above this point mentions
   architecture at all.
4. **How it works** (one diagram + 6 bullets) — chat → LLM plans → emits graph ops → validation gate →
   worker executes (replicad/OpenCascade WASM) → geometry report ("percepts") returns to the model →
   auto-repair loop → vision check. The diagram is the single most reused asset; make it
   docs/assets/architecture.svg.
5. **What makes it different** (the comparison table — §3).
6. **The research angle** (short) — the knowledge loop (models save verified successful designs as
   few-shot examples: "the AI extends its own vocabulary, gated by human verification"), the eval
   methodology (parse → execute → geometry sanity → task checks → **proportional integrity under
   parameter perturbation**), link to docs/research/ and the eval results.
7. **Status & roadmap** — honest maturity statement (research preview), link to ROADMAP.md and open RFCs.
8. **Contributing + citation** — link CONTRIBUTING.md; CITATION.cff snippet.

## 3. Comparison section (draft content — verify claims before publishing)

| | c33d | Grasshopper / Dynamo | CadQuery / OpenSCAD / build123d | Zoo (KCL) / text-to-CAD services | Blender + LLM plugins |
|---|---|---|---|---|---|
| Paradigm | AI-authored **node graph**, human-editable | human-authored node graph | human-written code | AI-generated code/geometry | AI-driven destructive mesh edits |
| Output stays parametric | ✅ sliders + formulas + relations | ✅ | ✅ | partially (code is regenerable, not live-editable UI) | ❌ mesh |
| Real CAD kernel (B-Rep, STEP) | ✅ OpenCascade | ✅ Rhino | ✅ | ✅ | ❌ |
| Runs in browser, no install | ✅ | ❌ | ❌ | ✅ (SaaS) | ❌ |
| Model-agnostic (BYO key, local models) | ✅ incl. Ollama | — | — | ❌ vendor-hosted | varies |
| AI feedback loop (geometry percepts, auto-repair, vision check) | ✅ | — | — | internal/closed | ❌ |
| Self-improving knowledge base (verified examples as few-shot) | ✅ human-gated | — | — | closed | ❌ |
| Open evaluation of parametric integrity | ✅ (unique) | — | — | ❌ | ❌ |
| License | TBD (§5) | proprietary | open | partially open | open (Blender) |

Also name-check research systems (Text2CAD-Bench, CAD-Coder, AIDL, Autodesk AutoConstrain) in
docs/research/README.md with one line each on how c33d relates — this earns credibility with the
academic audience and shows the comparisons are informed, not marketing. Frame respectfully: each tool
is best at what it's for; c33d's niche is the *AI-native parametric loop*.

## 4. Open-science infrastructure

**What is open (the scientific artifacts):**

- `docs/research/` — move the 5 research/design docs here, add an index README ordering them
  (proportional coherence → sub-shape editing → vector/curve toolkit → node expansion → eval upgrade).
  These documents are genuinely publishable-quality project research; surfacing them IS the
  open-science move.
- **Eval methodology + prompt set** — dev set public (it already is, in code); held-out set stays
  private per eval_upgrade_plan. Publish the *protocol*: metrics definitions, versioning scheme
  (metricsVersion / promptSetVersion / nodeLibraryVersion), how to reproduce a run.
- **Results** — `results/` directory (or a results branch) with versioned suite runs per
  model/provider: the "which models can do parametric design?" matrix. This table will be the most
  cited artifact of the project. Contributors can submit runs via PR (schema-validated JSON + the
  version stamps make third-party runs comparable).
- **Knowledge/examples dataset** — decide the split: `data/seed-examples/` (curated, committed,
  CC-licensed) vs. personal `.agents/EXAMPLES.json` (gitignored). Community-contributed verified
  examples via PR become the shared "design intelligence" corpus — this is the scalable version of
  your knowledge base, and the heart of "multiple contributors to general parametric design
  intelligence."
- **CITATION.cff** + **Zenodo DOI** (link repo → releases auto-mint DOIs) — costs 30 minutes, signals
  open science instantly, makes the project citable in the text-to-CAD literature.

**Explain `.agents/` in-repo** — a short `.agents/README.md`: what AGENTS.md and KNOWLEDGE.json are,
why they're versioned (transparency of what the AI is told), what's local-only (results, personal
examples). Right now they look like accidentally-committed internals; documented, they become a
feature ("the AI's instructions are public and auditable").

## 5. Licensing & hygiene decisions (need your call)

1. **License:** recommend **Apache-2.0** (patent grant matters for CAD; corporate-friendly) — MIT
   acceptable; decide before promoting the repo, relicensing later is painful. Data/examples corpus:
   CC-BY-4.0. *(Not legal advice — confirm if it matters commercially.)*
2. **Secrets posture:** API keys are entered client-side and stored where? Document it in README
   (privacy paragraph) and add a SECURITY.md. Verify `.vercel/` contains no tokens before committing
   (`project.json` is safe; check anyway) — add to .gitignore regardless.
3. **Repo naming:** fix remote (`git remote set-url origin …/c33d.git`); decide the display name
   (c33d vs C3D) and use it consistently — README, package.json, index.html title.
4. **History:** current 3-commit history is fine; going forward use conventional commits (feat:/fix:/docs:)
   so changelogs generate automatically.

## 6. Contributor scaling (the "multiple contributors" design)

The insight: **your node-contribution recipe is already standardized** — the "standard kit" (executor +
definition + validation contract + percept + exemplars + eval prompts) appears in every design doc.
Turn it into infrastructure:

- **CONTRIBUTING.md** with three ladders: (a) *node contributions* — a template checklist derived from
  the standard kit, plus a `docs/contributing/adding-a-node.md` walkthrough (one existing node as the
  worked example); (b) *eval/knowledge contributions* — prompts, acceptance checks, verified examples,
  eval-run submissions; (c) *research contributions* — RFCs.
- **RFC process, lightweight:** `docs/rfcs/NNN-title.md`, PR = proposal, merge = accepted. Seed it by
  converting the existing design docs into RFCs 001–005 — instant precedent, and contributors see the
  quality bar.
- **Issue templates:** bug (with graph JSON + model/provider/protocol fields — the bee lesson), node
  request (auto-links the vector/curve catalog), eval anomaly.
- **Good-first-issue farm:** the vector/curve catalog's S-cost rows are ~25 well-specified, isolated,
  testable tasks — ideal first contributions. Label them at repo launch so the repo *arrives* with an
  on-ramp.
- **CI (GitHub Actions):** typecheck + worker unit tests (`tests/*.mjs`) + a **deterministic graph
  replay suite** — saved known-good graphs re-executed in the worker, geometry reports diffed against
  stored snapshots. This gives PR-gating *without* LLM calls (no API keys in CI, zero cost, no flake).
  LLM-in-the-loop evals stay local/manual; CI protects the kernel and validation layers where
  contributor risk actually lives.
- **Branch protection** on main once CI exists; PRs require the checklist.
- **Governance, minimal:** you as maintainer, RFC for anything touching the data model or eval
  metrics, everything else by PR review. Write it down in GOVERNANCE.md (3 paragraphs, not a
  constitution).

## 7. Target repository layout

```
README.md                    ← §2 architecture
LICENSE · CITATION.cff · CONTRIBUTING.md · SECURITY.md · GOVERNANCE.md · CHANGELOG.md
docs/
  assets/                    ← GIF, architecture.svg, screenshots
  research/                  ← the 5 reports + index (moved from docs/)
  rfcs/                      ← 001–005 seeded from design docs
  contributing/adding-a-node.md
  ROADMAP.md · test_prompts.md
data/seed-examples/          ← curated, licensed example corpus
results/                     ← versioned eval runs (schema + submissions)
.github/                     ← workflows/ci.yml, ISSUE_TEMPLATE/, PULL_REQUEST_TEMPLATE.md
.agents/README.md            ← explains the AI-facing files
src/ · tests/ · public/      ← unchanged
```

## 8. Phased implementation plan

**Phase 1 — Foundation (do before any promotion; ~1 day)**
1. Commit current WIP (formula fix etc.) with clean conventional messages; fix remote URL.
2. LICENSE (your decision, §5) + CITATION.cff + SECURITY.md; verify `.vercel/` + gitignore it.
3. Replace template README with the §2 skeleton (text-only first; placeholder for GIF).
4. Move research docs → docs/research/ with index; add .agents/README.md.

**Phase 2 — Show, don't tell (~1–2 days)**
5. Record the hero GIF (prompt → build → slider drag; the proportional-coherence work makes this demo
   honest — sequence this after the perturbation/attach work lands, or pick a model that already scales well).
6. Architecture diagram (SVG); screenshots of graph + viewport + eval panel.
7. Comparison table with verified claims; research name-checks in docs/research/README.md.
8. Wire the live-demo link (Vercel) prominently; add a "bring your own key" privacy note.

**Phase 3 — Contributor rails (~2 days)**
9. CONTRIBUTING.md + adding-a-node walkthrough + PR/issue templates.
10. CI: typecheck + worker tests + graph-replay snapshots (build the replay fixture set from 5–10
    curated graphs).
11. Seed RFCs 001–005 from the design docs; GOVERNANCE.md; label ~15 good-first-issues from the
    vector/curve catalog.

**Phase 4 — Open-science artifacts (~1–2 days, after eval upgrade Phase 1–2 land)**
12. results/ schema + first cross-provider suite run committed; results table auto-rendered into README
    (script or Action).
13. data/seed-examples/ split + license; document the example-contribution flow.
14. Zenodo hookup + first tagged release (v0.1.0) + CHANGELOG.

**Dependencies to note:** the hero GIF and the results table are the two highest-impact assets and both
depend on in-flight engineering (proportional coherence, eval upgrade). Everything in Phases 1 & 3 can
proceed immediately in parallel.

## 9. Success criteria (how you'll know the repo design works)

A stranger can: understand the project in 30s (README top), run it in 5 min (quickstart), find the
science in 2 clicks (docs/research), make a first contribution without asking questions
(adding-a-node + labeled issues), and reproduce an eval run from the published protocol. Each phase
above maps to one of these.

---

*Decisions locked July 9 2026: license **Apache-2.0** (code) + **CC-BY-4.0** (data/research); display
name **C33D** everywhere (`c33d` in package.json); author/signature **Semir Poturak, PhD
&lt;poturaksemir@gmail.com&gt;** in LICENSE/NOTICE, CITATION.cff, package.json, README; eval results
public from day one as schema + protocol, first matrix published only after version stamps + n=3
repeats land. Held-out prompts private; seed corpus 10–20 curated examples; sole-maintainer + RFC
governance; v0.1.0 + Zenodo DOI after Phases 1–2. Implementation on hold until further instruction.*
