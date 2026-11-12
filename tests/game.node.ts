import { expect, setDefaultTimeout, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { createApp, Time } from "@dylanebert/shallot";
import { TIMEOUT } from "@dylanebert/shallot/testing";
import { DEFAULT_TUNING } from "../src/config/gameplay";
import { parseLevelDefinition } from "../src/content/level";
import {
    addLevelPhysics,
    destroyLevelEntities,
    findLandingSurface,
    LandingSurface,
    PogoWorldCollisionPlugin,
} from "../src/game/physics";
import { createSim, NEUTRAL_CONTROLS, step, type LandingSweep } from "../src/sim";

setDefaultTimeout(TIMEOUT.node);

async function readPrototypeLevel() {
    const text = await readFile(new URL("../public/levels/prototype.json", import.meta.url), "utf8");
    return parseLevelDefinition(JSON.parse(text));
}

function sweep(
    previousTip: LandingSweep["previousTip"],
    currentTip: LandingSweep["currentTip"],
): LandingSweep {
    return {
        previousTip,
        currentTip,
    };
}

test("Shallot static-shape queries preserve platform and ground landing bounds", async () => {
    const level = await readPrototypeLevel();
    const app = await createApp({
        defaults: false,
        plugins: [PogoWorldCollisionPlugin],
        setup(world) {
            addLevelPhysics(world, level);
        },
    });
    try {
        const { world } = app;
        world.step(Time.FIXED_DT);
        expect(
            findLandingSurface(
                world,
                sweep({ x: 3, y: 2.7, z: -2 }, { x: 3, y: 2.5, z: -2 }),
            )?.surfaceY,
        ).toBeCloseTo(2.6);
        expect(
            findLandingSurface(
                world,
                sweep({ x: 5.11, y: 2.7, z: -2 }, { x: 5.11, y: 2.5, z: -2 }),
            )?.surfaceY,
        ).toBeCloseTo(2.6);
        expect(
            findLandingSurface(
                world,
                sweep({ x: 5.11, y: 2.7, z: 0.86 }, { x: 5.11, y: 2.5, z: 0.86 }),
            )?.surfaceY,
        ).toBeCloseTo(2.6);
        expect(
            findLandingSurface(
                world,
                sweep({ x: 5.13, y: 2.7, z: -2 }, { x: 5.13, y: 2.5, z: -2 }),
            ),
        ).toBeUndefined();
        expect(
            findLandingSurface(
                world,
                sweep({ x: 13.9, y: 0.1, z: 0 }, { x: 13.9, y: -0.1, z: 0 }),
            )?.surfaceY,
        ).toBeCloseTo(0);
        expect(
            findLandingSurface(
                world,
                sweep({ x: 14.05, y: 0.1, z: 0 }, { x: 14.05, y: -0.1, z: 0 }),
            ),
        ).toBeUndefined();
        expect(
            findLandingSurface(
                world,
                sweep({ x: 3, y: 2.3, z: -2 }, { x: 3, y: 2.1, z: -2 }),
            ),
        ).toBeUndefined();
        expect(
            findLandingSurface(
                world,
                sweep({ x: 3, y: 2.7, z: -2 }, { x: 3, y: 2.65, z: -2 }),
            )?.surfaceY,
        ).toBeCloseTo(2.6);
        expect(
            findLandingSurface(
                world,
                sweep({ x: 3, y: 2.55, z: -2 }, { x: 3, y: 2.52, z: -2 }),
            )?.surfaceY,
        ).toBeCloseTo(2.6);
        expect(
            findLandingSurface(
                world,
                sweep({ x: 3, y: 2.53, z: -2 }, { x: 3, y: 2.5, z: -2 }),
            ),
        ).toBeUndefined();
        expect(
            findLandingSurface(
                world,
                sweep({ x: 3, y: 2.5, z: -2 }, { x: 3, y: 2.7, z: -2 }),
            ),
        ).toBeUndefined();
    } finally {
        app.dispose();
    }
});

test("rotated platforms and independent collision dimensions come from level data", async () => {
    const level = await readFile(
        new URL("../public/levels/alternate.json", import.meta.url),
        "utf8",
    ).then((text) => parseLevelDefinition(JSON.parse(text)));
    const app = await createApp({
        defaults: false,
        plugins: [PogoWorldCollisionPlugin],
        setup(world) {
            addLevelPhysics(world, level);
        },
    });
    try {
        const { world } = app;
        world.step(Time.FIXED_DT);

        expect(
            findLandingSurface(
                world,
                sweep({ x: 4.75, y: 4.76, z: -2 }, { x: 4.75, y: 4.6, z: -2 }),
            )?.surfaceY,
        ).toBeCloseTo(4.664);
        expect(
            findLandingSurface(
                world,
                sweep({ x: 1.4, y: 2.7, z: 1 }, { x: 1.4, y: 2.5, z: 1 }),
            ),
        ).toBeUndefined();
    } finally {
        app.dispose();
    }
});

test("destroying level entities removes their physics surfaces", async () => {
    const level = await readPrototypeLevel();
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
        expect(
            findLandingSurface(
                world,
                sweep({ x: 0, y: 0.1, z: 0 }, { x: 0, y: -0.1, z: 0 }),
            )?.surfaceY,
        ).toBeCloseTo(0);

        const entityIds = entities.flatMap((entity) =>
            entity.collisionEid === undefined ? [] : [entity.collisionEid],
        );
        destroyLevelEntities(world, entities);
        world.step(Time.FIXED_DT);
        expect(entities).toHaveLength(0);
        expect(entityIds.every((eid) => !world.has(eid, LandingSurface))).toBe(true);
        expect(
            findLandingSurface(
                world,
                sweep({ x: 0, y: 0.1, z: 0 }, { x: 0, y: -0.1, z: 0 }),
            ),
        ).toBeUndefined();
    } finally {
        app.dispose();
    }
});

