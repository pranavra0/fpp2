import { expect, test } from "bun:test";
import { createApp, Time } from "@dylanebert/shallot";
import { DEFAULT_TUNING } from "../src/config/gameplay";
import type { LevelDefinition, LevelSurfaceObjectDefinition } from "../src/content/level";
import { addLevelPhysics, findLandingSurface, PogoWorldCollisionPlugin } from "../src/game/physics";
import { findPlayerContact } from "../src/game/player-collision";
import { createSim, NEUTRAL_CONTROLS, playerPose, type Controls, type Sim } from "../src/sim";
import { step } from "../src/game/simulation-step";

const box = (id: string, position: readonly [number, number, number], scale: readonly [number, number, number], mode?: "solid" | "one-way"): LevelSurfaceObjectDefinition => ({
    id, role: "platform", transform: { position, rotation: [0, 0, 0, 1], scale },
    visual: { kind: "box", material: "platform" }, collision: { kind: "box", dimensions: [1, 1, 1], ...(mode ? { mode } : {}) },
});

async function scene(objects: LevelSurfaceObjectDefinition[], run: (tick: (sim: Sim, controls?: Controls) => void) => void) {
    const app = await createApp({ defaults: false, plugins: [PogoWorldCollisionPlugin] });
    try {
        const level: LevelDefinition = { id: "collision", spawnPosition: [0, 2, 0], failureBoundaryY: -20, objects };
        addLevelPhysics(app.world, level);
        app.world.step(Time.FIXED_DT);
        run((sim, controls = NEUTRAL_CONTROLS) => step(sim, DEFAULT_TUNING, controls,
            sweep => findLandingSurface(app.world, sweep), sweep => findPlayerContact(app.world, sweep)));
    } finally { app.dispose(); }
}

test("body stops at solid platform undersides at high speed", async () => {
    await scene([box("roof", [0, 3, 0], [10, 0.2, 10])], tick => {
        const sim = createSim({ x: 0, y: 2, z: 0 });
        sim.body.vel.y = 200;
        tick(sim);
        expect(sim.body.pos.y + 0.41).toBeLessThanOrEqual(2.9);
        expect(sim.body.vel.y).toBe(0);
        expect(sim.pogo.contactId).toBe(0);
    });
});

test("body slides along solid walls without losing tangential velocity", async () => {
    await scene([box("wall", [1, 2, 0], [0.1, 8, 20])], tick => {
        const sim = createSim({ x: 0.6, y: 2, z: 0 });
        sim.body.vel = { x: 15, y: 1, z: 4 };
        for (let i = 0; i < 10; i++) tick(sim);
        expect(sim.body.pos.x + 0.325).toBeLessThanOrEqual(0.95);
        expect(sim.body.pos.z).toBeGreaterThan(0.3);
        expect(sim.body.vel.z).toBe(4);
    });
});

test("holding compression slides the rod off the supporting platform edge", async () => {
    const ice = { ...box("ice", [0, -0.2, 0], [4, 0.4, 4]), surface: { profile: "ice" as const } };
    await scene([ice], tick => {
        const sim = createSim({ x: 0, y: 1.001, z: 0 });
        sim.body.vel = { x: 10, y: -1, z: 0 };
        tick(sim, { ...NEUTRAL_CONTROLS, compress: true });
        expect(sim.pogo.state).toBe("Compression");
        for (let i = 0; i < 120 && sim.pogo.state === "Compression"; i++)
            tick(sim, { ...NEUTRAL_CONTROLS, compress: true });
        expect(sim.pogo.state).toBe("Airborne");
        expect(sim.body.vel.x).toBeGreaterThan(0);
        expect(sim.pogo.lastLaunchedContactId).toBe(-1);
        const contactId = sim.pogo.contactId;
        const departureX = sim.body.pos.x;
        for (let i = 0; i < 30; i++) tick(sim, { ...NEUTRAL_CONTROLS, compress: true });
        expect(sim.body.pos.x).toBeGreaterThan(departureX);
        expect(sim.pogo.contactId).toBe(contactId);
    });
});

