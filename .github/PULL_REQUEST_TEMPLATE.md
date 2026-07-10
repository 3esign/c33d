## Summary of changes
<!-- What does this PR do? Link to any related issues. -->

## Type of change
- [ ] Bug fix
- [ ] New node (executor + definition + validation + percept + exemplar + eval prompt)
- [ ] Eval / knowledge contribution (prompts, verified examples, eval run results)
- [ ] Research RFC
- [ ] Documentation improvement
- [ ] Infrastructure / CI

## Node contribution checklist (if applicable)
- [ ] Executor added to `src/worker/executors.ts`
- [ ] Definition added to `src/nodes/NodeDefinitions.ts`
- [ ] Validation rules added to `src/ai/graphValidation.ts`
- [ ] Percept reported (geometry data returned to LLM)
- [ ] At least one exemplar graph added to `data/seed-examples/`
- [ ] At least one eval prompt added to `docs/test_prompts.md`

## General checklist
- [ ] `npm run build` passes without errors
- [ ] `tsc -b` passes cleanly
- [ ] Worker unit tests pass: `node tests/test_selection.mjs`
- [ ] PR description explains *why*, not just *what*
