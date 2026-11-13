# Phase 5: Visual design and rendering

## 1. Status, purpose, and delivery boundaries

This is a forward-looking design specification. It establishes the visual direction and the contracts that future rendering and asset work should follow. Environment kits, finished character illustrations, animation sets, and asset-authoring tools remain later production work, scheduled separately from this planning task.

FPP2 will use a three-dimensional world built from thick paper and folded card, with a flat illustrated player and a solid pogo pole. Lighting will communicate the thickness and separation of the environment. Temporary ink impressions will connect the visual treatment to pogo contacts.

Preserve free movement through the existing three-dimensional levels. The paper treatment is a presentation choice. It does not convert the game to a side-scrolling plane, introduce depth lanes, or change movement, collision, checkpoint, goal, or respawn behavior.

The direction must work while most of the game remains under development. Existing box platforms, a temporary flat player shape, and a few shared materials must be sufficient to evaluate it. Finished assets are a later dependency of asset production, not a prerequisite for further gameplay development.

Separate delivery into these stages:

| Stage | Work | Required asset work |
| --- | --- | --- |
| A: Lighting and material baseline | Explicit lighting, shadows, exposure, palette, material reuse, and comparison captures on existing levels | None; use existing geometry |
| B: Character presentation | Flat player representation, solid pole, camera-facing orientation, existing pose feedback, and occlusion checks | Temporary quad or simple cutout only |
| C: Contact impressions | Bounded transient ink marks driven by accepted contacts | Procedural stamp or one shared mask |
| D: Future asset integration | Authored paper platform kit, background pieces, illustrated character, and directional art if needed | Scheduled separately when asset work becomes useful |

Stages can be scheduled separately when the game needs them, respecting their presentation dependencies. Completing A does not require starting D. Do not build unused asset abstractions or editor features in anticipation of D.

## 2. References and what to take from them

