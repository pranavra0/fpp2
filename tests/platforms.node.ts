import { PlatformCrumbleState, PlatformMotionState, PlatformPose, PlatformVisualState } from "../src/game/platform-components";
import { expect, test } from "bun:test";
import { Body, createApp, Time, Transform, type World } from "@dylanebert/shallot";
import { castRayClosest, emptyQueryHit } from "@dylanebert/shallot/standard/physics";
import { DEFAULT_TUNING } from "../src/config/gameplay";
import type { LevelDefinition, LevelBoxPlatformObjectDefinition } from "../src/content/level";
import { addLevelPhysics, findLandingSurface, LandingSurface, PogoWorldCollisionPlugin, surfaceDiagnostics, type LevelEntity } from "../src/game/physics";
import { findPlayerContact } from "../src/game/player-collision";
import { advancePlatforms, capturePlatformVisuals, confirmPlatformContact, platformSupport, platformTrajectories, resetPlatforms } from "../src/game/platforms";
import { predictLanding } from "../src/game/presentation";
import { createSim, NEUTRAL_CONTROLS, playerPose, type Controls, type Sim } from "../src/sim";
import { step } from "../src/game/simulation-step";

const dt = 1 / DEFAULT_TUNING.SIM_HZ;
const pad = (extra: Partial<LevelBoxPlatformObjectDefinition> = {}): LevelBoxPlatformObjectDefinition => ({
    id: "pad", role: "platform", transform: { position: [0, -0.25, 0], scale: [8, 0.5, 8], rotation: [0, 0, 0, 1] },
    visual: { kind: "box", material: "platform" }, collision: { kind: "box", dimensions: [1, 1, 1] }, ...extra,
});
const movement = (offset: readonly [number, number, number]) => ({ path: [[0, 0, 0] as const, offset], duration: 3, phase: 0, mode: "ping-pong" as const });

async function scene(objects: LevelBoxPlatformObjectDefinition[], run: (world: World, entities: LevelEntity[], tick: (sim: Sim, controls?: Controls) => ReturnType<typeof step>, level: LevelDefinition) => void) {
    const app = await createApp({ defaults: false, plugins: [PogoWorldCollisionPlugin] });
    try {
        const level: LevelDefinition = { id: "platforms", spawnPosition: [0, 2, 0], failureBoundaryY: -20, objects };
        const entities = addLevelPhysics(app.world, level);
        app.world.step(Time.FIXED_DT);
        resetPlatforms(app.world, entities);
        run(app.world, entities, (sim, controls = NEUTRAL_CONTROLS) => {
            advancePlatforms(app.world, entities, sim, dt);
            const contact = step(sim, DEFAULT_TUNING, controls, sweep => findLandingSurface(app.world, sweep),
                sweep => findPlayerContact(app.world, sweep), platformSupport(app.world, sim));
            confirmPlatformContact(app.world, contact);
            return contact;
        }, level);
    } finally { app.dispose(); }
}

for (const [axis, offset] of [["x", [3, 0, 0]], ["y", [0, 3, 0]]] as const) {
    test(`${axis} translation carries compression and contributes velocity to launch once`, async () => {
        await scene([pad({ motion: movement(offset) })], (world, entities, tick) => {
            const sim = createSim({ x: 0, y: 1.001, z: 0 });
            sim.body.vel.y = -1;
            const landing = tick(sim);
            expect(landing?.platformId).toBe(entities[0]!.collisionEid);
            const initial = { ...sim.pogo.contactTip };
            for (let index = 0; index < 12; index++) tick(sim, { ...NEUTRAL_CONTROLS, compress: true });
            expect(sim.pogo.state).toBe("Compression");
            expect(sim.pogo.contactTip[axis] - initial[axis]).toBeCloseTo(12 * dt, 5);
            expect(sim.pogo.carryVelX).toBeCloseTo(axis === "x" ? -1 : 0, 5);
            const charge = sim.pogo.chargeT / DEFAULT_TUNING.CHARGE_MAX_S;
            tick(sim);
            expect(sim.pogo.state).toBe("Airborne");
            expect(sim.body.vel.x).toBeCloseTo(0, 5);
            const expected = DEFAULT_TUNING.LAUNCH_SPEED_MPS + Math.max(DEFAULT_TUNING.CHARGE_BONUS_MPS, DEFAULT_TUNING.CHARGE_VERTICAL_BONUS_MPS) * charge + (axis === "y" ? 1 : 0);
            expect(sim.body.vel.y).toBeCloseTo(expected, 5);
            expect(world.storage(PlatformMotionState).elapsed.get(entities[0]!.collisionEid!)).toBeCloseTo(14 * dt);
        });
    });
}