test("fixed-step pogo movement lands and launches through Shallot collision queries", async () => {
    const level = await readPrototypeLevel();
    const app = await createApp({
        defaults: false,
        plugins: [PogoWorldCollisionPlugin],
        setup(world) {
            addLevelPhysics(world, level);
        },
    });
    try {
        const { world } = app;
        world.step(Time.FIXED_DT);
        const sim = createSim({ x: 0, y: 3, z: 0 });
        const contacts = new Set<number>();
        let previousLaunch = sim.pogo.lastLaunchedContactId;
        let firstLaunchVelocity: number | undefined;
        for (let tick = 0; tick < DEFAULT_TUNING.SIM_HZ * 5; tick++) {
            step(sim, DEFAULT_TUNING, NEUTRAL_CONTROLS, (path) =>
                findLandingSurface(world, path),
            );
            if (sim.pogo.lastLaunchedContactId !== previousLaunch) {
                contacts.add(sim.pogo.lastLaunchedContactId);
                previousLaunch = sim.pogo.lastLaunchedContactId;
                firstLaunchVelocity ??= sim.body.vel.y;
            }
        }
        expect(contacts.size).toBeGreaterThanOrEqual(2);
        expect(sim.pogo.contactId).toBeGreaterThanOrEqual(2);
        expect(firstLaunchVelocity).toBeCloseTo(DEFAULT_TUNING.LAUNCH_SPEED_MPS, 3);
    } finally {
        app.dispose();
    }
});


test("charged launch through Shallot contact retains lean and horizontal carry", async () => {
    const level = await readPrototypeLevel();
    const app = await createApp({
        defaults: false,
        plugins: [PogoWorldCollisionPlugin],
        setup(world) {
            addLevelPhysics(world, level);
        },
    });
    try {
        const { world } = app;
        world.step(Time.FIXED_DT);
        const sim = createSim({ x: 0, y: 1.1, z: 0 });
        sim.body.vel.y = -1;
        for (let tick = 0; tick < DEFAULT_TUNING.SIM_HZ; tick++) {
            step(sim, DEFAULT_TUNING, NEUTRAL_CONTROLS, (path) =>
                findLandingSurface(world, path),
            );
            if (sim.pogo.state === "Compression") break;
        }
        expect(sim.pogo.state).toBe("Compression");

        const charging = { ...NEUTRAL_CONTROLS, leanX: 1, compress: true };
        for (let tick = 0; tick < DEFAULT_TUNING.SIM_HZ * 0.15; tick++) {
            step(sim, DEFAULT_TUNING, charging, (path) => findLandingSurface(world, path));
        }
        const carriedVelocity = sim.pogo.carryVelX;
        step(sim, DEFAULT_TUNING, NEUTRAL_CONTROLS, (path) => findLandingSurface(world, path));

        expect(sim.pogo.state).toBe("Airborne");
        expect(sim.body.vel.x).toBeGreaterThan(carriedVelocity);
        expect(sim.body.vel.y).toBeGreaterThan(DEFAULT_TUNING.LAUNCH_SPEED_MPS);
        expect(sim.pogo.lastLaunchedContactId).toBe(sim.pogo.contactId);
    } finally {
        app.dispose();
    }
});
