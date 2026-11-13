# Phase 4: Blender to glTF assets

## Goal

Add one static, textured model authored in Blender and exported as glTF 2.0. Load it with Shallot, reuse its loaded mesh and material for repeated placements, and make it editable in the existing level editor. Keep the rendered model separate from the box collision used by gameplay. Also replace point-based checkpoint and goal checks with a swept player capsule against the existing trigger boxes, keeping trigger geometry outside the pure simulation.

## Existing project constraints

- Levels are strict JSON parsed by `src/content/level.ts` and stored in `public/levels`.
- `src/game/physics.ts` creates box landing surfaces and level entities. `src/game/level-rendering.ts` currently attaches box rendering to those same entities.
- Checkpoint and goal gameplay volumes are level-data `trigger-box` objects. Current gameplay checks the player's center path; this phase will replace that point check with a player-shape sweep while keeping trigger geometry in level data.
- The development editor in `src/game/editor.ts` uses stable level object IDs for selection, move, resize, duplicate, delete, undo, save, and reload. The Vite endpoint in `vite.config.ts` saves level JSON only.
- Shallot is pinned to 0.10.3. `@dylanebert/shallot/gltf` exports `loadGltfScene` and `spawnGltfScene`; the installed implementation reads `.gltf` and `.glb`, registers standard glTF materials and images, and spawns one entity per primitive. Its transforms have no hierarchy. `GltfPlugin` is required when an asset uses skinning or morph targets; this phase excludes both.
- The nearest package example is `node_modules/@dylanebert/shallot/examples/gltf`. Its `src/app.ts` and `tests/placement.node.ts` show loading and spawning a model. Follow the installed package API rather than adding a second loader.

## Phase 4 scope

### First asset

- Keep the editable Blender file at `assets/sample-platform.blend` and the runtime export at `public/models/sample-platform.glb`.
- Export one static mesh with one primitive and one glTF material. Use a UV0 base-color texture embedded in the GLB and standard glTF metallic/roughness values.
- Use metric units with one Blender unit per project meter. Apply object rotation and scale. Keep the exported scene root transform at identity and center the mesh around its origin with bounds near one meter per axis. This keeps the existing editor transform fields useful and lets one spawned visual entity follow the level transform directly.
- Use Blender's glTF 2.0 Binary export for the checked-in runtime asset. Shallot also reads `.gltf`; a later asset may use it with its referenced buffers and images kept at their served relative paths.
- Limit this first asset to a static mesh: no animation, skinning, morph targets, cameras, lights, custom shader nodes, or required glTF extensions. Use only material and texture features supported by the installed Shallot loader.

### Level data

Add a model visual variant while preserving the existing box variant and its JSON format:

```json
{
  "id": "platform-2",
  "role": "platform",
  "transform": {
    "position": [2, 1, 0],
    "rotation": [0, 0, 0, 1],
    "scale": [3, 0.4, 3]
  },
  "visual": { "kind": "gltf", "asset": "sample-platform" },
  "collision": { "kind": "box", "dimensions": [1, 1, 1] }
}
```

- The level stores a stable asset ID, not an arbitrary URL. Resolve `sample-platform` through one small static asset-to-URL map pointing at `/models/sample-platform.glb`.
- Initially allow this model visual on `platform` objects only. Keep ground and trigger visuals as their existing boxes. This avoids changing checkpoint material behavior or gameplay roles in this phase.
- Keep `transform` as the shared authored placement. The model's local mesh is visual-only; `collision.kind` and `collision.dimensions` continue to define the gameplay surface independently. Do not generate collision from mesh triangles or infer collision size from imported bounds.
- Keep old level files valid without a migration. Extend strict parsing to accept only the new `visual` keys and known asset ID. Reject unsupported role/visual combinations and unknown IDs with a path-specific error.

### Player trigger contacts

- Keep checkpoint and goal trigger boxes defined by their existing level-data transforms and collision dimensions. Their gameplay volumes must not depend on the rendered box or an imported model.
- Define a dedicated upright capsule for player-to-trigger contact, initially 0.65 m in diameter and 0.82 m in total height to match the nominal body size. Keep these dimensions in gameplay configuration, independent of render scale, squash/stretch animation, and pole length.
- Sweep the capsule from its previous to current position for every simulation substep against the oriented trigger boxes. Run this geometry query in game integration, outside `src/sim.ts`; pass plain typed contact results to gameplay progression. Do not add movement, trigger geometry, or engine dependencies to the pure simulation.
- Treat contact with the capsule as trigger contact, including a tangent touch. Do not add an implicit tolerance or enlarge every trigger. If a later design needs extra forgiveness, represent it explicitly in level data.
- Activate checkpoints on an outside-to-inside transition, once per entry. Complete the level when the capsule enters the goal. Initialize overlap state from the capsule's actual position on spawn, restart, and respawn so starting inside a trigger does not create a false entry.
- Keep editor trigger selection on its current level-data box intersection. It is separate from player gameplay contact.

