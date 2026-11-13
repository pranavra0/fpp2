# Phase 7: Physically distinct platform surfaces

## 1. Purpose and delivery

Extend FPP2 with a small set of predictable platform responses built from a shared mechanical model. Surfaces should change how a player plans a landing, preserves or redirects momentum, selects charge, and chains the next jump. Count distinct useful decisions rather than surface names.

This is a forward-looking specification. First validate the model through isolated experiments using the Phase 6 laboratory, then implement three non-default profiles and compare them on a short mixed route. Existing levels, neutral platforms, controls, and launch timing retain their behavior. This task does not require implementing the runtime changes while writing the specification.

## 2. Existing ownership and constraints

`src/sim.ts` computes movement and contact response. `src/game/physics.ts` supplies a descending tip contact from Shallot static-shape queries. Its current `LandingContact` contains only `surfaceY`; `land` records horizontal carry but discards incoming vertical speed. `LandingSurface` stores top-plane/footprint data on collision entities. Ground/platform visuals and collision are separately owned entities with stable authored IDs.

The pogo is not a dynamically solved rigid body. Setting a Shallot shape's friction or restitution alone will not change its motion. Keep `PogoWorldCollisionPlugin` and disabled automatic solving; apply surface response in pure simulation, once, from accepted query results. Do not combine a Box3D impulse response with a second game-owned bounce.

Only horizontal top contacts on static boxes, including Y-rotated boxes, are supported initially. Adhesion means a bounded contact dwell at the existing anchored tip. Friction means damping stored horizontal carry during that dwell. Neither implies wall sticking, sliding the tip, body collision, or a material solver for arbitrary normals.

## 3. Mechanical parameters

Represent profiles as typed numeric data in one catalog. Use free functions to validate and resolve them. No subclass per surface, string-based behavior dispatch, callbacks in profiles, plugin per type, or simulation event system.

| Parameter | Units and admissible range | Meaning |
| --- | --- | --- |
| `bounceScale` | Dimensionless, positive | Multiplies the complete ordinary powered launch velocity, including its charge and vertical-floor calculation |
| `restitution` | Dimensionless, 0–1 | Fraction of incoming downward speed available as an alternative vertical rebound |
| `impactSpeedLimit` | m/s, positive | Limits speed considered for restitution; does not hide invalid incoming velocity |
| `momentumRetention` | Dimensionless, 0–1 | Multiplies incoming horizontal carry once at accepted contact |
| `contactDrag` | s⁻¹, nonnegative | Exponential damping of stored horizontal carry during compression |
| `minimumDwell` | Seconds, nonnegative and bounded | Earliest permitted launch after contact, without changing charge duration |
| `directionalSpeed` | m/s, nonnegative | Fixed horizontal velocity increment applied once on launch in the resolved surface direction |
| `maximumVerticalSpeed` | Optional m/s, positive when present | Explicit surface launch-speed limit for authored non-default responses |

Bounce strength changes powered takeoff; restitution responds to impact. Retention loses a fraction immediately; friction accumulates with contact time. Adhesion delays departure but applies no attraction in flight. Directional speed is an authored source of energy; it is not derived from friction. Keep these concepts separate in the tuning UI and diagnostics.

Neutral response uses scale 1, restitution 0, retention 1, drag 0, dwell 0, directional speed 0, and no additional vertical limit. Use an explicit optional vertical limit for non-default profiles, rather than a large magic number. Existing horizontal speed limits continue to apply. The neutral path must reproduce current operation ordering and results exactly.

Validation rejects nonfinite values, negative coefficients, invalid ranges, and a nonpositive vertical limit. Initially limit authored dwell to 0.3 s; experiments exceeding this need a deliberate model review. These are authoring restrictions, not runtime state clamps. Damping, restitution saturation, and speed limits are intentional rules of the model and should be visible in diagnostics.

## 4. Contact and launch algorithm

### 4.1 Accepted contact

Integration returns a copied plain response snapshot with the selected top-plane contact. The simulation receives no entity ID, level definition, material, camera state, or query object. Stable object/profile IDs are retained separately in integration diagnostics.

