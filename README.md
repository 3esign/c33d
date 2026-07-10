# C33D
**AI that designs editable 3D models — parametric CAD you can talk to.**

![Hero Demo (Coming Soon)](docs/assets/hero.gif)

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![Live Demo](https://img.shields.io/badge/Live-Demo-brightgreen.svg)](#) <!-- Add URL -->

**[Try it](#) · [How it works](#how-it-works) · [Research](docs/research/README.md) · [Contributing](CONTRIBUTING.md)**

---

## What it does

C33D is a browser-based, AI-native parametric CAD system. You describe an object in chat, and an LLM agent architects it as a node graph. Because the output is a *graph* and not a static mesh, the model remains fully parametric. You can tweak dimensions, drag sliders, and remix features without breaking the design.

It generates real CAD geometry. The underlying engine runs OpenCascade (via `replicad`) in WebAssembly, meaning the designs are robust B-Rep solids that can be exported directly to STEP files for manufacturing or 3D printing.

We prioritize privacy and flexibility. C33D uses a **Bring Your Own Key (BYOK)** architecture. You input your own API keys (e.g., Gemini, OpenAI, or local Ollama), and they are stored exclusively in your browser's local storage. The application runs entirely client-side and never sends your keys or prompts to any external server other than the AI provider.

## Quickstart

```bash
git clone https://github.com/3esign/c33d.git
cd c33d
npm install
npm run dev
```

*Alternatively, use the [hosted live demo](#).*

## How it works

1. **Chat**: You describe the object you want to build.
2. **LLM Plans**: The AI agent reasons about the structural proportions and deconstructs the request into a series of parametric operations.
3. **Graph Generation**: The agent emits a node graph matching C33D's specific library (Primitives, Modifiers, Booleans).
4. **Validation Gate**: The graph is strictly typed and validated before execution.
5. **Execution**: A web worker runs the OpenCascade kernel to build the B-Rep geometry.
6. **Geometry Percepts**: The worker returns geometric reports (volume, bounding boxes, face counts) back to the LLM.
7. **Auto-Repair Loop**: If the geometry fails (e.g., self-intersecting fillet), the LLM uses the percepts to fix the graph autonomously.

## What makes it different?

| Feature | C33D | Grasshopper / Dynamo | CadQuery / build123d | Zoo (KCL) / text-to-CAD | Blender + LLM plugins |
|---|---|---|---|---|---|
| **Paradigm** | AI-authored **node graph**, human-editable | human-authored node graph | human-written code | AI-generated code/geometry | AI-driven destructive mesh edits |
| **Output stays parametric** | ✅ sliders + formulas + relations | ✅ | ✅ | partially (code regenerable, no live UI) | ❌ mesh |
| **Real CAD kernel (B-Rep, STEP)** | ✅ OpenCascade | ✅ Rhino | ✅ | ✅ | ❌ |
| **Runs in browser, no install** | ✅ | ❌ | ❌ | ✅ (SaaS) | ❌ |
| **Model-agnostic (BYOK)** | ✅ incl. Ollama | — | — | ❌ vendor-hosted | varies |
| **AI feedback loop** | ✅ (percepts & auto-repair) | — | — | internal/closed | ❌ |
| **Self-improving knowledge base**| ✅ human-gated examples | — | — | closed | ❌ |
| **Evaluation of parametric integrity**| ✅ (unique) | — | — | ❌ | ❌ |

## The Research Angle

C33D serves as an open research platform for **parametric design intelligence**. We tackle two main challenges in AI-CAD:

1. **The Knowledge Loop**: The agent can save verified, successful designs as few-shot examples, organically extending its own vocabulary based on human validation.
2. **Evaluation Methodology**: Unlike static text-to-CAD benchmarks, our [evaluation suite](results/README.md) scores models on **proportional integrity under parameter perturbation**. We test if a model's design logic survives when slider values change.

Read the foundational architecture documents in the [**Research Directory**](docs/research/README.md).

## Status & Roadmap

C33D is currently in a **Research Preview** phase. It is a proof-of-concept for AI-native parametric modeling.
See the [ROADMAP.md](docs/ROADMAP.md) for upcoming features and open RFCs.

## Contributing and Citation

We welcome contributions! Please see [CONTRIBUTING.md](CONTRIBUTING.md) (coming soon) for guidelines on adding new nodes, submitting verified examples, or contributing evaluation runs.

If you use C33D in your research, please cite it:

```bibtex
@software{poturak_2026_c33d,
  author       = {Poturak, Semir},
  title        = {C33D: AI-Native Parametric CAD},
  year         = 2026,
  url          = {https://github.com/3esign/c33d}
}
```

---
*C33D — Copyright 2026 Semir Poturak, PhD*
