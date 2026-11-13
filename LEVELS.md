# Level files

Level definitions are JSON files in `public/levels`. A fresh campaign loads `first-level.json`; saved progress resumes the last valid selection. Add `?level=prototype`, `?level=alternate`, or `?level=ice-slide-practice` to the development URL to load a sandbox. The query value must match the file name and the level `id`.

Each level stores an `id`, a player `spawnPosition`, a `failureBoundaryY`, and an `objects` array. The boundary is a world-space Y value; falling below it respawns the player.

Every object has a stable, unique `id`, a `role`, a transform, a visual, and a collision definition. Positions use world coordinates in meters with Y up. Rotations are XYZW unit quaternions and may turn objects around Y.

- `ground` uses box collision. Platforms support `box` collision and continuous `slope` collision. A slope adds a signed `rise` along local X before transform scale; its grade may not exceed 0.35. The landing query, body collision, and box visual use the same slope geometry.
- `goal` and `checkpoint` objects use `trigger-box` collision. These volumes do not block the player. Their position, rotation, scale, and collision dimensions define trigger behavior independently from rendering.
- Box visual materials match the object's role. Platforms can also use `{"kind":"gltf","asset":"sample-platform"}` or a model filename from `public/models` without the `.glb` extension.
- Collision dimensions are multiplied by transform scale. For trigger objects this defines the gameplay volume; for surfaces it defines landing collision separately from the visual box.
- A checkpoint's transform position is its respawn position. Put it above a permanent stationary default or grip platform with body and pole clearance. Sandboxes may omit the goal; campaign levels require exactly one.

The development editor can add, move, resize, duplicate, delete, save, and reload platforms and checkpoints. It can add a goal and edit the failure boundary. Select a trigger to inspect its position and volume size. Trigger boxes are rendered in both editor and play modes.

## Add a campaign level

1. Copy a small existing level, or create one in the development editor. Save it as `public/levels/<id>.json` with the same embedded `id`.
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
