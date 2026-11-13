import { expect, test } from "bun:test";
import { createApp, Time, Transform } from "@dylanebert/shallot";
import { castRayClosest, emptyQueryHit } from "@dylanebert/shallot/standard/physics";
import { runtime } from "../src/game/state";
import { recoverGameState } from "../src/game/recovery";
import { PogoWorldCollisionPlugin, addLevelPhysics, surfaceDiagnostics } from "../src/game/physics";
import { platformPaths, PlatformPose } from "../src/game/platform-components";
import { capturePlatformVisuals } from "../src/game/platforms";
import { Simulate } from "../src/game/simulation";
import { initializeGameplay } from "../src/game/gameplay-system";
import type { LevelDefinition } from "../src/content/level";

const level: LevelDefinition = { id: "recovery", spawnPosition: [0, 3, 0], failureBoundaryY: -10, objects: [
    { id: "moving", role: "platform", motion: { path: [[0, 0, 0], [2, 0, 0]], duration: 4, phase: 0, mode: "ping-pong" }, crumble: { delay: 2, returnDelay: 2 }, transform: { position: [0, -0.25, 0], rotation: [0, 0, 0, 1], scale: [10, 0.5, 10] }, visual: { kind: "box", material: "platform" }, collision: { kind: "box", dimensions: [1, 1, 1] } },
] };

test("snapshot restores player, paths, confirmed contact state, native queries and visual children", async () => {
    const app = await createApp({ defaults: false, plugins: [{ name: "RecoveryFlow", dependencies: [PogoWorldCollisionPlugin], recovery: recoverGameState, systems: [Simulate], initialize(world) {
        const state = world.resource(runtime);
        state.level = level;
        state.levelEntities = addLevelPhysics(world, level);
        for (const key of ["body", "pole", "tip", "validLandingMarker", "uncertainLandingMarker"] as const) { state[key] = world.create(); world.add(state[key], Transform); }
        const entity = state.levelEntities[0]!;
        const visual = world.create();
        world.add(visual, Transform, { translation: level.objects[0]!.transform.position });
        entity.visualEids = [visual];
        capturePlatformVisuals(world, entity);
        initializeGameplay(world);
    } }] });
    try {
        const world = app.world;
        world.step(Time.FIXED_DT);
        const image = world.snapshot();
        for (let tick = 0; tick < 60; tick++) world.step(Time.FIXED_DT);
        const expected = structuredClone(world.resource(runtime).sim);
        const eid = world.resource(runtime).levelEntities[0]!.collisionEid!;
        const expectedX = world.storage(PlatformPose).x.get(eid);
        world.resource(platformPaths).clear();
        world.resource(surfaceDiagnostics).ids.clear();
        world.resource(runtime).level = { ...level, objects: [] };
        world.restore(image);
        expect(world.resource(platformPaths).has(eid)).toBe(true);
        expect(world.resource(surfaceDiagnostics).ids.get(eid)).toBe("moving");
        for (let tick = 0; tick < 60; tick++) world.step(Time.FIXED_DT);
        expect(world.resource(runtime).sim).toEqual(expected);
        expect(world.storage(PlatformPose).x.get(eid)).toBe(expectedX);
        const visual = world.resource(runtime).levelEntities[0]!.visualEids![0]!;
        expect(world.storage(Transform).translation.x.get(visual)).toBeCloseTo(expectedX);
        const hit = emptyQueryHit();
        expect(castRayClosest(world, { x: expectedX, y: 3, z: 0 }, { x: 0, y: -4, z: 0 }, hit)).toBe(true);
        expect(hit.point.y).toBeCloseTo(0);
        world.restore(image);
        expect(world.resource(runtime).sim.tick).toBe(2);
    } finally { app.dispose(); }
});