- [Paper Mario: The Origami King](https://www.nintendo.com/en-gb/Games/Nintendo-Switch-games/Paper-Mario-The-Origami-King-1782440.html): visible paper edges, folded forms, overlapping sheets, and shadows that make a constructed environment readable. Use these construction principles. Character designs, scenery, textures, and interface artwork must be original.
- [Tinykin](https://store.steampowered.com/app/1599020/Tinykin/): flat illustrated characters occupying a lit three-dimensional space. Use the clear separation between the character illustration and the shaded environment. Its scene density is not an asset target for FPP2.
- [Sable](https://store.steampowered.com/app/757310/Sable/): a secondary reference for restrained palettes and large readable light/shadow regions. Full-scene outlines and stepped shading are optional later experiments, not baseline requirements.
- [Papetura](https://store.steampowered.com/app/593640/Papetura/): a secondary reference for texture, warm illumination, and depth between paper layers. Its handmade detail and apparent light transmission are outside the baseline rendering scope.

These are visual references, not descriptions of those games' internal rendering implementations. The proposed implementation below is specific to FPP2 and the installed Shallot package.

## 3. Visual direction

### 3.1 Shape construction

Use broad planar faces, visible sheet thickness, occasional folds, and overlapping layers. A structure should suggest how it was assembled from a few paper or card pieces. Avoid adding small folds, seams, or surface detail that cannot be read from the gameplay camera.

Playable platforms are solid objects with flat tops and visible side faces. Their top plane and usable footprint must agree with collision. Cutout scenery can surround them, but a landing surface must not appear to be an unsupported, ambiguous image floating in space.

Use these construction rules consistently:

- Paperboard slabs provide landing surfaces and major structural masses.
- Folded strips or simple solid supports explain larger elevated structures.
- Layered edges communicate thickness without requiring many independent meshes.
- Decorative cutouts provide silhouettes for background and side scenery.
- Small irregularities belong on decorative edges and undersides. Keep the playable perimeter unambiguous.

A box with a clear top, a contrasting cut edge, and an appropriate cast shadow is a valid development representation of the style. Do not add high polygon counts just to make development geometry look finished.

### 3.2 Composition and detail hierarchy

The player, pole, immediate landing surfaces, landing prediction, and gameplay markers have the highest visual priority. Decoration supports those elements.

Use low-frequency color regions on playable surfaces. Put most drawn detail on side faces, background pieces, or areas outside the landing footprint. Keep the region immediately around a platform edge free of strong decorative lines that could be mistaken for the actual edge.

Foreground scenery must not routinely cover the player, the pole tip, or the next landing surface. Background pieces should have lower contrast and less detail than the playable route. Establish depth with geometry, overlap, value, and color before adding atmosphere effects.

### 3.3 Initial palette

Use a compact palette with warm paper neutrals, cool shaded regions, and a limited number of saturated inks. These colors are starting references in sRGB, not approved final swatches or linear shader values:

| Use | Starting sRGB color | Requirement |
| --- | --- | --- |
| Light paper and platform tops | `#E8DFC9` | Retain visible shape and texture in direct light |
| Cut edges and structural sides | `#A9947D` | Separate tops from sides without a black border on every edge |
| Secondary colored card | `#667C91` | Support the route without matching the player accent |
| Background | `#C7D1DE` | Keep distant structures subordinate to the route |
| Main player accent | `#D56A45` | Remain distinct from the immediate environment |
| Drawn outlines and dark details | `#303247` | Use selectively within artwork |

Gameplay signal colors remain semantic. Do not change checkpoint, goal, and landing-prediction colors merely to fit these provisional swatches. Review those colors together with shapes and state changes before any deliberate remapping.

Validate the result in grayscale and with the character against both light and dark surfaces. Color alone must not identify a safe landing, an active checkpoint, or a goal.

## 4. Current integration baseline

At the time of writing:

- `src/game.ts` composes the game with `StandardRenderingPlugin` and the existing gameplay, simulation, and camera systems.
- `src/game/scene.ts` initializes the camera, one directional light, global ambient lighting, shared role materials, the player boxes, and prediction markers.
- `src/game/presentation.ts` owns impact feedback, squash/stretch, player/pole transforms, and landing-prediction presentation.
- `src/game/camera.ts` supplies following, orbit placement, and FOV presentation. The configured base FOV is 52 degrees; default pitch is 20 degrees.
- `src/game/level-rendering.ts` contains a per-world glTF cache, a static asset URL map, and placement rendering. The current sample asset has deliberately narrow static-asset validation.
- Level objects retain stable IDs. Current level bookkeeping separates visual and collision entities.
- Level JSON is strictly parsed. Only supported keys and visual/role combinations are accepted.

Concurrent work may change these details before implementation. Reconcile against the current code when each stage starts. This spec does not revise the Phase 4 asset-import task or require waiting for its final form.

Existing level files and existing asset references must continue to work. Initial lighting and character changes must not require a level migration.

## 5. Rendering architecture

### 5.1 Renderer and entity ownership

Keep Shallot's standard renderer and its existing mesh/material pipeline. Use its opaque, alpha-mask, shadow, and presentation paths. Do not introduce a second renderer, an independent scene graph, or a custom full-screen presentation pipeline for the baseline style.

Use normal ECS ownership:

- Collision entities own collision components and authored collision transforms.
- Environment visual entities own rendering components and visual transforms.
- The player cutout, pole, and tip are separate presentation entities derived from simulation state.
- Ink impressions are transient presentation state with explicit surface ownership.
- Decorative scenery owns no gameplay collision unless separately authored as a gameplay object.

Keep state in plain typed resources or components. Implement behavior with free functions and scheduled systems. Do not introduce application classes, an event bus, or dependency injection.

`src/sim.ts` must remain independent of rendering, images, camera orientation, material IDs, and level geometry. Effects may consume plain simulation results and integration-owned contact metadata. They must never affect an accepted contact or alter the next simulation step.

### 5.2 Presentation order

Preserve this dependency order, using the installed engine's actual system groups and ordering contracts:

1. Advance simulation and perform integration-owned collision queries.
2. Record accepted contact transitions and update transient presentation state.
3. Derive the camera's presented transform, including existing follow behavior.
4. Derive the character's camera-facing orientation and pose from that same camera transform.
5. Publish final visual transforms and material parameters before the engine consumes them for culling, depth, shadow, and color rendering.
6. Run the standard renderer and camera presentation.

Do not rely on function names to imply ordering. Check the relevant transform propagation and view-preparation systems before installing a new system. The cutout must not use the previous frame's camera while the rest of the scene uses the current frame.

Where the existing presentation does not interpolate player poses, this design does not require a simulation rewrite. If interpolation is introduced, cutout position, pole geometry, contact attachment, and camera-facing orientation must use a consistent presented pose. Never interpolate a teleport across the level.

### 5.3 Depth, alpha, and occlusion

Use opaque rendering for solid environment pieces. Use alpha masking for illustrated silhouettes and holes in cutout scenery. Start with a mask threshold of 0.5 and tune only against actual edge quality and mip behavior.

Masked cutouts must write depth at retained pixels. Transparent image margins must neither hide geometry nor cast rectangular shadows. Test this with objects behind both the opaque and transparent portions of an image.

The player participates in normal scene depth. It must not render through a platform or wall. Avoid an always-visible overlay copy of the player. Solve frequent occlusion through camera placement and environment composition first.

Reserve alpha blending for effects that actually fade, such as a short-lived stamp overlay. Do not use blending for every paper asset. Large intersecting blended cards create sorting and overdraw problems.

Backface visibility is explicit. A paper prop seen from both sides needs two-sided rendering or authored reverse faces. For standard materials, the `doubleSided` shading parameter and the material row's culling option are separate settings; setting only one is insufficient.

### 5.4 Anti-aliasing and presentation

Start with the standard renderer's existing resolution and anti-aliasing behavior. Do not add forced low-resolution rendering, pixelation, chromatic aberration, lens distortion, camera blur, or a heavy vignette.

Masked silhouettes and thin pole geometry must remain stable at ordinary gameplay scale. Address image padding, mipmaps, silhouette thickness, and camera framing before adding another post-processing pass.

## 6. Lighting system

### 6.1 Baseline configuration

Use one shadow-casting directional key light and one global ambient source. Begin with these values, then tune them together using a neutral platform and the player cutout:

| Setting | Initial value or rule |
| --- | --- |
| Key color | Warm near-white, starting at `0xfff0dc` |
| Key illuminance | 5,000 lux |
| Key direction | Begin with the existing scene light orientation; light travels along its transformed local negative Z |
| Ambient color | Cool blue-lavender, starting at `0xb7bfdc` |
| Ambient brightness | 300 cd/m² |
| Camera exposure | Explicit EV100 of 9.7 |
| Color-grading exposure offset | Zero initially |
| Tonemapping | Explicit `TonemappingMethod.KhronosPbrNeutral` |
| Environment metallic | Zero |
| Environment perceptual roughness | 0.9 initially |
| Environment emissive | Zero except deliberately approved gameplay indicators |

These are calibration values, not measured performance or a guarantee of the final appearance. Keep physical light units and camera exposure distinct. Avoid adjusting key intensity, ambient intensity, camera exposure, and grading exposure simultaneously while judging a change.

Use the main light to distinguish horizontal tops, vertical faces, folds, and overlaps. Keep it fixed in world space. Camera orbit must not rotate the light around the player.

Ambient light must preserve visibility under platforms and within folds. It is a uniform fill source, not simulated bounced light. The shaded color results from surface color, ambient illumination, remaining direct light, and presentation. There is no separate baseline shadow-color property.

The paper effect must remain readable on a neutral material. Do not compensate for unclear shape solely by increasing saturation or painting strong fake shadows into every texture.

### 6.2 Shadows

Enable the key light's `shadowMapsEnabled`. The installed engine supports one active directional shadow caster; additional directionals can illuminate without independently casting directional shadows.

Start with a 1,024-pixel directional tile and two cascades. Set shadow distance to cover the active route visible from the normal gameplay camera, initially around 70 meters. Keep the camera far distance independent from this setting. Inspect the far cascade transition and increase resolution or coverage only when a capture identifies a useful improvement.

Begin with the default Gaussian shadow filter. `Hardware2x2` is an available cheaper comparison. These are filtering choices; they do not provide physically variable area-light penumbrae. Do not specify an unsupported area-light softness control.

Tune depth bias and normal bias against actual scene scale. Check thin card edges, the underside of platforms, and contact between adjacent pieces. A visible gap caused by excessive bias must not be disguised as paper thickness.

Environment slabs, structural supports, and substantial folded props cast shadows. Tiny decorative fragments may opt out with `NotShadowCaster`. Large background pieces should not create unexplained moving shadows on the route.

The flat player body will initially use `NotShadowCaster`. A camera-facing quad is a poor physical proxy for the character, and shader billboards can be reoriented for shadow views. The solid pole and tip can cast ordinary shadows. Do not add a second character shadow proxy until a captured sequence demonstrates that one is needed.

If a player shadow proxy is added later, keep it attached to the presented player pose, exclude it from the main view using a supported engine mechanism verified at that time, and test every relevant light/view mask. Do not invent a shadow-only component or camera layer convention without checking the installed implementation.

### 6.3 Ambient occlusion

Ambient occlusion is optional enhancement work after the key light and cast shadows are established. Use `ScreenSpaceAmbientOcclusionPlugin` with its camera component when enabled.

Compare it at Low quality first, with a small world-space radius suited to card overlaps. Start near 0.2 meters; tune thickness using the actual geometry. If this makes the scene dirty, creates halos, or darkens every platform rim, reduce its influence or remove the effect.

The baseline must remain readable with AO disabled. AO must not become a black outline around every cutout. In particular, check whether the player's depth contribution creates an undesirable halo on nearby platforms. Do not assume that an unlit material automatically removes its geometry from the depth prepass used by AO.

### 6.4 Local lights

Point and spot lights are available for future authored scenes with a specific local light source. They are not required by the paper direction.

When introduced, begin with an unshadowed light and add local shadows only if their contribution is useful. Keep ranges bounded. A glowing checkpoint texture does not automatically create a scene light; emissive appearance and illumination are separate decisions.

Do not add lights per platform, per ink mark, or per decorative cutout. No day/night cycle, moving sun, flickering ambient light, or automatic exposure is required.

### 6.5 Color and tonemapping

Set the tonemapping operator explicitly so the appearance does not depend on an implicit package default. Start with PBR Neutral and identity grading. Other operators can be evaluated in comparison captures, but changing operators changes the palette and requires rechecking the character and signals.

Unlit surfaces still pass through camera presentation. They do not necessarily match the original image's display RGB after grading and tonemapping. Judge an illustrated player inside the actual scene, with the intended operator and exposure fixed.

Keep palette swatches in a documented color convention. Lighting hex colors and source color images are sRGB; `StandardMaterial` numeric color vectors and per-instance `BaseColor` values are linear. Convert authored colors exactly once. Data textures such as normal or roughness maps are not color images.

### 6.6 Atmosphere

Use a clear background color and simple distant paper silhouettes first. A procedural `SkyPlugin` background may replace the clear color later if its gradient helps composition. Its horizon haze affects the sky background and must not be described as geometry fog.

The installed `FogPlugin` is volumetric. Low density does not imply a cheap pass. Leave it disabled for the baseline. Bloom, light shafts, clouds, particles, depth of field, and simulated paper transmission are also deferred.

## 7. Materials and surface treatment

### 7.1 Shared material families

Create a small shared material set for these roles:

- Lit paperboard for platform tops and neutral structures.
- Lit cut-edge or folded-card surfaces with slightly darker colors.
- Lit colored card for secondary structures and scenery.
- Unlit illustrated cutout material for the player.
- Gameplay indicator materials for checkpoint, goal, and landing prediction states.
- A shared ink treatment when Stage C is implemented.

These roles need not each become a separate custom shader. Use `StandardMaterial` wherever possible. Cache registered materials per world and reuse handles. Use supported per-instance color data where variation is needed without unique materials.

Begin untextured. Later paper grain should be low contrast, have a consistent world scale, and remain subordinate to silhouette and lighting. Avoid high-frequency fibers that shimmer, thick normal maps, shiny clear coats, metallic response, or baked highlights.

Treat artwork outlines as part of selected illustrations. A full-scene outline pass is not required. Keep the existing development selection outline independent from any future artistic outline treatment.

### 7.2 Texture and UV rules

Color textures provide paper color, drawn lines, and limited grain. They should not contain large baked directional shadows that conflict with the runtime light. Small authored crease accents are acceptable when they explain construction and remain plausible under the supported light direction.

Reuse a small palette or material atlas where useful. Reserve sufficient padding between regions and around alpha silhouettes to survive minification. Extend the visible edge color into transparent padding so filtered borders do not produce dark or white fringes.

Texture density should be consistent within a material family. Nonuniform scaling must not stretch drawn lines, paper grain, or cut-edge thickness into visibly different styles. Standard-size pieces or deliberately tiled texture regions are preferable for future authored assets.

The baseline does not require normal, metallic/roughness, AO, or emissive texture sets for every object. Add a map only when it makes a visible improvement at gameplay distance.

### 7.3 Future material extensions

A controlled lighting ramp, paper-specific tint, or procedural ink response can use `extendedMaterial` and the installed material APIs. Register a stable material type once per world initialization. Vary parameters and instance data, not generated shader source per object.

The installed materials example quantizes final lit RGB. It is evidence that material extension is supported, not an exact implementation of a chosen two-color lighting ramp. Retain standard depth and shadow behavior when extending the standard material, and test any changed coverage in both passes.

Do not globally replace imported glTF materials with a paper shader. Future catalog entries should explicitly opt into a material family, preserving the original imported asset and other placements' shared handles.

## 8. Character representation

### 8.1 Model structure

The planned character model is a flat illustrated body paired with a narrow solid pole and tip. The body starts as one textured quad. It does not require a skinned three-dimensional character, a skeleton, cloth, facial rigs, or mesh deformation.

Use a temporary flat silhouette while the character design is unresolved. It can use the current player color and proportions. Do not commission or generate finished character artwork as a prerequisite for Stage B.

Keep the current nominal body dimensions, approximately 0.65 meters wide and 0.82 meters high, as the initial visible reference. Gameplay contact dimensions remain separately configured and unchanged. Decorative protrusions and transparent margins do not enlarge the player capsule.

The simulation body position remains the presentation root. Center the body artwork's nominal body region on that root. The pole's upper endpoint remains derived from the simulation body position, as it is now; artwork must include an intentional overlap around that attachment so there is no visual gap.

Compute body, pole, and tip world transforms explicitly from the presented simulation pose. No new hierarchy is necessary. Resizing or squashing the illustration must not move the simulated pole endpoint, contact tip, or trigger capsule.

### 8.2 Camera-facing orientation

Use an explicitly oriented quad for the player. It faces the current gameplay camera, then receives a small in-plane roll derived from the pole's lean projected onto the camera's horizontal axis. This keeps its silhouette visible while preserving useful pose feedback.

One suitable implementation uses an unlit standard-material quad with an explicit `Transform`. If `SpritePlugin` is selected instead, use `Billboard.World` and supply the full orientation explicitly.

`Billboard.Screen` substitutes camera right/up for entity rotation; `Billboard.YLocked` also replaces the authored facing. Applying the current body rotation to either mode will not preserve the desired lean. Do not use those modes and assume they retain roll.

Use the actual presented camera axes, including its pitch, to construct the facing basis. Keep it orthonormal and finite. Assert valid inputs; do not hide an invalid quaternion or zero-length basis by substituting arbitrary state.

The illustrated body does not reproduce the full three-dimensional pole lean. The pole remains the authoritative visual cue for that direction. Keep body roll smaller than the pole's projected lean and avoid near-horizontal body poses that make the attachment confusing.

### 8.3 Material, outline, and silhouette

Use an unlit body material with alpha masking. Keep normal depth testing and depth writes. The body illustration does not receive scene shadows or diffuse lighting; tune the artwork to sit within the environment's palette and final camera presentation.

The default body does not emit light, create bloom, or illuminate nearby surfaces. Keep a consistent dark drawn edge around the main silhouette only if needed for contrast. Any outline belongs in the artwork or mesh silhouette first; no global outline effect is required.

Draw the player with large readable features. Avoid tiny facial details or thin detached shapes that disappear under minification. Its pole attachment and body orientation must remain legible against both light paper and dark cut edges.

### 8.4 Pole and tip

Keep the pole and tip as simple solid geometry driven by the existing direction, length, and compression state. Use matte painted-card colors and a darker contrasting side if necessary. They must remain readable when pointing partly toward or away from the camera.

Do not replace the pole with a single camera-facing illustration that loses world-space direction. Do not hide physical compression by anchoring the visible pole to a decorative point that disagrees with simulation.

Retain the current dimensions initially. If screen readability later motivates a visual-only thickness change, verify that it does not imply a different landing or trigger reach. Pole and tip appearance never define gameplay collision.

### 8.5 Animation and future views

Reuse the existing impact squash, launch stretch, partial body lean, and tip response. Apply them around the agreed artwork pivot. Preserve the one-shot contact and launch identifiers so compression does not retrigger an impact animation each frame.

Artwork should work as a single neutral view first. If front/back identity becomes important, a later character asset may contain four camera-relative views. Define headings from a stable movement or facing direction and the camera, with hysteresis near sector boundaries. Holding still must not cause view flicker.

Directional art and a sprite atlas are future work. The current `Sprite` component does not expose an atlas frame rectangle. Do not promise atlas animation through an invented property; inspect the selected image/material path before implementing cropped UV frames or separate-image swapping.

Keep squash/stretch as the initial animation system. Additional drawn states such as compression, launch, airborne, or failure should be introduced only when gameplay and character design make their purpose clear.

## 9. Camera and depth readability

Preserve perspective projection and current movement-relative controls. Begin with the existing 52-degree base FOV and 20-degree pitch. Keep the existing follow behavior, lookahead, zoom, and orbit while evaluating the cutout.

The first implementation must support the existing camera envelope. Explicitly oriented player geometry remains visible as pitch and yaw change. Environment cutouts are world objects and must be authored with their actual viewing range in mind.

Do not silently restrict orbit to make unfinished scenery work. If a future level needs a constrained camera, specify that as a separate gameplay/level-design decision with explicit supported angles. The development editor keeps its independent authoring camera behavior.

For depth readability:

- Maintain visible top and side faces on the next landing surface from the ordinary play camera.
- Keep the pole tip and prediction marker separable from their background.
- Preserve familiar world scale and existing jump distances.
- Avoid large foreground cards crossing the route.
- Give background structures enough separation in value and color to avoid false platform silhouettes.
- Check wide, tall, narrow, and distant platforms during ascent, descent, and a fast lateral jump.

Keep existing FOV pulses and impact motion initially. Reassess their magnitude if they make a flat character appear to change size abruptly or make thin paper edges unstable. New camera effects are not part of this direction.

## 10. Contact impressions

### 10.1 Visual behavior

An accepted pogo contact creates one brief ink impression on the contacted platform's top surface. Begin with a small uneven filled stamp or a broken ring. It should resemble pigment on paper, with no emitted light, hovering geometry, particle burst, or large world-space wave.

Start with a 0.18-meter radius, a maximum radius near 0.35 meters, a total lifetime of 1.2 seconds, and at most eight simultaneous marks. These are tuning defaults. Keep the strongest contrast near the contact point, allow a small initial growth, and fade to the unchanged underlying surface.

Incoming impact speed may control initial size or density. A landing stamp must not depend on future charge that has not yet occurred. If charged launches later leave a stronger print, implement that as a separate launch transition using the existing launch/contact IDs and update the corresponding stamp once.

Ink color and shape must differ from the live prediction marker, checkpoint activation, and goal. Recent marks must not imply that an expired landing prediction is still valid.

### 10.2 Contact ownership and integration

Record contact transitions at the substep where they occur. Do not inspect only the final frame's contact ID, because multiple substeps can advance state before presentation.

The current pure `LandingContact` contains only `surfaceY`; the simulation does not identify a rendered platform. Add any needed surface ownership in the integration layer. The collision-query wrapper can retain the accepted stable level object ID alongside the plain collision result passed to simulation.

After simulation accepts a new contact, associate that ID with the actual contact tip, impact information, and presentation time. Metadata from an attempted query must not create a stamp unless the simulation accepted the contact.

An impression record needs, conceptually:

- Stable owning surface ID.
- Contact identifier scoped to the current gameplay run.
- Center in the surface's local top-plane coordinates, measured consistently in meters.
- Creation time and lifetime.
- Radius, strength, and deterministic shape seed.

These are presentation records, not simulation events or persistent level objects. Compare state directly with free functions; no event system is needed.

### 10.3 Rendering implementation

Prefer a small, bounded overlay mesh for the first implementation. It may use a shared stamp image or a procedural fragment mask. Position it a small explicit offset above the top plane, initially around 0.002 meters, and test for z-fighting at the supported camera distances.

The overlay has no collision, does not cast shadows, and uses ordinary scene depth. Use alpha blending only for its fading coverage. Keep its visual response compatible with the underlying lit paper; an opaque bright unlit patch must not appear to glow within a shaded area.

Clip stamp coverage against the owning platform's actual local landing rectangle. A quad crossing a platform edge must not print into open air, onto another platform, or onto unrelated geometry below it. This is a receiver-owned surface overlay, not a general projected decal system.

One shared material type can carry per-mark parameters. Per-mark material rows are bounded by the fixed mark capacity; do not allocate a new shader type or image per contact. Use deterministic ordering when overlapping marks blend.

A later receiver-material implementation may evaluate a small fixed set of marks within the paper shader. If adopted, filter by surface ownership, preserve material reuse, and measure the per-fragment cost before replacing the overlay implementation. It must not become a global loop over an unbounded contact history.

### 10.4 Lifetime and reset behavior

Use a presentation clock that pauses consistently with inactive gameplay. Keep frame interpolation separate from mark lifetime. Restart, respawn, and level replacement clear all marks and reset run-scoped deduplication so reused contact IDs do not suppress new stamps.

Entering the editor clears marks. Moving, resizing, replacing, or deleting their surface also clears its marks. They do not participate in undo, save, or level JSON.

At capacity, replace the oldest mark deterministically. Destroy or reuse its render entity. World disposal releases transient entities and any app-owned resources. No contact trail grows without a bound.

## 11. Gameplay signals and collision agreement

Keep prediction state, checkpoint activation, and goal completion authoritative in existing gameplay logic. Paper artwork and ink impressions only display those states.

Prediction markers should sit on the predicted surface, remain visually distinct from ink, and communicate certainty using both shape and color when that presentation is revised. A decorative printed circle is never an input to prediction.

Future checkpoint and goal visuals may use folded markers or printed symbols. Their trigger boxes remain independent level data. Do not shrink or enlarge gameplay volumes to fit a decorative illustration. Keep development trigger-volume visualization available even when finished marker art arrives.

An inactive checkpoint, active checkpoint, and goal must have distinguishable silhouettes or symbols. Avoid depending exclusively on green versus red or a small brightness change.

Every rendered platform top must agree with the collision top and footprint. Put bevels inside the playable boundary or below its top edge. Do not make a rounded or torn top imply support beyond the box collision. Existing intentional gameplay tolerances remain explicit in gameplay configuration; artwork must not invent additional invisible support.

Decorative seams, card layers, texture changes, and ink do not create collision boundaries. Maintain a clear visual distinction between a solid playable slab and thin background scenery that happens to have a similar outline.

## 12. Future environment and character assets

### 12.1 Timing and minimum useful kit

Do not produce the kit during the current planning task. When asset work is scheduled, start with only the pieces needed by an actual level: a small set of platform sizes, a support, a folded background piece, and the character body artwork. Add additional pieces from demonstrated layout needs.

The first asset pass should replace development representations without requiring movement or collision changes. Validate one representative platform and the player before authoring a large collection.

### 12.2 Environment export contract

Continue using Blender source assets and glTF 2.0 runtime exports through the existing pipeline. Prefer `.glb` for self-contained static meshes. Keep editable sources separate from served runtime files.

Use meters, runtime Y-up coordinates, applied rotation and scale, intentional origins, and documented local bounds. Verify the exporter conversion rather than assuming Blender's authoring axes match runtime axes.

For a platform compatible with the current simple placement path, keep an identity primitive transform, one primitive, and one material. Use UV regions, vertex color, or geometry within that primitive to distinguish top, side, and cut edge. Keep the top centered and dimensioned against its independent authored collision box.

Do not silently relax the existing sample asset's validation for unrelated future models. If a future asset genuinely requires multiple primitives or transformed child nodes, first extend instance bookkeeping, transform composition, selection, cleanup, and integration coverage. The installed loader emits primitive entities; a transform hierarchy is not implied by a Blender collection or parent.

Exclude cameras, lights, skeletal animation, morph targets, and required unsupported glTF extensions from the first environment kit. Blender shader nodes are authoring tools; only supported exported glTF properties reach the runtime.

Prefer modeled thickness for nearby solid structures and alpha-masked silhouettes for distant decoration. Paper transmission, fiber scattering, subsurface shading, and physically simulated folds are not required export features.

### 12.3 Character image contract

Author the player as original illustrated artwork with a transparent background. Use a lossless RGBA format supported by the existing image registration path, initially PNG. Keep the source illustration editable outside runtime files.

Use consistent canvas dimensions, body bounds, pivot, and pole attachment across future views or frames. Transparent padding must not alter world size. Store nominal visible size and pivot as explicit catalog data rather than deriving the gameplay body from image pixel bounds.

Start with a 256-by-256 image for the small body cutout and inspect it at the actual screen size. Increase resolution only when the artwork needs it. Use filtered sampling and mipmaps appropriate to the intended illustrated appearance; nearest-neighbor sampling is not the default style.

Pad outlines and alpha edges for minification. Check small internal holes, detached details, and dark fringes against both light and dark backgrounds. An alpha-mask threshold must not erase an important feature at distant camera settings.

The initial cutout has no rendered physical thickness. If a close camera later exposes this limitation, assess a thin silhouette mesh or authored edge geometry as a separate asset change. Do not duplicate offset transparent quads merely to suggest thickness; that creates sorting and double-image problems.

### 12.4 Texture sizes and material counts

Start shared environment color/grain textures at 512-by-512 or smaller. A 1,024-by-1,024 atlas is a reasonable later option when a measured view needs it. Do not assign a unique large texture to every small prop.

Keep one material per simple platform asset where practical. A second material is justified by a genuinely different rendering requirement, not every color change. Repeated placements reuse loaded mesh, material, and image handles.

Treat texture memory, alpha overdraw, shadow passes, and entity count as first-class costs. A low-triangle scene can still be expensive if it uses many transparent sheets or duplicates large images.

### 12.5 Catalog and loading

Extend the existing static asset-ID-to-URL approach when actual assets are introduced. A small typed catalog can then include visual kind, nominal size, pivot, material family, and permitted roles where those fields are needed.

Do not introduce a generic asset database, importer service, generated manifest, runtime uploads, or remote arbitrary-URL loading. Load required resources before enabling synchronous authoring actions, and reuse the current per-world handle cache.

Register images and material types at the supported initialization stage before the renderer warms. Failures identify the asset ID and URL. An explicitly chosen placeholder can be a normal catalog entry; a failed production asset must not silently turn into a placeholder.

Shared imported resources must not be mutated for one placement's state. A checkpoint highlight, tint, or future paper-material variant must use supported instance data or a cached explicit variant. Loading the same file for each duplicate is not acceptable reuse.

## 13. Level data and editor integration

Keep Stage A and the first character presentation independent of level-schema changes. Use one typed application lighting configuration first. Do not add per-object lighting controls or save global rendering state into every platform object.

If levels later require different palettes or lighting, add a small validated profile ID at the level boundary with a backward-compatible default. Define persistence and unknown-ID errors at that time. Avoid freely editable nested light graphs in level JSON.

Future decorative placements should have explicit visual-only ownership. Add a narrowly defined decoration representation only when the first real decoration needs it. Do not use zero-sized colliders, nonblocking fake platforms, or checkpoint roles to store scenery.

The editor must keep logical object IDs stable and transform visuals and collision from the same authored placement. Future assets preserve add, selection, move, resize, duplicate, delete, undo, save, and reload behavior.

Selection continues to resolve through the logical object. If future visuals contain multiple entities, selection highlights the complete visual placement and deletion destroys all of it. That extension is deferred until needed.

Keep editor controls barebones. Add only fields needed to author supported data. No themed panels, material graph UI, lighting timeline, asset browser, or interface redesign is part of this visual direction.

## 14. Cost controls and degradation

Use these as initial constraints, then record actual performance on the target hardware when one is established:

| Feature | Initial constraint |
| --- | --- |
| Main lighting | One shadowed directional plus ambient |
| Directional shadows | Two cascades, 1,024-pixel tile, bounded distance |
| Local lights | None required by the baseline |
| AO | Optional; compare Low quality against disabled |
| Fog and bloom | Disabled |
| Player | One masked body quad plus simple pole and tip |
| Contact impressions | At most eight short-lived surface overlays |
| Environment materials | Small shared family; no material per placement by default |
| Asset animation | No environment skeletons or morph targets required |

No frame-rate claim is implied without a target GPU, output resolution, and representative course. Record those conditions with each performance comparison. Use engine diagnostics during development without adding a permanent gameplay profiler UI.

If rendering cost is excessive, remove AO first, then compare shadow filtering, cascade count, distance, and tile resolution. Reduce decorative overdraw and distant detail before reducing the readability of the player, pole, or next landing surface.

Each reduced-cost configuration must preserve gameplay geometry, marker semantics, input behavior, and the material palette. A reduced-cost view is still the same visual direction.

## 15. Implementation sequence

### Stage A: Existing geometry

1. Capture the current level from a reproducible camera pose as a baseline.
2. Put the selected lighting and presentation values in one small typed configuration and use them from the existing scene setup.
3. Set exposure and tonemapping explicitly; establish the shared matte palette on boxes.
4. Enable bounded directional shadows and tune bias against the actual platform scale.
5. Compare AO disabled and enabled. Keep it optional if the gain does not justify the cost.
6. Verify gameplay and editor state remain unchanged by rendering settings.

### Stage B: Temporary character

1. Replace only the body visual with a simple flat representation. Keep the current pole, tip, body dimensions, and simulation.
2. Derive camera-facing orientation after the presented camera pose and before renderer consumption.
3. Reapply squash/stretch and projected lean without changing the body root or pole attachment.
4. Verify depth, alpha coverage when used, and camera extremes. Keep the body out of shadow casting initially.
5. Evaluate it through a complete jump, compression, charged launch, fall, and respawn.

### Stage C: Contact ink

1. Retain stable surface ownership in the integration-owned accepted-contact path.
2. Maintain a bounded mark collection with substep deduplication and explicit reset behavior.
3. Render receiver-clipped top-surface marks with shared resources.
4. Verify edge contacts, overlap, surface edits, repeated respawns, and resource bounds.
5. Tune the marks against the landing prediction so they cannot be confused.

### Stage D: Later assets

1. Author one representative solid paper platform and one original body illustration.
2. Validate export/image contracts and replacement at the existing world scale.
3. Expand the catalog only for the actual next asset or placement need.
4. Add the smallest useful environment kit, preserving independent collision and editor persistence.
5. Consider directional character art or additional animation only after the base character works in ordinary gameplay.

## 16. Verification and acceptance criteria

### 16.1 Algorithmic and integration coverage

Add tests only for algorithmic logic, boundary IO, and integration flows. Do not write tests that merely repeat palette constants or inspect a particular helper's implementation.

Relevant algorithmic cases include finite camera-facing basis construction, projected lean, mark lifetime and capacity, contact deduplication, and clipping against a rotated receiver rectangle. Relevant boundary IO includes future catalog validation, image/asset loading errors, and any supported level-profile parsing.

Use a focused `tests/<goal>.node.ts` check for renderer or complete physics/render composition, following the installed glTF and ambient-occlusion example checks. Verify meaningful invariants:

- Rendering changes leave collision entities, landing bounds, trigger volumes, and simulation results unchanged for the same controls.
- Repeated placements reuse resource handles and retain independent transforms.
- A cutout writes depth only within its retained silhouette, and geometry behind transparent regions remains visible.
- Character orientation uses the current presented camera and does not modify the simulation body or pole.
- Each accepted contact creates at most one stamp; rejected queries create none.
- Marks stay on their owning surface, expire, clear on reset/edit, and remain within capacity.
- Level replacement and world disposal do not leave stale presentation entities or surface references.

### 16.2 Captured frames and motion review

Use the cheapest evidence that answers the change: state assertions, then captured frames, then a development browser when interaction or persistence needs it.

Capture the same small layout with a neutral platform, adjacent slabs, a folded or layered placeholder, the body cutout, and a visible pole. A separate showcase level is not required; reuse a small existing course region or a focused integration fixture.

Review at least:

- Player on a light top, in shade, and against a dark side face.
- Platform top/side separation with AO disabled and enabled.
- Thin overlaps without shadow acne or visibly detached shadows.
- Transparent silhouette edges with geometry behind them.
- Low and high camera pitch, several orbit headings, and near/far zoom.
- A fast jump with the tip, prediction marker, and target edge all visible.
- A stamp near an edge and overlapping stamps on the same receiver.
- A respawn with no interpolated trail or stale marks.

Judge character orientation, mark timing, and camera motion in a sequence, not only a still frame. Use at least a normal desktop frame and a narrower viewport. Check grayscale readability as an inspection step.

Captured frames must be labeled with actual renderer settings. Concept art and screenshots from reference games do not count as FPP2 rendering verification.

### 16.3 Editor and persistence

When implementation changes editor behavior, exercise add, select, transform, resize, duplicate, delete, undo, save, and reload in a development browser. Verify corresponding level and collision state with a focused integration check.

Marks, temporary character presentation state, and global lighting configuration must not leak into saved level JSON. Existing box and sample-model levels remain loadable.

Run only the focused check needed while iterating. Before finishing an implementation, run `bun check` and `bun test` once. Run relevant `*.node.ts` integration checks explicitly by path because the default test discovery does not include them.

If the available GPU, WebGPU adapter, or browser environment prevents scene verification, report exactly which verification was blocked. Passing type checks or state assertions does not establish that lighting, shadows, cutout edges, or composition look correct.

### 16.4 Stage completion

Stage A is complete when existing geometry has a consistent matte palette, stable lighting/shadows, explicit presentation settings, readable landing surfaces, and captured evidence under the available renderer.

Stage B is complete when a temporary flat body retains readable pose feedback throughout normal play and camera movement while the pole, collision, and gameplay remain correct. Finished character artwork is not required.

Stage C is complete when bounded impressions reflect actual accepted contacts, remain attached and clipped to their surfaces, reset correctly, and cannot be mistaken for live gameplay indicators.

Stage D is complete only for the assets actually scheduled and integrated. This spec does not require an entire finished art library to declare earlier stages complete.

## 17. Deferred decisions and exclusions

Final character identity, finished palette, decorative setting, asset quantity, and illustration production remain open until gameplay and level needs justify them. The committed direction is the combination of constructed paper environments, a flat illustrated player, a readable solid pole, colored lighting, and contact ink.

Defer environment production, directional character sheets, extensive frame animation, multi-primitive placement groups, decoration authoring, and level-specific lighting profiles until they are needed. Their contracts above guide future work without requiring those systems now.

Exclude a renderer rewrite, automatic mesh collision, changes to simulation mechanics, side-scrolling conversion, full-scene outlines, runtime paper folding, cloth physics, skeletal characters, simulated paper transmission, real-time global illumination, reflection systems, volumetric atmosphere, large particle systems, persistent paint accumulation, and an asset upload/build service from the baseline.

## 18. Installed Shallot references

The API basis for this spec is `@dylanebert/shallot` 0.10.3. Re-read the installed version when implementation starts; do not assume these contracts survive a package upgrade unchanged.

- `node_modules/@dylanebert/shallot/examples/lit-interior/src/room.ts` and `lighting.test.ts`: main/local lights, shadows, and shadow-caster exclusions.
- `node_modules/@dylanebert/shallot/examples/ambient-occlusion/src/scene.ts` and `scene.node.ts`: AO composition, state checks, and captured-frame comparisons.
- `node_modules/@dylanebert/shallot/examples/materials/src/materials.ts` and `quantized.node.ts`: standard-material extension and banded output.
- `node_modules/@dylanebert/shallot/examples/gltf/src/app.ts` and `tests/placement.node.ts`: cached loading, placements, and resource/transform integration checks.
- `node_modules/@dylanebert/shallot/examples/color-grading/src/scene.ts`: lighting and camera grading composition.
- `node_modules/@dylanebert/shallot/src/core/rendering/lighting.ts` and `shadow-filtering.ts`: light units, shadow fields, and available filters.
- `node_modules/@dylanebert/shallot/src/core/rendering/tonemapping-state.ts`, `tonemap.ts`, and `color-grading.ts`: explicit presentation operators and grading behavior.
- `node_modules/@dylanebert/shallot/src/core/rendering/billboard.ts`: automatic orientation modes and rotation substitution.
- `node_modules/@dylanebert/shallot/src/extras/sprite/index.ts`, `pack.ts`, and `material.ts`: unlit sprite shading, masking, image fields, and billboard behavior.
- `node_modules/@dylanebert/shallot/src/standard/rendering/material-data.ts`, `material-type.ts`, and `standard-material.ts`: linear colors, material rows, alpha modes, instance overrides, and extension contracts.
- `node_modules/@dylanebert/shallot/src/standard/rendering/shadows.ts` and `ssao.ts`: shadow resource costs and AO parameters.
- `node_modules/@dylanebert/shallot/src/extras/sky/index.ts` and `extras/fog/index.ts`: sky-background haze versus volumetric scene atmosphere.
