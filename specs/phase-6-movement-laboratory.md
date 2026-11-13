# Phase 6: Experimental pogo movement laboratory

## 1. Purpose and scope

Create a development environment for evaluating movement feel, discovering techniques, and deciding which changes improve fun, expressiveness, and skill mastery. Preserve current mechanics and shipped tuning until repeatable playtesting supports a specific change.

This is an implementation specification. It does not record completed experiments or authorize replacing the movement model wholesale. Build the smallest useful comparison loop first, then add diagnostics or experiments only when they answer an active question. Phase 7 surface experiments use this same loop and its contact contract.

Use existing primitive geometry, development UI, level loading, and ECS scheduling. No finished art, progression system, collectibles, combat, upgrades, multiplayer, online telemetry, or general experiment framework is required.

## 2. Inspected baseline

| Area | Current implementation and implications |
| --- | --- |
| Composition | `src/game.ts` installs browser input, standard rendering/audio, static collision queries, simulation, gameplay progression, and camera systems. The editor is loaded in development by `src/game/scene.ts`. |
| Movement | `src/sim.ts` owns plain state and pure movement/contact response through free functions. A landing-query callback supplies geometry-independent contact results. States are `Airborne` and `Compression`. |
| Timing | Simulation runs at 120 Hz. The current engine fixed step contains two simulation steps; `simulationSubstepCount` rejects incompatible rates. Input presses are consumed once across substeps. |
| Contact | `src/game/physics.ts` casts the tip against static Shallot shapes, then validates descending crossings of horizontal top planes and finite footprints. Platforms may rotate around Y. There is no body, wall, underside, or slope response. Automatic physics solving is disabled. |
| Launch | The tip remains anchored during compression. Incoming horizontal velocity is stored and combined with ground control and the next pole-directed launch. Falling faster does not currently increase the launch. There is no passive horizontal drag. |
| Controls | Camera-relative WASD controls lean and acceleration. Space holds charge; release launches; full charge launches automatically. A buffered press can charge after landing even when Space is already released. E/Q change pole length in both states. R restarts at the checkpoint; Shift+R restarts from the beginning. |
| Presentation | `src/game/presentation.ts` derives impact, squash/stretch, and the landing marker. Prediction assumes ballistic vertical motion, constant horizontal velocity, and a fixed pole pose; its `certain` flag is not a guarantee against future input. |
| Camera | `src/game/camera.ts` follows with smoothed lookahead and vertical dead zone, faster falling response, interpolated focus/impact, orbit/zoom, and speed/fall/launch FOV changes. Player pose is written at fixed cadence. |
| Authoring | F2 switches edit/play. The editor creates, selects, moves, resizes, duplicates, deletes, undoes/redoes, and saves/loads objects. Returning to play resets to spawn. `vite.config.ts` saves validated JSON into `public/levels` through development endpoints. |

Current movement defaults in `src/config/gameplay.ts`:

| Parameter group | Baseline |
| --- | --- |
| Gravity and launch | Gravity 9.81 m/s²; launch speed 7.8 m/s; charged pole-speed bonus 5.5 m/s; minimum base vertical speed 7.4 m/s; charged vertical bonus 2.5 m/s |
| Charge and buffer | Maximum charge 0.3 s; idle bounce delay 0.045 s; press buffer 0.12 s |
| Pole | Initial length 1 m; limits 0.7–3.5 m; length rate 1.5 m/s; maximum lean 0.72 rad |
| Response | Ground/ascent/descent lean response 25/16/19 s⁻¹; ground/ascent/descent control 18/4/6 m/s² |
| Limits and contact | Horizontal speed limit 18 m/s; compression 0.12–0.4 m; vertical tolerance 0.06 m; platform edge tolerance 0.12 m; ground edge tolerance zero |

Camera defaults in `src/config/camera.ts` include base/max FOV 52/58 degrees, default pitch 20 degrees, distance about 23.7 m, lookahead 0.18 s capped at 3.4 m, vertical dead zone 1.5 m, and horizontal/vertical/fall response 14/5/13 s⁻¹.

The existing `prototype`, `alternate`, and `first-level` JSON files provide regression environments. Phase 4 and Phase 5 are specifications, not proof that their future work has shipped. The personal `docs/` directory and referenced `.github/workflows/test.yml` were absent during inspection.

## 3. Questions to answer

1. Can a player deliberately choose low, high, short, and long jumps through charge, lean, and pole length?
2. Does momentum carry support planned chains and recoveries without making every correction an overshoot?
3. Is ascent useful for committing a trajectory while descent still permits a skilled correction?
4. Are short contacts, buffered presses, and automatic launches understandable and repeatable?
5. Does changing pole length create meaningful reach and timing choices beyond always extending fully?
6. Can players judge depth, speed, and the next contact while orbiting or falling quickly?

These are hypotheses to investigate. Success rates alone do not establish enjoyable control. Retain useful difficulty and alternative techniques when players can understand and master them.

## 4. Comparison loop and tuning tools

