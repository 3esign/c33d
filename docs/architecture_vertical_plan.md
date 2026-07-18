# Architecture & Site-Context Vertical — First-Principles Plan
*July 16, 2026. Companion to ROADMAP.md §5. Scope: natural-language-driven floor plans grounded in a real site, as the first slice of an architecture-design capability built on the existing C33D parametric core.*

---

## 0. Framing

Floor-plan generation from a brief is already a solved *product* problem at the surface level (Maket.ai, TestFit, and Finch3D all do brief-in/variants-out for residential today). What isn't commoditized, and what C33D already has a head start on, is a fully transparent, parametric, editable graph instead of a black-box render — the same differentiator the rest of the engine already leans on, pointed at buildings.

The user's framing (2026-07-16 conversation) pushes further than "just floor plans": location, terrain, real dimensions over a real site, rectangle rooms editable by dimension, then progressively openings, wall thickness, energy efficiency, and siting optimization. That ordering turns out to be load-bearing, not just a wishlist — see §1.1 for why site-context has to come first, not last.

## 1. Key architecture decisions

### 1.1 Site-context-first is a dependency, not a nice-to-have
Energy/daylighting scoring (Phase 4) and siting optimization (Phase 5) both need a *real* geographic anchor and true-north orientation to mean anything — you cannot score solar exposure or optimize a building's rotation on a parcel without first knowing where north actually is. Grounding the model in a real site from Phase 0 avoids re-deriving this later. Rooms-as-rectangles (Phase 1) is a deliberate simplification, not a limitation — polygons are a later generalization of the same primitive, not a redesign.

### 1.2 Imagery source: pluggable, not hard-coded to one provider
"Open source satellite imagery" isn't a single clean answer — coverage, resolution, and license trade off against each other:

- **NAIP** (USGS) — public domain, 0.3–1m resolution, reliable annual US coverage. Best default for US sites. Available via AWS Open Data / ArcGIS REST tiles.
- **OpenAerialMap** — genuinely open-licensed (CC-BY/public domain), global aspiration, but community-contributed so coverage and resolution are patchy. Good fallback, not a reliable primary.
- **Sentinel-2 / Copernicus** — global, free, open — but 10m/pixel, coarser than most rooms. Useful only for terrain/context zoom-out, not the working trace layer.
- **Mapbox / MapTiler satellite** — consistent global high resolution, but commercial (API key, usage-based). Pragmatic opt-in fallback where open sources don't cover a site.
- **Microsoft Global ML Building Footprints** — not imagery, but an open dataset of building *footprint polygons* (with height estimates) derived from satellite imagery. For sites with an existing structure, this can seed the outline directly as real vector geometry instead of the user tracing a photo.

Recommendation: build the Site node's fetch as a provider list (NAIP → OpenAerialMap → Mapbox/MapTiler opt-in), not a single hard-coded source, and check Building Footprints first for a possible real-outline seed.

### 1.3 One rendering surface, not two
Don't build a second, separate map-editing app (e.g. a Leaflet/MapLibre canvas with its own drawing/selection tools) alongside the existing three.js viewport — that produces two data models and two editors that drift apart. Instead:
1. Use **MapLibre GL JS** (the open-source, license-free fork of Mapbox GL JS, with raster tiles + geocoding/search) for exactly one job: let the user search/pick a location and confirm an area.
2. On confirm, fetch the imagery crop + real-world scale, bake it as a texture on a ground-plane, and hand off to the existing three.js viewport.
3. All room/wall/opening drawing happens in the viewport you already have, against a `Site` node (anchor lat/lon, rotation-to-true-north, meters-per-pixel) living in the same graph/parameter store as everything else.

MapLibre's job ends at handoff. It never becomes the drawing surface.

### 1.4 Geo math: local tangent plane, not full GIS
At building-site scale (tens to hundreds of meters), a full geodetic stack (UTM zones, Web Mercator distortion correction) is overkill. A **local ENU (East-North-Up) tangent plane** anchored at the site's lat0/lon0 is accurate to roughly 10–100km and reduces to plain 2D meters: x = east, y = north, relative to the anchor. Store lat0/lon0/rotation once on the `Site` node; every other node stays in ordinary Cartesian meters.

