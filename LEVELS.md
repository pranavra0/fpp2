# Author a level in Blender

Install `tools/blender/fpp2.py` as an add-on from Blender Preferences and enable **FPP2 level publisher**. Run `bun dev` and keep the game open in the browser. In the 3D Viewport's **FPP2** panel, leave **Publish on Save** enabled and set the local publish URL if Vite uses a different port. Saving a `.blend` file validates and publishes its level and content-addressed GLBs. Blender reports the latest publish result in the panel; **Publish Level** starts at the authored spawn. **Test from Selected Platform** starts from the selected platform or its visual child and retains that test start on subsequent saves.

Use Blender world units as meters. Blender X maps to game X, Blender Z maps to game Y, and negative Blender Y maps to game Z. Set the scene custom properties `fpp2_level` (stable level ID) and `fpp2_failure_y` (optional failure boundary). Create exactly one mesh with `fpp2_role = ground`, solid meshes with `fpp2_role = platform`, and trigger meshes with `fpp2_role = goal` or `checkpoint`. Add exactly one Empty with `fpp2_role = spawn`.

Each gameplay mesh is also its explicit collision proxy, centered on its origin. Box proxies need exactly eight axis-aligned corners. For a ramp, set `fpp2_collision = slope`, `fpp2_dimensions` to `[width, height, depth]`, and `fpp2_rise` to a signed number; supported slope grade is at most `0.35`. Gameplay transforms can use Blender Z yaw and parent transforms, but must be upright and free of shear. Decorative mesh children marked `fpp2_visual_only` are exported with evaluated geometry, UVs, normals, material slots, and face material assignments. Set `fpp2_visual_only = true` on a proxy to also export its own mesh. Mark a standalone mesh `fpp2_scenery = true` to bake its full world transform into the asset.

Set platform behavior with custom properties: `fpp2_mode` (`solid` or `one-way`), `fpp2_crumble_delay`, and optional `fpp2_crumble_return_delay`. A moving platform can use child Empty waypoints (`fpp2_waypoint = true`, ordered by numeric `fpp2_order`) or a child POLY curve marked `fpp2_path = true`. Set `fpp2_motion_duration`, `fpp2_motion_phase`, and `fpp2_motion_mode` (`loop` or `ping-pong`). Set `fpp2_surface_profile` to `default`, `elastic`, `grip`, `ice`, or `directional`; properties named `fpp2_surface_<coefficient>` provide response overrides. Directional surfaces also read `fpp2_surface_direction` as a two-number game XZ vector. Unsupported collision shapes, off-center proxies, invalid properties, or tilted gameplay transforms fail publication without replacing the previous valid level.

Run the actual Blender exporter and gameplay integration check with `BLENDER_BIN=/path/to/blender bun test ./tests/blender-gameplay.node.ts`. It checks exported GLBs, native collision queries, pogo landings, platform motion and crumble, and trigger contacts.

The browser integration check needs a fresh development server and an installed Playwright Chromium. Run `PLAYWRIGHT_CORE_MODULE=/path/to/playwright-core/index.mjs FPP2_BROWSER_URL=http://127.0.0.1:5173 FPP2_OFFSCREEN_CAPTURE=1 node tests/blender.browser.mjs`. Set `BLENDER_BIN`, `CHROMIUM_BIN`, or `CHROMIUM_ARGS` (a JSON array) when needed. It performs two real Blender saves, verifies asset and collision changes without a document reload, and saves rendered camera frames in the system temporary directory. The test configures its texture targets before rendering; normal canvas presentation remains a separate GPU/browser check.

## Runtime level files

Level definitions are published as JSON in `public/levels`; Blender saves generate them together with GLBs in `public/models`. A fresh campaign loads `first-level.json`; saved progress resumes the last valid selection. Add `?level=prototype`, `?level=alternate`, or `?level=ice-slide-practice` to the development URL to load a sandbox. The query value must match the file name and the level `id`.

Each level stores an `id`, a player `spawnPosition`, a `failureBoundaryY`, and an `objects` array. The boundary is a world-space Y value; falling below it respawns the player.