test("rising one-way platform catches a tip moving upward in world space", async () => {
    await scene([pad({ motion: movement([0, 12, 0]), collision: { kind: "box", dimensions: [1, 1, 1], mode: "one-way" } })], (_world, _entities, tick) => {
        const sim = createSim({ x: 0, y: 1.005, z: 0 });
        sim.body.vel.y = 1;
        expect(tick(sim)).toBeDefined();
        expect(sim.pogo.state).toBe("Compression");
        expect(sim.pogo.contactTip.y).toBeCloseTo(4 * dt);
        const below = createSim({ x: 0, y: -0.1, z: 0 });
        below.body.vel.y = 16;
        for (let i = 0; i < 15; i++) tick(below);
        expect(below.body.pos.y).toBeGreaterThan(1.5);
        expect(below.pogo.contactId).toBe(0);
    });
});

test("moving solid walls and undersides push stationary players without tunneling", async () => {
    for (const axis of ["x", "y"] as const) {
        const wall = axis === "x"
            ? pad({ transform: { position: [1, 2, 0], scale: [0.2, 8, 8], rotation: [0, 0, 0, 1] }, motion: movement([-6, 0, 0]) })
            : pad({ transform: { position: [0, 3, 0], scale: [8, 0.2, 8], rotation: [0, 0, 0, 1] }, motion: movement([0, -6, 0]) });
        await scene([wall], (world, entities, tick) => {
            const sim = createSim({ x: 0, y: 2, z: 0 });
            for (let i = 0; i < 60; i++) {
                sim.body.vel = { x: 0, y: 0, z: 0 };
                tick(sim);
                const surface = world.storage(LandingSurface), eid = entities[0]!.collisionEid!;
                if (axis === "x") expect(sim.body.pos.x + 0.325).toBeLessThanOrEqual(surface.centerX.get(eid) - 0.1 + 0.001);
                else expect(sim.body.pos.y + 0.41).toBeLessThanOrEqual(surface.topY.get(eid) - surface.height.get(eid) + 0.001);
            }
            expect(sim.body.pos[axis]).toBeLessThan(axis === "x" ? -0.3 : 1.7);
        });
    }
});