### Asset loading and reuse

- Load the model through `loadGltfScene(world, url)` and create placements with `spawnGltfScene(world, handle, placement)`.
- Keep the returned `Gltf` handle in a per-world map keyed by the static asset ID. Load the asset once before rendering a level that references it; in development, also load it before enabling the editor's Add model action. The editor can then keep its existing synchronous level synchronization path.
- Reuse that handle for every placement. Shallot's mesh, material, and image registrations belong to the world; spawned placements reuse the primitive's mesh and material handles. Do not reload or re-register the GLB for duplicates.
- Use the GLB's standard material and texture as authored. Do not add a material editor, texture importer, custom material registry, runtime upload flow, or asset build step.
- Report load failures with the asset ID and URL through the existing initialization error or editor status path. Do not silently replace a failed model with a box.

### Editor and ECS integration

- Add an `Add model` editor action that creates a normal platform object with `visual.kind = "gltf"`, asset `sample-platform`, and the existing box landing collision. Its default transform should match the current Add platform dimensions. Existing duplicate, move, resize, undo, save, and reload behavior must work for it.
- Keep one logical level object per stable ID, but track its rendering entity separately from its collision entity. A platform collision entity owns `Body`, `Shape`, and `LandingSurface`; its model visual entity owns `Transform`, `MeshInstance`, and `MeshMaterial`. Neither entity should carry the other side's components.
- Split the existing box visuals from their collision entities as part of this bookkeeping change so editor synchronization has one consistent model. Trigger volume data remains in the level definition; if a trigger volume is represented by an ECS entity, keep that entity separate from its render-only box.
- Update selection to resolve ray hits through the collision entity to the logical object ID, and attach the outline to the visual entity. Trigger selection continues to use its current level-data box intersection.
- On move or resize, update the visual transform and collision state from the same level object. For this asset, the identity root and one primitive make the visual transform equal to the authored placement; do not add a transform hierarchy or a general multi-primitive group system.
- Destroy all per-placement visual and collision entities when an object is removed. Keep the cached `Gltf` handle and its world-owned resources alive for reuse until world disposal.
- Preserve gameplay checkpoint highlighting by changing `setCheckpointMaterials` to address checkpoint visual entities after rendering and collision are split.
- Keep level save and reload on the existing JSON endpoint. Do not add an asset upload or filesystem-write endpoint.

## Implementation sequence

1. Create the Blender source and export the sample GLB using the constraints above. Confirm it loads in the installed Shallot glTF example or a focused project integration check.
2. Extend `src/content/level.ts` with the model visual type, asset ID validation, and backward-compatible parsing.
3. Add the static asset URL map and per-world loaded-handle cache. Load referenced assets before building level visuals and make the one editor asset available in development.
4. Refactor level rendering and physics bookkeeping so visual and collision entities are separate while retaining stable object IDs and current editor synchronization behavior.
5. Add the player capsule and per-substep swept trigger query in game integration. Pass contact transitions to gameplay progression and preserve checkpoint, goal, spawn, restart, and respawn behavior.
6. Add the editor action, preserve selection/outline and checkpoint rendering, and cover add, duplicate, transform, delete, save, and reload for a model platform.

## Acceptance criteria

- Existing level JSON files parse and render unchanged.
- A level can refer to `sample-platform` by ID, load the GLB, and render its base-color texture.
- Two placements use the same loaded model/material handle while retaining independent transforms.
- The editor can add, select, move, resize, duplicate, delete, save, and reload the model platform.
- Editing its visual transform updates its box landing surface from level data; collision never depends on imported triangles or material/texture data.
- The visual ECS entity has no collision components, and the collision ECS entity has no mesh-rendering components.
- Checkpoint activation still changes the checkpoint's rendered material. Editor trigger selection still uses level-data box intersection; gameplay checkpoint and goal contact use the player capsule sweep against the same level-data trigger boxes.
- A capsule that touches a trigger face, edge, or corner activates it, and a fast crossing between simulation samples is detected. Remaining inside does not reactivate a checkpoint; spawn, restart, and respawn correctly initialize overlap state.
- Invalid asset IDs and failed model loads produce useful errors. No runtime editor action writes model files.
- Focused integration coverage checks level and collision state, trigger grazes and fast crossings, and checkpoint overlap transitions. Development-browser verification exercises authoring and persistence. Finish implementation with `bun check` and `bun test`; if the available GPU blocks visual scene verification, report that limitation.

## Out of scope

No asset browser, drag-and-drop import, model upload endpoint, build-time Blender conversion, generated manifest, arbitrary URL loading, automatic mesh collision, model collision editor, trigger collider editor, pole-to-trigger contact, multiple model catalog entries, multi-primitive transform groups, animation, skinning, morph targets, or material/texture editing.
