# Level files

Level definitions are JSON files in `public/levels`. The game loads `prototype.json` by default. Add `?level=alternate` to the development URL to load `alternate.json`; the query value must match both the file name and the level `id`.

## Format version 1

- `formatVersion` is `1`.
- `id` is a lowercase letter or number followed by lowercase letters, numbers, or hyphens.
- `spawnPosition` is the player's body center in world coordinates.
- `objects` contains exactly one object with role `ground`. Other level objects use role `platform`. Every object has a stable, unique `id`.
- `transform.position` is the object's center in world coordinates. One world unit is one meter, and Y is up.
- `transform.rotation` is an XYZW unit quaternion. Landing surfaces can rotate around Y; X and Z rotation are rejected because this version models horizontal surfaces.
- `transform.scale` scales the unit box used by the visual representation. Values must be positive.
- `visual` selects a box and a material identifier (`ground` or `platform`).
- `collision` selects a box with local dimensions. Its dimensions are multiplied by the object's transform scale, so `[1, 1, 1]` matches the visual box and other values change collision independently.
- A surface's top elevation is its center Y plus half its scaled collision height.

To add a platform, copy an object from `prototype.json`, give it a new `id`, set its role to `platform`, and edit its transform, visual material, and collision dimensions. Rendering and collision entities are built from the same object definition.

Format version 1 supports box visuals and box collision. A future visual asset reference can be added as another `visual` variant while keeping the object's role, transform, and collision data independent.