Extend the plain contact with the resolved response coefficients and a world-space horizontal unit direction when a directional increment is nonzero. Copy these values into contact state, including incoming downward speed at the interpolated crossing. Use the existing contact-time vertical velocity calculation, before `land` sets it to zero. Capture once; do not resample a profile every compression tick.

At contact, store `carryXZ = incomingVelocityXZ * momentumRetention`. Increment the contact ID once and keep the existing anchored tip and body placement. No impulse is applied to a query candidate that fails footprint/top-plane validation.

If several valid surfaces share the earliest crossing, resolve equal crossing fractions within a declared small tolerance by stable object ID. Do not let query callback or entity allocation order select physical behavior. Overlapping equal-height surfaces should also produce an authoring diagnostic because the geometry is ambiguous.

### 4.2 Compression and adhesion

Keep current pole update, ground control, charge accumulation, compression geometry, buffer expiration, and full-charge behavior. After the existing ground-control update, damp stored carry by `exp(-contactDrag * dt)` and apply the existing horizontal limit. With zero drag this preserves the original path. This defines friction on stored momentum; it does not allow the anchored tip to slide.

Evaluate the existing ordinary launch condition each tick. If it is satisfied before `minimumDwell`, latch a launch request and its reason. Launch on the first tick when dwell has elapsed. Release must not be lost while waiting, and a full-charge request must not produce repeated launches. Charge remains bounded at its current maximum; holding Space can continue charging during dwell but does not bypass the maximum or require a new press after dwell.

No extra state such as a general attachment mode is needed initially: `Compression` plus elapsed time, response snapshot, and a pending-launch flag suffice. Reset/respawn/editor transitions clear them. Surfaces do not modify the input buffer or create coyote time.

### 4.3 Departure

Let `poweredVelocity` be the existing pole/charge launch contribution, excluding stored horizontal carry. Compute:

1. `surfacePowered = poweredVelocity * bounceScale`.
2. `reboundY = restitution * min(incomingDownwardSpeed, impactSpeedLimit)`.
3. `launchY = max(surfacePowered.y, reboundY)`, then apply the optional explicit vertical speed limit.
4. `launchXZ = carryXZ + surfacePoweredXZ + directionalSpeed * directionXZ`.
5. Apply the existing horizontal speed limit to the complete horizontal result once, and record any saturation.

Use the larger vertical source rather than summing powered and restitution speeds. A tall drop can preserve useful rebound without receiving a second full vertical energy award every bounce. Restitution at or below one and the authored limit prevent impact response alone from increasing apex without bound; powered pogo launches and directional increments remain explicit energy sources. Pole-length changes are an existing independent source of geometric height changes and must be held fixed when testing this claim.

Surface scaling applies after the ordinary vertical floor, so a deliberately weak surface can reduce launch height. Neutral response still uses the exact existing formula and speed-limit order. Capture charge and launch reason before resetting contact state. Keep the one-launch-per-contact assertion. Incoming fall speed must not affect the neutral launch.

## 5. First representative profiles

These are provisional experiment values, not approved tuning or claims of playtested behavior. Freeze general movement tuning while evaluating them. Implement the baseline plus three non-default profiles; do not add a large material list.

| Profile ID | Initial coefficients differing from neutral | Gameplay question |
| --- | --- | --- |
| `default` | None | Reference for behavior preservation |
| `elastic` | Bounce scale 1.15; restitution 0.85; impact-speed limit 18 m/s; maximum vertical speed 18 m/s | Can charged height and sufficiently tall-drop rebound support a deliberate higher route? |
| `grip` | Retention 0.35; contact drag 4 s⁻¹; minimum dwell 0.08 s | Does contact provide a useful braking and re-aiming opportunity while longer contact costs momentum? |
| `directional` | Directional speed 4 m/s; maximum vertical speed 18 m/s | Can players align, oppose, or cross an authored horizontal impulse to choose different exits? |

Use catalog defaults for unspecified coefficients. Directional surfaces require a nonzero authored local XZ direction; other profiles do not accept this field. Include a visible arrow. Avoid separate presets for every direction or asset.

Before combining coefficients in `grip` and `elastic`, test each coefficient alone through temporary laboratory candidates. This distinguishes immediate retention loss from dwell drag and powered strength from restitution. It does not add more production profiles. Weak bounce, low drag, and high retention are supported parameter experiments; promote another profile only if it supports a demonstrated decision the initial set cannot express.

