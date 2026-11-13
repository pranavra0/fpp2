import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { Body, createApp, Shape, Time, Transform } from "@dylanebert/shallot";
import { parseLevelDefinition } from "../src/content/level";
import { DEFAULT_TUNING } from "../src/config/gameplay";
import {
    addLevelPhysics,
    findLandingSurface,
    LandingSurface,
    PogoWorldCollisionPlugin,
    updateLevelEntity,
} from "../src/game/physics";
import { createSim, NEUTRAL_CONTROLS, } from "../src/sim";
import { step } from "../src/game/simulation-step";

test("editing an authored platform updates its render transform and landing geometry", async () => {
    const raw = await readFile(new URL("../public/levels/prototype.json", import.meta.url), "utf8");
    const level = parseLevelDefinition(JSON.parse(raw));
    let entities: ReturnType<typeof addLevelPhysics> = [];
    const app = await createApp({
        defaults: false,
        plugins: [PogoWorldCollisionPlugin],
        setup(world) {
            entities = addLevelPhysics(world, level);
        },
    });
    try {
        const { world } = app;
        world.step(Time.FIXED_DT);
        const platform = entities.find((entity) => entity.id === "platform-1");
        if (!platform) throw new Error("platform-1 is missing from the test level");
        const platformVisualEid = world.create();
        platform.visualEids = [platformVisualEid];
        world.add(platformVisualEid, Transform, {
            translation: platform.object.transform.position,
            rotation: platform.object.transform.rotation,
            scale: platform.object.transform.scale,
        });
        const changed = {
            ...platform.object,
            transform: {
                ...platform.object.transform,
                position: [8, 2.42, -2] as const,
                scale: [6, 0.5, 5.5] as const,
            },
        };
        updateLevelEntity(world, platform, changed);
        world.step(Time.FIXED_DT);

        expect(platform.collisionEid).toBeDefined();
        expect(world.storage(Transform).translation.x.get(platform.collisionEid!)).toBe(8);
        expect(world.storage(Transform).translation.x.get(platformVisualEid)).toBe(8);
        expect(
            findLandingSurface(world, {
                previousTip: { x: 8, y: 2.7, z: -2 },
                currentTip: { x: 8, y: 2.5, z: -2 },
            })?.surfaceY,
        ).toBeCloseTo(2.67);
        expect(
            findLandingSurface(world, {
                previousTip: { x: 3, y: 2.7, z: -2 },
                currentTip: { x: 3, y: 2.5, z: -2 },
            }),
        ).toBeUndefined();

        const sim = createSim({ x: 8, y: 5, z: -2 });
        sim.body.vel.y = -1;
        for (let tick = 0; tick < 180 && sim.pogo.contactId === 0; tick++) {
            step(sim, DEFAULT_TUNING, NEUTRAL_CONTROLS, (sweep) => findLandingSurface(world, sweep));
        }
        expect(sim.pogo.state).toBe("Compression");
        expect(sim.pogo.contactTip.y).toBeCloseTo(2.67);
    } finally {
        app.dispose();
    }
});

test("editing a trigger updates its visible volume without adding physical collision", async () => {
    const raw = await readFile(new URL("../public/levels/first-level.json", import.meta.url), "utf8");
    const level = parseLevelDefinition(JSON.parse(raw));
    const checkpoint = level.objects.find((object) => object.role === "checkpoint");
    if (!checkpoint || checkpoint.collision.kind !== "trigger-box")
        throw new Error("checkpoint is missing from first-level");
    let entities: ReturnType<typeof addLevelPhysics> = [];
    const app = await createApp({
        defaults: false,
        plugins: [PogoWorldCollisionPlugin],
        setup(world) {
            entities = addLevelPhysics(world, level);
        },
    });
    try {
        const { world } = app;
        world.step(Time.FIXED_DT);
        const entity = entities.find((candidate) => candidate.id === checkpoint.id);
        if (!entity) throw new Error("checkpoint entity is missing");
        const triggerVisualEid = world.create();
        entity.visualEids = [triggerVisualEid];
        world.add(triggerVisualEid, Transform, {
            translation: checkpoint.transform.position,
            rotation: checkpoint.transform.rotation,
            scale: [
                checkpoint.transform.scale[0] * checkpoint.collision.dimensions[0],
                checkpoint.transform.scale[1] * checkpoint.collision.dimensions[1],
                checkpoint.transform.scale[2] * checkpoint.collision.dimensions[2],
            ],
        });
        const changed = {
            ...checkpoint,
            transform: {
                ...checkpoint.transform,
                position: [-1, 6, -9] as const,
                scale: [2, 3, 4] as const,
            },
        };
        updateLevelEntity(world, entity, changed);
        world.step(Time.FIXED_DT);

        expect(entity.collisionEid).toBeUndefined();
        expect(world.storage(Transform).translation.x.get(triggerVisualEid)).toBe(-1);
        expect(world.storage(Transform).translation.y.get(triggerVisualEid)).toBe(6);
        expect(world.storage(Transform).scale.x.get(triggerVisualEid)).toBe(2);
        expect(world.storage(Transform).scale.y.get(triggerVisualEid)).toBe(3);
        expect(world.storage(Transform).scale.z.get(triggerVisualEid)).toBe(4);
        expect(world.has(triggerVisualEid, Body)).toBe(false);
        expect(world.has(triggerVisualEid, Shape)).toBe(false);
        expect(entity.object.transform.position).toEqual([-1, 6, -9]);
        expect(parseLevelDefinition({ ...level, objects: level.objects.map((object) => object.id === checkpoint.id ? changed : object) }).objects.find((object) => object.id === checkpoint.id)?.collision.kind).toBe("trigger-box");
    } finally {
        app.dispose();
    }
});

