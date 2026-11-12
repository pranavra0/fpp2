import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { createApp, Time, Transform } from "@dylanebert/shallot";
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

        expect(world.storage(Transform).translation.x.get(platform.eid)).toBe(8);
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
