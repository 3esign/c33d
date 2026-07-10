# C3D — Parametric CAD Architect

C3D is a state-of-the-art agentic CAD design engine and web application that compiles natural language prompts into parametric, watertight 3D models. It couples a dynamic Node Graph visual scripting interface (powered by React Flow) with a high-performance boundary-representation (B-Rep) CAD kernel (OpenCascade, compiled to WebAssembly via Replicad).

## Features

- **Parametric Node Graph**: Visualizes CAD operations as a data-flow graph of primitives, transforms, booleans, and math sliders.
- **Wasm-Powered B-Rep Kernel**: Evaluates complex geometric operations (fillets, lofts, sweeps, subdivision, boolean subtraction) locally in a Web Worker using OpenCascade.js.
- **Proportional Coherence Engine**: Evaluates the design at different scale factors (e.g. 0.6x and 1.5x) to verify design intent and flag any mechanical shearing or intersection issues before saving.
- **Success Example Retrieval (RAG)**: Retrieves verified CAD graph recipes based on prompt similarity using vector embeddings.
- **Interactive Repair Loop**: Detects evaluation crashes, topological changes, and visual inconsistencies, feeding self-repair hints back to the LLM.

## Tech Stack

- **Frontend**: React, TypeScript, Vite, Tailwind CSS, React Flow
- **CAD Kernel**: OpenCascade (via `replicad`) running in a Web Worker
- **3D Viewport**: Three.js/React Three Fiber

## Getting Started

### Prerequisites

- Node.js (v18+)
- npm or yarn

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/3esign/c33d.git
   cd C3D
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Run the local development server:
   ```bash
   npm run dev
   ```

## Development & Structure

- `src/nodes/`: Node registry and specifications.
- `src/worker/`: B-Rep executors registry (`executors.ts`), geometry workers, and kernel-level computations.
- `src/ai/`: Agent process loops (`agent.ts`), graph linter rules (`graphValidation.ts`), retriever modules, and verification diagnostics.
- `src/components/`: Node canvas editor and evaluation panels.

## Testing

Run the local test harness to verify spline helix generation, sweep calculations, and boolean robustness:
```bash
node tests/test_bendtwist.mjs
```
