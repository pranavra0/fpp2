# FPP2

## Product and art direction

- Use plain technical wording in code, comments, logs, and replies.
- Preserve the low-fidelity 2.5D papercraft and pixel-art identity. Prioritize composition, silhouettes, color relationships, coherent shading, and gameplay readability over detail or effects.
- Refine one representative level before extending a visual treatment to other levels. Compare actual before and after frames; do not claim visual quality without inspecting the rendered game.
- Keep development UI simple and functional. Do not expand the browser editor into a second content creation application.
- Blender is the source of truth for new level authoring. Use native modeling, materials, hierarchy, and custom properties. Saving should publish a validated level and assets to the running game without manual export, JSON edits, or a page refresh.
- Keep visual meshes and explicit collision geometry distinct but derived from the same authored placement. Reject unsupported collision shapes instead of silently approximating them.
- Preserve existing pogo physics and gameplay unless a requested feature requires a verified change.

## Engineering

- Use TypeScript, plain typed objects, and free functions for simulation. No classes, inheritance, getters/setters, dependency injection, or event systems in simulation.
- Simulation must not import Shallot, rendering, input devices, camera, or UI. Keep collision queries and level geometry in engine integration; keep movement and contact response pure.
- Follow ECS responsibilities: components hold entity state, systems perform updates, and world resources own shared assets and authoring state. Avoid duplicated authoritative state.
- Separate content validation, import/publication, rendering, and gameplay. Prefer small cohesive modules over monoliths or generic frameworks.
- Make ownership explicit. Dispose old level resources on replacement; inspect the installed engine's lifetime contracts before assuming assets can be individually released.
- Publish assets before the level manifest. Reject invalid publications without replacing the last valid level. Version assets by content so geometry, materials, and collision update together.
- Comments explain why. Do not add TODO comments or hide invalid state through clamping. Assert invariants.
- Keep tests for algorithmic logic, boundary IO, and integration flows. Do not add tests that mirror incidental implementation details.
- Do only the requested work. Do not add unrelated levels, features, configuration, or documentation.

## Shallot and verification

- Inspect the entry point, plugins, and existing checks first. Learn APIs from the installed package rather than memory.
- `bunx shallot create --help` lists installed examples in `node_modules/@dylanebert/shallot/examples/`. Read the nearest example, its checks, and the relevant JSDoc in `node_modules/@dylanebert/shallot/src/`.
- Do not infer arbitrary collision support from GLB rendering support. FPP2's pogo contact queries have their own geometry contract.
- During iteration run the focused check that answers the change: `bun test ./<file>` or the relevant browser check.
- Verify Blender integration with an actual Blender export, native collision queries, simulated landings, and a running browser receiving successive saves. Check coordinate conversion, modified materials and geometry, deleted objects, failed updates, and selected-platform starts.
- Inspect actual browser frames for rendering changes. Report GPU or browser limitations explicitly; parsing or compilation is not visual verification.
- Before finishing, run `bun check` and `bun test` once. Run relevant `tests/*.node.ts` integration checks by explicit path; they are not included by plain `bun test`.
- Consult `docs/` if present for personal project notes. It is gitignored and may be absent.
