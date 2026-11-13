# Level files

Level definitions are JSON files in `public/levels`. The game loads `first-level.json` by default. Add `?level=prototype`, `?level=alternate`, or `?level=ice-slide-practice` to the development URL to load a sandbox. The query value must match the file name and the level `id`.

Each level stores an `id`, a player `spawnPosition`, a `failureBoundaryY`, and an `objects` array. The boundary is a world-space Y value; falling below it respawns the player.

Every object has a stable, unique `id`, a `role`, a transform, a visual, and a collision definition. Positions use world coordinates in meters with Y up. Rotations are XYZW unit quaternions and may turn objects around Y.

- `ground` and `platform` objects use box collision and provide pogo landing surfaces.
- `goal` and `checkpoint` objects use `trigger-box` collision. These volumes do not block the player. Their position, rotation, scale, and collision dimensions define trigger behavior independently from rendering.
- Visuals currently use boxes. The material must match the object's role.
- Collision dimensions are multiplied by transform scale. For trigger objects this defines the gameplay volume; for surfaces it defines landing collision separately from the visual box.
- A checkpoint's transform position is its respawn position. A level can contain one goal and any number of checkpoints.

The development editor can add, move, resize, duplicate, delete, save, and reload platforms and checkpoints. It can add a goal and edit the failure boundary. Select a trigger to inspect its position and volume size. Trigger boxes are rendered in both editor and play modes.