test("moving ice crumble starts once, collapses during compression and keeps moving while absent", async () => {
    await scene([pad({ motion: movement([3, 0, 0]), crumble: { delay: 4 * dt, returnDelay: 0.1 }, surface: { profile: "ice" } })], (world, entities, tick, level) => {
        const entity = entities[0]!, eid = entity.collisionEid!;
        const visual = world.storage(PlatformVisualState);
        expect(visual.lowTraction.get(eid)).toBe(1);
        expect(visual.moving.get(eid)).toBe(1);
        expect(visual.crumbling.get(eid)).toBe(1);
        expect(visual.returning.get(eid)).toBe(1);
        expect(visual.damageStage.get(eid)).toBe(1);
        const saved = JSON.stringify(entity.object);
        const sim = createSim({ x: 0, y: 1.001, z: 0 }); sim.body.vel.y = -1;
        expect(tick(sim)).toBeDefined();
        expect(sim.pogo.response.traction).toBeLessThan(1);
        // Later diagnostic queries are unrelated to the confirmed contact.
        findLandingSurface(world, { previousTip: { x: 100, y: 10, z: 100 }, currentTip: { x: 100, y: 9, z: 100 } });
        expect(world.resource(surfaceDiagnostics).acceptedObjectId).toBeUndefined();
        for (let i = 0; i < 4; i++) tick(sim, { ...NEUTRAL_CONTROLS, compress: true });
        expect(world.storage(PlatformPose).available.get(eid)).toBe(0);
        expect(visual.damageStage.get(eid)).toBe(10);
        expect(visual.available.get(eid)).toBe(0);
        expect(world.storage(Body).isEnabled.get(eid)).toBe(0);
        expect(sim.pogo.state).toBe("Airborne");
        expect(sim.pogo.support).toBeUndefined();
        expect(sim.pogo.lastLaunchedContactId).toBe(-1);
        expect(predictLanding(createSim(), level, platformTrajectories(world, entities))).toBeUndefined();
        const x = world.storage(PlatformPose).x.get(eid);
        const occupied = createSim({ x, y: 0.3, z: 0 });
        for (let i = 0; i < 20; i++) advancePlatforms(world, entities, occupied, dt);
        expect(world.storage(PlatformPose).available.get(eid)).toBe(0);
        expect(world.storage(PlatformPose).x.get(eid)).toBeGreaterThan(x);
        advancePlatforms(world, entities, createSim({ x: 100, y: 10, z: 0 }), dt);
        expect(world.storage(PlatformPose).available.get(eid)).toBe(1);
        expect(world.storage(Body).isEnabled.get(eid)).toBe(1);
        expect(world.storage(PlatformCrumbleState).phase.get(eid)).toBe(0);
        expect(visual.damageStage.get(eid)).toBe(1);
        expect(visual.available.get(eid)).toBe(1);
        expect(JSON.stringify(entity.object)).toBe(saved);
    });
});

test("collision queries, bounds, existing visual instances and indicators agree within each substep", async () => {
    await scene([pad({ motion: movement([3, 3, 0]), surface: { profile: "grip" } })], (world, entities, tick) => {
        const entity = entities[0]!, eid = entity.collisionEid!;
        const visual = world.create(), indicator = world.create();
        world.add(visual, Transform, { translation: [0.3, -0.1, 0.2], scale: [2, 3, 4] });
        world.add(indicator, Transform, { translation: [0, 0.025, 0], scale: [1, 0.035, 1] });
        entity.visualEids = [visual]; entity.indicatorEids = [indicator];
        capturePlatformVisuals(world, entity);
        const sim = createSim({ x: 100, y: 5, z: 0 });
        const hit = emptyQueryHit();
        for (let i = 1; i <= 4; i++) {
            tick(sim);
            const x = i * dt, y = i * dt;
            expect(world.storage(Transform).translation.x.get(visual)).toBeCloseTo(0.3 + x);
            expect(world.storage(Transform).translation.y.get(indicator)).toBeCloseTo(0.025 + y);
            expect(world.storage(LandingSurface).topY.get(eid)).toBeCloseTo(y);
            expect(castRayClosest(world, { x, y: y + 2, z: 0 }, { x: 0, y: -4, z: 0 }, hit)).toBe(true);
            expect(hit.point.y).toBeCloseTo(y);
            expect(entity.visualEids).toEqual([visual]);
        }
        resetPlatforms(world, entities, true);
        expect(world.storage(Transform).translation.x.get(visual)).toBeCloseTo(0.3);
        expect(world.storage(Transform).scale.y.get(visual)).toBe(3);
        expect(world.storage(PlatformMotionState).elapsed.get(eid)).toBe(0);
    });
});