test("extended and leaning rods collide along their length", async () => {
    await scene([box("wall", [-0.7, 1, 0], [0.1, 1, 8])], tick => {
        const sim = createSim({ x: 0, y: 3, z: 0 });
        sim.pole.length = 2.8;
        for (let i = 0; i < 120; i++) {
            sim.body.vel.y = 0;
            tick(sim, { ...NEUTRAL_CONTROLS, leanX: 1, extend: true });
            const pose = playerPose(sim);
            const t = (1 - pose.tip.y) / (pose.position.y - pose.tip.y);
            const shaftX = pose.tip.x + (pose.position.x - pose.tip.x) * t;
            expect(shaftX).toBeGreaterThan(-0.55);
        }
    });
});

test("extension cannot push the tip through solid ground and still creates a landing", async () => {
    await scene([box("floor", [0, -0.5, 0], [20, 1, 20])], tick => {
        const sim = createSim({ x: 0, y: 1.1, z: 0 });
        for (let i = 0; i < 30 && sim.pogo.contactId === 0; i++) tick(sim, { ...NEUTRAL_CONTROLS, extend: true });
        expect(sim.pogo.state).toBe("Compression");
        expect(playerPose(sim).tip.y).toBeCloseTo(0, 4);
    });
});

test("compression and grounded extension stop under a ceiling", async () => {
    await scene([box("floor", [0, -0.5, 0], [20, 1, 20]), box("roof", [0, 2, 0], [20, 0.2, 20])], tick => {
        const sim = createSim({ x: 0, y: 1.01, z: 0 });
        sim.body.vel.y = -1;
        for (let i = 0; i < 4 && sim.pogo.contactId === 0; i++) tick(sim);
        expect(sim.pogo.state).toBe("Compression");
        for (let i = 0; i < 80; i++) {
            tick(sim, { ...NEUTRAL_CONTROLS, compress: true, extend: true });
            expect(sim.body.pos.y + 0.41).toBeLessThanOrEqual(1.9);
            expect(playerPose(sim).tip.y).toBeGreaterThanOrEqual(-0.001);
        }
    });
});

test("one-way platforms allow upward traversal and catch downward tip landings", async () => {
    await scene([box("platform", [0, 3, 0], [10, 0.2, 10], "one-way")], tick => {
        const sim = createSim({ x: 0, y: 2, z: 0 });
        sim.body.vel.y = 10;
        let crossed = false;
        for (let i = 0; i < 240 && sim.pogo.contactId === 0; i++) {
            tick(sim);
            crossed ||= playerPose(sim).tip.y > 3.1;
        }
        expect(crossed).toBe(true);
        expect(sim.pogo.state).toBe("Compression");
        expect(sim.pogo.contactTip.y).toBeCloseTo(3.1);
    });
});

test("a nearly tangent rotating rod clears a platform corner without exhausting the sweep", async () => {
    const app = await createApp({ defaults: false, plugins: [PogoWorldCollisionPlugin] });
    try {
        addLevelPhysics(app.world, { id: "corner", spawnPosition: [0, 3, 0], failureBoundaryY: -20, objects: [box("platform", [0, 0, 0], [7, 0.6, 7])] });
        app.world.step(Time.FIXED_DT);
        const sweep = {
            previous: { position: { x: -2.4720279067211024, y: 1.2097308226824892, z: -3.124444275552662 }, tip: { x: -2.6258681497665197, y: 0.3000000119209289, z: -3.5100905274090053 } },
            current: { position: { x: -2.502654152457552, y: 1.1075709648776875, z: -3.1829094356453425 }, tip: { x: -2.6258681497665197, y: 0.3000000119209289, z: -3.5100905274090053 } },
        };
        expect(findPlayerContact(app.world, sweep)).toBeUndefined();
    } finally { app.dispose(); }
});
