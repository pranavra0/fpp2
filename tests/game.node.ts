import { expect, setDefaultTimeout, test } from "bun:test";
import { createApp, Time } from "@dylanebert/shallot";
import { TIMEOUT } from "@dylanebert/shallot/testing";
import { DEFAULT_TUNING } from "../src/config/gameplay";
import { addLevelPhysics, findLandingSurface, PogoWorldCollisionPlugin } from "../src/game/physics";
import { createSim, NEUTRAL_CONTROLS, step, type LandingSweep } from "../src/sim";

setDefaultTimeout(TIMEOUT.node);

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
    const app = await createApp({
        defaults: false,
        plugins: [PogoWorldCollisionPlugin],
        setup(world) {
            addLevelPhysics(world);
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

test("fixed-step pogo movement lands and launches through Shallot collision queries", async () => {
    const app = await createApp({
        defaults: false,
        plugins: [PogoWorldCollisionPlugin],
        setup(world) {
            addLevelPhysics(world);
        },
    });
    try {
        const { world } = app;
        world.step(Time.FIXED_DT);
        const sim = createSim(3);
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
    const app = await createApp({
        defaults: false,
        plugins: [PogoWorldCollisionPlugin],
        setup(world) {
            addLevelPhysics(world);
        },
    });
    try {
        const { world } = app;
        world.step(Time.FIXED_DT);
        const sim = createSim(1.1);
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
