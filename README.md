# C33D
**AI that designs editable 3D models — parametric CAD you can talk to.**

> **Research Preview** — works today, evolving fast. [Try the live demo](#) or run it locally in 4 commands.

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-89%25-blue)](src/)
[![Research Preview](https://img.shields.io/badge/Status-Research%20Preview-orange)](#status--roadmap)

**[Try it](#quickstart) · [How it works](#how-it-works) · [Research](docs/research/README.md) · [Contributing](CONTRIBUTING.md)**

---

## What it does

C33D is a browser-based, AI-native parametric CAD system. You describe an object in chat, and an LLM agent architects it as a **node graph**. Because the output is a *graph* and not a static mesh, the model remains fully parametric — you can tweak dimensions, drag sliders, and remix features without breaking the design.

The underlying engine runs **OpenCascade** (via [`replicad`](https://replicad.xyz)) in WebAssembly — producing robust B-Rep solids exportable directly to **STEP** for manufacturing or 3D printing.

C33D uses a **Bring Your Own Key (BYOK)** architecture. API keys are entered once in the UI, stored exclusively in your browser's local storage, and never sent anywhere except the AI provider you chose. Nothing phones home.

## Quickstart

```bash
git clone https://github.com/3esign/c33d.git
cd c33d
npm install
npm run dev
```

Then open **http://localhost:5173** and enter your Gemini or OpenAI API key. *Or use the [hosted live demo](#).*

## How it works

1. **Chat** — You describe the object you want to build.
2. **LLM Plans** — The agent reasons about structural proportions and deconstructs the request into parametric operations.
3. **Graph Generation** — The agent emits a typed node graph (Primitives → Modifiers → Booleans → Compounds).
4. **Validation Gate** — The graph is schema-validated before execution; invalid connections are rejected outright.
5. **Execution** — A web worker runs the OpenCascade kernel in WASM to build the B-Rep geometry.
6. **Geometry Percepts** — The worker returns geometric reports (volume, bounding boxes, face counts) back to the LLM.
7. **Auto-Repair Loop** — If the geometry fails (e.g., self-intersecting fillet), the LLM uses the percepts to autonomously fix the graph.

## What makes it different?

| Feature | C33D | Grasshopper / Dynamo | CadQuery / build123d | Zoo (KCL) / text-to-CAD | Blender + LLM plugins |
|---|---|---|---|---|---|
| **Paradigm** | AI-authored **node graph**, human-editable | human-authored node graph | human-written code | AI-generated code/geometry | AI-driven destructive mesh edits |
| **Output stays parametric** | ✅ sliders + formulas + relations | ✅ | ✅ | ⚠️ code regenerable, no live UI | ❌ mesh only |
| **Real CAD kernel (B-Rep, STEP)** | ✅ OpenCascade | ✅ Rhino | ✅ | ✅ | ❌ |
| **Runs in browser, no install** | ✅ | ❌ | ❌ | ✅ (SaaS) | ❌ |
| **Model-agnostic (BYOK, Ollama)** | ✅ | — | — | ❌ vendor-locked | varies |
| **AI feedback loop (percepts + auto-repair)** | ✅ | — | — | internal / closed | ❌ |
| **Self-improving knowledge base** | ✅ human-gated | — | — | closed | ❌ |
| **Evaluation of parametric integrity** | ✅ (unique metric) | — | — | ❌ | ❌ |

## The research angle

C33D is also an open research platform for **parametric design intelligence**:

1. **The Knowledge Loop** — The agent saves verified successful designs as few-shot examples, organically extending its own vocabulary based on human validation.
2. **Evaluation Methodology** — Unlike static text-to-CAD benchmarks (which measure if a shape *compiles*), our [eval suite](results/README.md) scores models on **proportional integrity under parameter perturbation**: does the design logic survive when slider values change? Does a car's wheelbase stretch coherently when you double the chassis length?

See the [Research Directory](docs/research/README.md) for the foundational design documents (proportional coherence, sub-shape editing, vector/curve toolkit, node expansion, and eval upgrade plans).

## Status & roadmap

C33D is a **Research Preview** — a working proof-of-concept for AI-native parametric modeling. The node library grows continuously. See [docs/ROADMAP.md](docs/ROADMAP.md) for what's next.

## Contributing & citation

Contributions are welcome at every level — new nodes, eval runs, verified examples, or research RFCs. See [CONTRIBUTING.md](CONTRIBUTING.md) for the three contribution paths.

If you use C33D in your research:

```bibtex
@software{poturak_2026_c33d,
  author  = {Poturak, Semir},
  title   = {C33D: AI-Native Parametric CAD},
  year    = 2026,
  url     = {https://github.com/3esign/c33d}
}
```

---
*C33D — Copyright 2026 Semir Poturak, PhD — [Apache-2.0](LICENSE)*