Provide a development-only panel alongside the existing editor. Use ordinary labeled fields and buttons. Keep movement controls inactive while a text field or tuning panel owns focus. Opening the panel pauses the trial and releases pointer lock; returning to play requires deliberate focus and clears held/pressed input state.

Maintain an immutable baseline snapshot and one editable candidate. Show active configuration, units, changed fields, and reset-to-baseline controls. Group fields by launch/charge, lean/control, pole, contact, and camera/presentation. `SIM_HZ` stays read-only in the initial tool; rate experiments require explicit integration work rather than an arbitrary slider.

Apply validated candidate changes atomically on trial restart. Do not mutate tuning midway through compression or flight. Switching baseline/candidate restarts from the same initial state. A camera-only comparison changes only its declared presentation settings, with the same movement tuning and input sequence.

Validate finite numbers and cross-field invariants: positive rates, gravity, charge duration and limits; ordered pole/compression bounds; compression smaller than minimum pole length; nonnegative delays/tolerances/control magnitudes; physically valid lean range; ordered FOV/pitch/distance bounds. Show validation errors and retain the previous valid configuration. UI ranges aid editing; they must not silently repair invalid state.

Store active tuning in a plain ECS resource owned by integration. Pass the same typed snapshot to simulation, initial-state creation, collision queries, prediction, feedback normalization, and resets. Current hardcoded reads of `DEFAULT_TUNING` in those paths must be reconciled before candidate comparisons are valid. Camera tuning follows the same ownership rule. Production continues to use source-controlled defaults.

Support JSON export/import of an experiment configuration and result notes. Include a format version, source revision, complete tuning snapshots, level snapshot, trial start state, camera start settings, and declared experiment variable. Keep this separate from strict production level JSON. Use local downloads/imports; no backend or analytics service is required. Exporting or importing must not rewrite gameplay defaults or project levels.

## 5. Trial state and evidence

Initially use authored spawn, zero velocity, and recorded pole/camera settings. Add an explicit captured-start option for investigating a contact or recovery. A captured start copies all simulation fields, not just position. Reject restoration against a changed level or profile snapshot. A restart resets controls, pending presses, contact/launch counters, progression, queued trigger contacts, camera history, FOV, impact, prediction, and diagnostics consistently. Preserve editor undo history and unsaved authoring changes.

Add pause and one-simulation-tick stepping for diagnostics. Step exactly 1/120 s through the same integration path; do not change `dt` to slow motion. Clear input edges after their intended tick. Pause also freezes gameplay timers and presentation decay. Editing geometry invalidates captured starts and comparison recordings.

Record a bounded in-memory trial trace, initially at most 30 seconds of fixed-step samples. Keep position, velocity, pole length/direction, charge/compression state, controls, and contact/launch IDs. Add plain integration metadata for accepted surface ID, crossing point, incoming/outgoing velocity, and launch reason. Observe ID transitions; do not install a simulation event bus. Export only when requested by the tester.

Summarize apex above launch, flight/contact duration, horizontal distance, landing error against a selected target, speed retained through contact, charge at launch, and failures. Distinguish requested input, accepted contact, and actual launch. Optional path/contact/pole-direction overlays consume the trace and must not affect simulation. Do not build a charting dashboard before basic readouts answer the experiment.

Tick-indexed recorded world-space `Controls` support repeatable physics comparisons without feeding the camera back into simulation. Camera/input-mapping tests must instead record raw keys and orbit inputs; world-space replay alone cannot verify camera-relative control. Record the replay kind. Compare determinism within the same build/runtime first; do not promise cross-platform bitwise replay.

## 6. Purpose-built environments

Author a small set of ordinary levels or compact separated stations using the existing JSON format. Reuse primitives and current save/load paths. Dimensions below are initial experiment inputs, not measured reach guarantees. Calibrate them against the baseline trace and include both clearly reachable and boundary targets.

| Environment | Layout and controlled task | Evidence |
| --- | --- | --- |
| Flat reference area | Broad finite floor, distant failure boundary, repeat idle and charged vertical bounces with fixed pole length | Apex consistency, charge curve, contact timing, accidental horizontal drift |
| Range and landing precision | Same-height targets at 3, 6, 9, and 12 m, with widths decreasing from 4 to 1 m; restart on a broad launch pad | Deliberate range choice, overshoot, correction cost, repeatability |
| Height and length | Flat shelves with 1, 2, 3, and 4 m top-height increments; compare short/default/long poles | Reach, tip timing, clipping/anchor artifacts, reasons to choose each length |
| Momentum and reversal | Straight chain followed by 90-degree and 180-degree turns; keep pad dimensions and heights equal | Carry retention, braking distance, ability to redirect without losing all speed |
| Descent and recovery | Broad elevated start, offset wide/narrow targets at several drop heights | Late correction, buffer timing, camera fall lag, legibility of missed contacts |
| Combined route | Short branching chain with a safe route and precision shortcuts using only current mechanics | Transfer of learned techniques, route choice, mastery over repeated attempts |

Keep target gaps free of broad hidden catch floors that invalidate failures. Recovery floors, when useful, sit visibly below the trial targets. Place checkpoints so repeated attempts take seconds; an explicit trial reset remains distinct from normal R/Shift+R behavior. No new production goal/checkpoint semantics are required.