Every object has a stable, unique `id`, a `role`, a transform, a visual, and a collision definition. Positions use world coordinates in meters with Y up. Rotations are XYZW unit quaternions and may turn objects around Y.

- `ground` uses box collision. Platforms support `box` collision and continuous `slope` collision. A slope adds a signed `rise` along local X before transform scale; its grade may not exceed 0.35. The landing query, body collision, and box visual use the same slope geometry.
- `goal` and `checkpoint` objects use `trigger-box` collision. These volumes do not block the player. Their position, rotation, scale, and collision dimensions define trigger behavior independently from rendering.
- Box visual materials match the object's role. All gameplay roles can also use `{"kind":"gltf","asset":"sample-platform"}` or a model filename from `public/models` without the `.glb` extension.
- Collision dimensions are multiplied by transform scale. For trigger objects this defines the gameplay volume; for surfaces it defines landing collision separately from the visual box.
- A checkpoint's transform position is its respawn position. Put it above a permanent stationary default or grip platform with body and pole clearance. Sandboxes may omit the goal; campaign levels require exactly one.

The development editor can make quick adjustments to platforms and triggers during playtesting. It can add, move, resize, duplicate, delete, save, and reload platforms and checkpoints, add a goal, and edit the failure boundary. Select a trigger to inspect its position and volume size. Trigger boxes are rendered in both editor and play modes.

## Add a campaign level

1. Author the level geometry and gameplay objects in Blender. Save the scene with `fpp2_level` set to the stable level ID and test it in the browser.
2. Add an entry to `CAMPAIGN_STAGES` in `src/content/campaign.ts` at the desired position:

   ```ts
   { id: "my-level", title: "My level", enabledControls: ["steering", "charge", "pole-length"] },
   ```

3. Keep previously enabled controls available. Optional `introduces` and `practices` describe teaching; set `introduces` when adding a behavior not previously taught. `chapterId` is optional. None of these fields contains geometry or instructions.
4. Include ordered `sections` in the JSON. The first has `checkpointId: null`; later sections reference distinct checkpoint object IDs. Instructions belong here:

   ```json
   "sections": [
     { "id": "start", "checkpointId": null, "instruction": "Reach the checkpoint." },
     { "id": "finish", "checkpointId": "checkpoint-1", "instruction": "Reach the goal." }
   ]
   ```

5. Run `bun test ./tests/campaign.test.ts`, then open `?level=my-level&editor=1` to iterate. Development URLs can open locked levels without completing earlier ones. Files outside the manifest remain sandboxes with all controls available.

The editor's ordered sections field edits the same JSON data and participates in undo/redo and save/reload. Moving or deleting a checkpoint must leave valid section references; deleting it removes its section. Revisiting earlier checkpoints does not move restart progress backward. `R` restarts at the active checkpoint; `Shift+R` restarts the level. Each restart restores all platform motion phases and crumble availability.

## Platform behavior

Platform `motion`, `crumble`, `surface`, and collision `mode` are independent optional properties. Motion paths contain world-space offsets, start at `[0,0,0]`, and use distance-based traversal. `duration` is the one-way traversal time for `ping-pong`, or a full cycle for `loop`; `phase` is a fraction of the complete cycle. Compiled paths and runtime timers are never serialized.

```json
"motion": { "path": [[0,0,0], [2,0,0]], "duration": 5, "phase": 0, "mode": "ping-pong" },
"crumble": { "delay": 1.2, "returnDelay": 3 },
"surface": { "profile": "ice" }
```

`collision.mode: "one-way"` allows ascent through a platform and landing from above. Crumble countdowns begin on confirmed pogo contact. Returning platforms stay absent while their return volume is occupied. Paths and one-way edges have simple line indicators; the HUD shows the supported temporary platform's countdown.

Save/load uses the existing development endpoint with a 256 KB level limit. Use stable level and object IDs: campaign completion is stored by level ID, while checkpoints remain local to the current run. Adding a level does not require changes to the progress parser, selector, or level endpoint.
