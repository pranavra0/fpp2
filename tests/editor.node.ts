import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { Body, createApp, Shape, Time, Transform } from "@dylanebert/shallot";
import { parseLevelDefinition } from "../src/content/level";
import { DEFAULT_TUNING } from "../src/config/gameplay";
import {
    addLevelPhysics,
    findLandingSurface,
    PogoWorldCollisionPlugin,
    updateLevelEntity,
} from "../src/game/physics";
import { createSim, NEUTRAL_CONTROLS, step } from "../src/sim";

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
        platform.visualEid = platformVisualEid;
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
        entity.visualEid = triggerVisualEid;
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
