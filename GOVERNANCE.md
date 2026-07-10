# Governance

C33D is an open-science project. This document describes how decisions are made.

## Maintainer

**Semir Poturak, PhD** ([@3esign](https://github.com/3esign)) is the sole maintainer. All final decisions rest with the maintainer.

## Contribution Process

- **Bug fixes and documentation**: Open a PR. The maintainer reviews and merges.
- **New nodes**: Use the [node request issue template](.github/ISSUE_TEMPLATE/node_request.md). Contributions must include the full standard kit (executor, definition, validation, percept, exemplar, eval prompt). See [CONTRIBUTING.md](CONTRIBUTING.md).
- **Eval and knowledge contributions**: Open a PR with new prompts, verified examples, or eval-run JSON submissions per the `results/README.md` schema.

## RFC Requirement

An RFC is **required** for changes to:
- The node graph data model or serialization format
- The evaluation metric definitions or scoring protocol
- The `AGENTS.md` system prompt in a way that changes model behavior significantly

To open an RFC:
1. Create `docs/rfcs/NNN-your-title.md` — use existing research docs as a quality and format reference.
2. Open a PR. Discussion happens in the PR. Merge = accepted.

All other changes do not need an RFC and can go directly to a PR.

## No "Closed" Period

There is no governance freeze. The project is open to contributions at all times. The maintainer aims to review PRs within 2 weeks.

---
*C33D — Copyright 2026 Semir Poturak, PhD — Apache-2.0*