test("editing collision mode persists and updates solid player contacts", async () => {
    const { findPlayerContact } = await import("../src/game/player-collision");
    const raw = await readFile(new URL("../public/levels/prototype.json", import.meta.url), "utf8");
    const level = parseLevelDefinition(JSON.parse(raw));
    const app = await createApp({ defaults: false, plugins: [PogoWorldCollisionPlugin] });
    try {
        const entities = addLevelPhysics(app.world, level);
        app.world.step(Time.FIXED_DT);
        const platform = entities.find(entity => entity.id === "platform-1")!;
        if (platform.object.role !== "platform") throw new Error("Expected platform");
        const sweep = {
            previous: { position: { x: 3, y: 1.5, z: -2 }, tip: { x: 3, y: 0.5, z: -2 } },
            current: { position: { x: 3, y: 3, z: -2 }, tip: { x: 3, y: 2, z: -2 } },
        };
        expect(findPlayerContact(app.world, sweep)).toBeDefined();
        const changed = { ...platform.object, collision: { ...platform.object.collision, mode: "one-way" as const } };
        const saved = parseLevelDefinition(JSON.parse(JSON.stringify({ ...level, objects: level.objects.map(object => object.id === platform.id ? changed : object) })));
        updateLevelEntity(app.world, platform, saved.objects.find(object => object.id === platform.id)!);
        expect(findPlayerContact(app.world, sweep)).toBeUndefined();
        expect(findLandingSurface(app.world, { previousTip: { x: 3, y: 2.7, z: -2 }, currentTip: { x: 3, y: 2.5, z: -2 } })).toBeDefined();
        updateLevelEntity(app.world, platform, { ...changed, collision: { ...changed.collision, mode: "solid" } });
        expect(findPlayerContact(app.world, sweep)).toBeDefined();
    } finally { app.dispose(); }
});

test("combined platform edits preserve authored settings while runtime reset restores poses and availability", async () => {
    const { advancePlatforms, confirmPlatformContact, resetPlatforms } = await import("../src/game/platforms");
    const { PlatformPose, PlatformMotionState, PlatformCrumbleState } = await import("../src/game/platform-components");
    const raw = await readFile(new URL("../public/levels/prototype.json", import.meta.url), "utf8");
    const level = parseLevelDefinition(JSON.parse(raw));
    const app = await createApp({ defaults: false, plugins: [PogoWorldCollisionPlugin] });
    try {
        const world = app.world, entities = addLevelPhysics(world, level);
        const entity = entities.find(entry => entry.id === "platform-1")!;
        if (entity.object.role !== "platform") throw new Error("Expected a platform");
        const object = { ...entity.object, collision: { ...entity.object.collision, mode: "one-way" as const },
            surface: { profile: "ice" as const }, motion: { path: [[0, 0, 0], [3, 2, 0]] as const, duration: 2, phase: 0.25, mode: "ping-pong" as const },
            crumble: { delay: 0.01, returnDelay: 1 },
        };
        const saved = parseLevelDefinition(JSON.parse(JSON.stringify({ ...level, objects: level.objects.map(entry => entry.id === entity.id ? object : entry) })));
        updateLevelEntity(world, entity, saved.objects.find(entry => entry.id === entity.id)!);
        world.step(Time.FIXED_DT);
        const eid = entity.collisionEid!;
        resetPlatforms(world, entities);
        const absentPlayer = createSim({ x: 100, y: 20, z: 0 });
        advancePlatforms(world, entities, absentPlayer, 0.1);
        expect(world.storage(PlatformPose).x.get(eid)).toBeGreaterThan(object.transform.position[0]);
        confirmPlatformContact(world, { platformId: eid, surfaceY: 0 });
        advancePlatforms(world, entities, absentPlayer, 0.1);
        expect(world.storage(PlatformPose).available.get(eid)).toBe(0);
        expect(JSON.stringify(entity.object)).toBe(JSON.stringify(saved.objects.find(entry => entry.id === entity.id)));
        resetPlatforms(world, entities, true);
        expect(world.storage(PlatformPose).x.get(eid)).toBe(object.transform.position[0]);
        expect(world.storage(PlatformPose).available.get(eid)).toBe(1);
        expect(world.storage(PlatformMotionState).elapsed.get(eid)).toBe(0);
        expect(world.storage(PlatformCrumbleState).phase.get(eid)).toBe(0);
        expect(world.storage(LandingSurface).topY.get(eid)).toBeCloseTo(object.transform.position[1] + object.transform.scale[1] / 2);
    } finally { app.dispose(); }
});