Existing default contact already preserves all incoming horizontal momentum and has no passive drag. A new surface cannot meaningfully promise more preservation than that baseline. An ice-like name without a demonstrated mechanical difference is insufficient.

## 6. Interesting tasks and predictable tradeoffs

| Task | Controlled arrangement | Intended decision and failure mode |
| --- | --- | --- |
| Charge versus impact | Identical default/elastic pads, fixed-length pole, low and high drops, matched charge trials | Learn when impact rebound matters; confirm the stronger result is not simply extra charge |
| Stop and redirect | Default/grip pads after an equal-speed approach, with a narrow exit at 90 degrees | Trade retained speed for an easier re-aim; avoid making grip mandatory for every turn |
| Impulse alignment | Directional pad facing forward, backward, and across an identical approach | Plan carry and counterlean; make direction readable before contact |
| Precision recovery | Grip pad below a missed high route with a nearby exit | Recover control at a time cost; adhesion must not feel like an unexplained input failure |
| Mixed chain | Short route with elastic height option, default momentum route, and optional directional shortcut | Express a preferred technique rather than memorize a mandatory surface sequence |

Record incoming/outgoing velocity, impact rebound, powered contribution, retained carry, drag loss, dwell, impulse, and speed-limit saturation. A directional surface can have little effect when already saturated in its direction; show this rather than silently bypassing the global cap. Compare equal-speed/equal-charge starting states and complete chains, not only isolated apex values.

## 7. Level format and persistence

Add an optional `surface` field to `ground` and `platform` objects only. Existing files without it resolve to `default` without migration. Visual role/material and surface response remain independent: a platform remains a platform regardless of physical profile.

Example proposed authoring data:

```json
{ "surface": { "profile": "directional", "directionXZ": [1, 0] } }
```

Other profiles use only `profile`. Store the direction in object-local XZ coordinates, normalize validated nonzero finite inputs at the authoring boundary, and resolve to world space through the object's Y rotation. Nonuniform scale changes the footprint, not the impulse magnitude or unit direction. The simulation receives the resolved world-space vector only.

Update strict exact-key validation in `src/content/level.ts` deliberately. Reject unknown profile IDs, unsupported keys, invalid directions, and surface data on checkpoint/goal trigger boxes. Do not silently convert unsupported profiles to default. Preserve omission on old-file round trips; avoid unrelated rewrites.

Keep the small catalog source controlled and resolved by stable IDs. Do not embed arbitrary response overrides in every level or build a user-defined material scripting system. A laboratory experiment can contain an explicit temporary profile snapshot separately from production level JSON. Extend the catalog type and validator together when a later experiment justifies another profile.

Reuse `vite.config.ts` validation and atomic save behavior, including create/overwrite semantics. No new save endpoint, database, or remote material service is needed.

## 8. Shallot and ECS integration

Extend collision-owned `LandingSurface` data with a catalog index or compact response fields and the resolved direction. Maintain the stable authored object mapping in integration. Surface identity belongs to accepted collision data, not to the visible mesh material. Boxes and glTF visuals must resolve the same response.

`findLandingSurface` copies the selected response into its plain result. Shallot's `castShape` callback reuses its hit record and nested vectors; never retain those references. Preserve current top crossing, finite ground, edge tolerance, and nearest-contact validation. Add deterministic tie selection as described above.

Reconcile `addLevelObjectPhysics`, `updateLevelEntity`, editor sync, duplication, undo/redo, load, and entity destruction. A property edit updates response data even if transforms did not change; deleting a platform removes its response along with collision. Do not attach bodies/shapes to checkpoint or goal triggers.

Keep query synchronization before `Simulate`, following its existing `after: [StepPhysicsSystem]` ordering. The installed engine synchronizes query state even when automatic solving is disabled. No second physics world or solver step is needed.

Contact snapshots remain stable for a trial. Editing a platform/profile while playing is not supported; the development editor pauses play and resets on return. Candidate profile changes apply on restart using the Phase 6 tuning workflow. Reset paths must never leave a previous surface active.

## 9. Editor and presentation