### 1.5 Rooms are the atomic primitive; walls and adjacency are derived
`Room` = `{width, depth, rotation, x, y}`, registered in the same unified parameter namespace already built for sliders/expressions — so a human dragging a corner handle and the AI setting a param are editing the *same* value, not two systems. Adjacency is **read back from geometry** (edges that touch/overlap within tolerance), never hand-authored as a separate graph that can drift from what's drawn. Walls are **generated**, never hand-placed: every room-boundary edge becomes a wall segment; edges shared by two rooms become one interior wall, unmatched edges become exterior wall — the same derive-don't-place-absolutely principle already decided for the rest of the engine.

## 2. Phased plan

### Phase 0 — Site Anchor & Imagery
**Goal:** ground every later phase in a real, georeferenced site.
- `Site` node: lat0, lon0, rotation-to-true-north, meters-per-pixel, cached image crop.
- MapLibre-based location search/confirm step → hand off anchor + image to the existing viewport (§1.3).
- ENU transform utility (§1.4) shared by every node that needs real-world coordinates.
- Check the Building Footprints dataset for a real outline before falling back to "trace the photo."

### Phase 1 — Rectangle Room Primitive
**Goal:** the smallest editable unit, human- and AI-drivable identically.
- `Room` node (§1.5) with drag-resize handles in the viewport.
- Program tag per room (bedroom/kitchen/bath/etc.) carried as metadata for later brief-matching and energy defaults.
- Adjacency computed from geometry, exposed as a percept (same pattern as the existing geometry report).

### Phase 2 — Walls from Rooms
**Goal:** never hand-place a wall.
- Wall generation from room-boundary edges (§1.5), thickness parameter (interior vs. exterior default).
- Feeds the same pre-evaluation validation gate pattern already used elsewhere (reject/repair on missing or degenerate boundaries).

### Phase 3 — Openings
**Goal:** doors/windows without index-based placement.
- Reuse the selection-by-query design already planned for sub-shape editing (e.g. "wall between kitchen and living, centered") instead of inventing a new placement scheme.

### Phase 4 — Energy/Performance Percepts
**Goal:** score, don't just render.
- Window-to-wall ratio per facade orientation; rough solar exposure per facade using the Phase 0 anchor's latitude + true-north rotation; simple daylighting/heating-load proxies.
- Only meaningful because Phase 0 grounded the model in real geography — this is the payoff for sequencing site-context first.
- Feeds the same repair/feedback loop as the existing geometry report, not a separate scoring system.

### Phase 5 — Siting Optimization
**Goal:** optimize placement, not just the building.
- Given a parcel + setback/zoning envelope, search building position/rotation/footprint against an objective built from Phase 4's scores plus setback/coverage constraints.
- Sequenced last deliberately — it optimizes against machinery (real anchor, real walls, real energy proxy) that doesn't exist before Phase 4.

## 3. Explicit non-goals (for now)

No hard-coded house templates/macros — rooms/walls/openings stay composable primitives, consistent with the existing "don't pre-seed the macro library" decision. No full BIM/IFC compliance, no structural engineering solver, no multi-story until Phase 2 is solid on one story, no photorealistic rendering. Each is a legitimate later phase, not a blocker to shipping Phase 0–1.

## 4. Sequencing dependency

This vertical assumes the kernel-health hardening in `docs/kernel_health_and_curve_bridge_plan.md` (Workstream A) has landed. Floor plans multiply wall/opening/room count per model well past current organic-shape benchmarks, and will hit any open silent-failure class first and hardest.

## 5. Open decisions for the user

- Imagery provider priority order (default proposed: NAIP → OpenAerialMap → Mapbox/MapTiler opt-in) — confirm or reorder.
- Confirm the single-viewport approach (§1.3) over a dedicated 2D map editor.
- Start now, or after the kernel-health workstream lands (§4)?

## References

- [ArchPulse — Best AI Floor Plan Generators 2026](https://www.archpulse.co/blog/ai-floor-plan-generator)
- [ResPlan dataset paper — floor-plan generation lineage (RPLAN, House-GAN++, Graph2Plan)](https://arxiv.org/html/2508.14006v1)
- [Generative Floor Plan Design with LLMs via RLVR](https://arxiv.org/pdf/2605.14117)
- [OpenAerialMap](https://openaerialmap.org/)
- [USGS NAIP overview](https://www.usgs.gov/centers/eros/science/usgs-eros-archive-aerial-photography-national-agriculture-imagery-program-naip)
- [Microsoft Global ML Building Footprints](https://github.com/microsoft/globalmlbuildingfootprints)
- [MapLibre GL JS](https://maplibre.org/maplibre-gl-js/docs/)
- [Local tangent plane / ENU coordinates](https://en.wikipedia.org/wiki/Local_tangent_plane_coordinates)
