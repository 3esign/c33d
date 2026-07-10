# Agent Data and Knowledge

This directory (`.agents/`) contains the local state and knowledge files used by the AI agents operating within C33D. 
These files are kept local and versioned to ensure transparency of what the AI is told and what it has learned.

- **`AGENTS.md`**: The system instructions, rules, and parametric constraints provided to the LLM. This is where the core modeling philosophy ("Skeletal 'Bone' Rigging", "Watertight Box Modeling") is defined.
- **`KNOWLEDGE.json`**: The core verified knowledge base.
- **`EXAMPLES.json`**: Your local, personal repository of verified, successful model generation examples. These act as few-shot demonstrations to teach the model how to build new objects. (This file is gitignored to keep personal examples local).
- **`EVAL_RESULTS.json`**: Local logs of evaluation test runs.

By exposing these files rather than hiding them on a server, C33D ensures the AI's instructions are public, auditable, and locally modifiable.