Add a profile selector to the selected ground/platform properties. Show the resolved coefficients read-only for production authoring; coefficient editing belongs in laboratory candidates. Show local direction fields and a world-space arrow only for directional profiles. One property change is one undoable authoring action. Duplication preserves the profile and direction.

Use a small, distinct development indicator and plain text profile name. Direction requires an arrow, and grip/elastic surfaces need distinguishable non-color cues. Keep playable edges and landing-marker semantics legible. Do not require new glTF assets, finished textures, particles, audio sets, or a Phase 5 rendering rewrite. Visual differences must never secretly define physical behavior.

During contact, optionally show current profile, pending adhesion delay, and powered/impact launch source in development diagnostics. Production feedback should make dwell and release understandable with existing compression/launch presentation, not expose implementation details.

The current landing marker predicts the next descending contact, not the rebound after that contact. Keep that meaning. Resolve profile identity at the predicted hit for diagnostics if useful; do not label a marker as a complete multi-bounce path. Any future bounce prediction must use the same response functions and active tuning. Update feedback normalization to use active charge/compression tuning rather than stale defaults.

## 10. Shared contract with Phase 6

Phase 6 owns tuning snapshots, reset/replay, diagnostic traces, and trial configuration. Phase 7 owns surface coefficients, accepted-contact response snapshots, and the production level field. Both use the existing pure `step` and one integration-owned collision query; neither introduces a parallel movement path.

Record resolved response coefficients as well as stable profile/object IDs in exported experiments so catalog edits do not change an old experiment silently. Physics replay uses recorded world-space controls and the recorded level/profile snapshot. Camera comparisons keep these surface inputs fixed. A missing or incompatible response snapshot is an import error, not a silent fallback.

Changes to contact shape or simulation state must be applied once and reviewed against both phase specifications. Keep collision entity ownership independent from the number of visual entities attached to an authored platform, including multi-primitive glTF placements.

## 11. Delivery sequence and acceptance

1. Preserve neutral traces and define validated profile data plus pure response functions. Test coefficient effects separately before choosing combined presets.
2. Extend the accepted-contact contract and simulation state, preserving neutral behavior and reset semantics.
3. Integrate profile resolution into Shallot collision entities, strict level parsing, save/load, and editor updates.
4. Add the three representative profiles, minimal readable indicators, directional authoring, and isolated comparison environments.
5. Playtest a mixed chain, adjust provisional coefficients from evidence, and retain only mechanically useful profiles.

Algorithmic coverage must verify neutral parity, impact-speed sampling, powered versus restitution selection, damping over different dwell durations, retention once per contact, released/full-charge requests surviving adhesion, one directional increment per launch, final speed limits, and reset clearing all contact response state. Include zero and boundary coefficient cases and reject invalid values. Do not test only that a formula duplicates itself: compare behavioral outcomes such as apex, retained speed, and launch tick.

Boundary IO coverage must verify old levels, optional field round trips, bad profile/direction rejection, trigger restrictions, and experiment snapshot validation. Integration checks must verify Y-rotated direction resolution, equal-height tie behavior, profile-only edits, duplicate/undo/redo, save/reload, glTF/box equivalence, and unchanged gameplay triggers. Full physics compositions belong in `tests/<goal>.node.ts`, following `tests/game.node.ts` and `tests/editor.node.ts`.

While implementing, run the relevant focused test by path. Before completion run `bun check` and `bun test` once, plus the relevant `.node.ts` paths explicitly. Verify state first, then a captured frame showing collision/indicator agreement, then development-browser authoring and persistence. Report unavailable GPU scene verification; passing state checks alone does not prove visual readability or fun.

Completion requires unchanged default-level movement, reproducible distinct outcomes for each retained profile, correct surface persistence through editor flows, and playtesting that demonstrates at least one useful choice per non-default profile without invalidating ordinary platforms. A candidate that only adds surprise or a mandatory optimal surface should be revised or removed.

## 12. Exclusions

Defer moving/deformable platforms, slopes, wall/ceiling adhesion, continuous sliding, conveyors, per-triangle materials, dynamic rigid-body pogo replacement, surface damage, status effects, collectible materials, and arbitrary scripted responses. Each changes the current contact assumptions and needs its own gameplay evidence. Extensibility here means clear typed coefficients and one predictable response path, not prebuilding those systems.