Editor additions are limited to numerical iteration, a temporary trial start, and launching the selected station. Existing position/scale fields, duplication, snapping, and undo/redo already cover much of the authoring work. Add spacing helpers only if manual layout repeatedly obstructs an experiment.

## 7. Experiment sequence

Change one variable or one explicitly coupled group at a time. Compare current value, a modest reduction, and a modest increase before trying extremes. Do not simultaneously alter physics, camera, and level dimensions.

| Experiment | First variable | What would support retaining a candidate |
| --- | --- | --- |
| Bounce rhythm | Idle delay, then charge duration/buffer separately | Players can deliberately alternate automatic and charged contacts with fewer unexplained launches |
| Launch expression | Charge bonus and vertical floor in separate passes | Distinct useful trajectories remain available without one charge/lean choice dominating |
| Steering | Ground/ascent/descent response and acceleration separately | Players commit, correct, and reverse deliberately while preserving momentum techniques |
| Speed | Horizontal limit after steering comparisons | Faster chains add useful choices without making precision landings unreadable |
| Pole length | Length rate, then limits | Short and long settings have demonstrated situational uses; extension is not merely a free reach upgrade |
| Contact forgiveness | Edge and vertical tolerances separately | Near-edge outcomes remain understandable without accepting visibly detached contacts |
| Camera | Follow/dead-zone/lookahead, then FOV/impact separately | Better depth judgment and fewer lost targets without reducing comfort |
| Prediction | Existing marker versus hidden marker, then a clearly labeled alternative if needed | Improved planning with understood uncertainty; no apparent promise of guaranteed landing |

Investigate momentum chains, pre-leaning, countersteering, buffered charges, short releases, length changes near descent, and deliberate landing placement before introducing new actions. Pole changes can move the tip and reposition the anchored body without corresponding physical work; log these effects before deciding whether they are useful techniques or confusing exploits.

Wall rebounds, slopes, sliding contact, fall-energy conversion, adhesion, or directional launches require explicit contact-model work. Surface variations are specified in Phase 7. Do not infer support from box side faces or replace the pure simulation with the engine example's character mover.

## 8. Playtesting and decision rules

For each candidate, write the hypothesis, controlled task, altered values, expected benefit, likely regression, and rollback condition before testing. Give testers a short baseline familiarization, then compare A/B and B/A order. Use several repeated attempts per configuration and include both unfamiliar and practiced players when available; record actual tester/attempt counts and limitations rather than claiming statistical certainty.

Record task outcomes and brief answers: could the player explain the result, deliberately repeat it, recover from a mistake, and find more than one useful approach? Ask which version they want to continue playing and why. Increased success with reduced expressive choice is not automatically an improvement. Longer completion time can reflect productive experimentation.

Promote a change only with repeatable examples of its benefit, a check on a precision and momentum task, and a regression pass through `first-level`. Preserve defaults when evidence is mixed. Rejected candidates and a finding that current behavior is preferable are valid Phase 6 results. Never require shipping a new mechanic to complete the laboratory.

## 9. Implementation order and verification

1. Preserve baseline state traces and existing checks; consolidate tuning reads without behavior changes.
2. Add baseline/candidate editing, atomic restart, validation, and experiment export/import.
3. Add bounded traces, contact/launch diagnostics, and pause/step support.
4. Author reference, precision, momentum, height/length, and descent tasks; reuse them for a short combined route.
5. Run focused playtests and document decisions in experiment results. Implement movement changes individually only when supported.

Keep ECS resources/components as plain typed data, scheduled systems at integration boundaries, and movement/contact response as free TypeScript functions. Geometry, Shallot, devices, camera, UI, and rendering stay outside simulation.

Use algorithmic tests for tuning invariants, replay, edge consumption, charge/launch transitions, and reset/step behavior; boundary IO tests for imports; integration flows for collision, editor, and gameplay. Avoid tests of labels, styling, or implementation structure. Run focused checks while iterating: `bun test ./tests/sim.test.ts`, `bun test ./tests/game.node.ts`, `bun test ./tests/editor.node.ts`, and `bun test ./tests/gameplay.node.ts` as relevant. New complete physics/renderer compositions belong in `tests/<goal>.node.ts`.

Before completion run `bun check` and `bun test` once. Ordinary `bun test` excludes `.node.ts` checks. Validate state first, then a captured frame for spatial agreement, then development-browser authoring, persistence, focus, and playtesting. Follow the installed `first-person/tests/ascent.node.ts` and physics integration examples for state-driven checks and captures; use the HUD example for control interaction patterns without adding Svelte solely for this panel. Report GPU limits separately from state evidence. Automated traces and static frames do not establish movement feel.

Phase 6 is complete when baseline replay remains unchanged, a tester can reproduce and compare a candidate from an exported experiment, edited geometry survives save/reload with matching collision, the focused tasks are usable, and at least one full experiment has a recorded retain/reject/inconclusive decision with evidence. Runtime changes are subsequent implementation work; this document itself does not assert those criteria have passed.