test("prediction accounts for trajectories, current progress and countdown expiry", async () => {
    const object = pad({ transform: { position: [-5.1, -0.25, 0], scale: [1, 0.5, 1], rotation: [0, 0, 0, 1] }, motion: movement([24, 0, 0]) });
    await scene([object], (world, entities, tick, level) => {
        const sim = createSim({ x: 0, y: 3, z: 0 });
        const prediction = predictLanding(sim, level, platformTrajectories(world, entities));
        expect(predictLanding(sim, level)).toBeUndefined();
        expect(prediction?.position.y).toBe(0);
        for (let i = 0; i < 20; i++) tick(createSim({ x: 100, y: 5, z: 0 }));
        expect(predictLanding(sim, level, platformTrajectories(world, entities))).toBeUndefined();
        const snapshots = [{ id: object.id, available: true, elapsed: 0, collapseIn: 0.01 }];
        expect(predictLanding(sim, { ...level, objects: [pad()] }, snapshots)).toBeUndefined();
    });
});

test("earlier solid contact rejects landing and leaves crumble ready", async () => {
    const wall = pad({ id: "wall", transform: { position: [0.4, 2, 0], scale: [0.1, 8, 8], rotation: [0, 0, 0, 1] } });
    await scene([pad({ crumble: { delay: 0 } }), wall], (world, entities, tick) => {
        const sim = createSim({ x: 0, y: 1.1, z: 0 });
        sim.body.vel = { x: 30, y: -20, z: 0 };
        expect(tick(sim)).toBeUndefined();
        expect(sim.pogo.contactId).toBe(0);
        expect(world.storage(PlatformCrumbleState).phase.get(entities[0]!.collisionEid!)).toBe(0);
    });
});

test("fixed scheduling advances two platform substeps and death and restart reset both behaviors", async () => {
    const { Simulate } = await import("../src/game/simulation");
    const { GameplayProgression, initializeGameplay, restartGameplay } = await import("../src/game/gameplay-system");
    const { runtime } = await import("../src/game/state");
    const { gameplayProgress } = await import("../src/game/gameplay-state");
    const object = pad({ motion: { ...movement([3, 0, 0]), phase: 0.25 }, crumble: { delay: dt } });
    const app = await createApp({ defaults: false, plugins: [{
        name: "PlatformSchedulingCheck", dependencies: [PogoWorldCollisionPlugin], systems: [Simulate, GameplayProgression],
        initialize(world) {
            const state = world.resource(runtime);
            state.level = { id: "scheduling", spawnPosition: [0, 3, 0], failureBoundaryY: -10, objects: [object] };
            state.sim = createSim({ x: 0, y: 3, z: 0 });
            state.levelEntities = addLevelPhysics(world, state.level);
            for (const key of ["body", "pole", "tip", "validLandingMarker", "uncertainLandingMarker"] as const) {
                state[key] = world.create(); world.add(state[key], Transform);
            }
            initializeGameplay(world);
        },
    }] });
    try {
        const world = app.world, state = world.resource(runtime), eid = state.levelEntities[0]!.collisionEid!;
        world.step(Time.FIXED_DT);
        expect(state.sim.tick).toBe(2);
        expect(world.storage(PlatformMotionState).elapsed.get(eid)).toBeCloseTo(2 * dt);
        expect(world.storage(PlatformPose).x.get(eid)).toBeCloseTo(1.5 + 2 * dt);
        confirmPlatformContact(world, { platformId: eid, surfaceY: 0 });
        world.step(Time.FIXED_DT);
        expect(world.storage(PlatformPose).available.get(eid)).toBe(0);
        state.sim.body.pos.y = -11;
        world.step(Time.FIXED_DT);
        expect(state.sim.tick).toBe(0);
        expect(world.resource(gameplayProgress).event).toBe("failure");
        expect(world.storage(PlatformPose).x.get(eid)).toBeCloseTo(1.5);
        expect(world.storage(PlatformPose).available.get(eid)).toBe(1);
        expect(world.storage(PlatformCrumbleState).phase.get(eid)).toBe(0);
        world.step(Time.FIXED_DT);
        restartGameplay(world, true);
        expect(state.sim.tick).toBe(0);
        expect(world.storage(PlatformMotionState).elapsed.get(eid)).toBe(0);
        expect(world.storage(PlatformPose).x.get(eid)).toBeCloseTo(1.5);
    } finally { app.dispose(); }
});
