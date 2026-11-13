import { expect, test } from "bun:test";
import { createApp, Time } from "@dylanebert/shallot";
import { castRayClosest, emptyQueryHit } from "@dylanebert/shallot/standard/physics";
import { parseLevelDefinition, levelSurfaces, surfaceHeightAt } from "../src/content/level";
import { addLevelPhysics, findLandingSurface, PogoWorldCollisionPlugin } from "../src/game/physics";
import { findPlayerContact } from "../src/game/player-collision";
import { resetPlatforms, platformSupport, advancePlatforms } from "../src/game/platforms";
import { createSim, NEUTRAL_CONTROLS } from "../src/sim";
import { step } from "../src/game/simulation-step";
import { DEFAULT_TUNING } from "../src/config/gameplay";

const level = parseLevelDefinition({ id: "slope-check", spawnPosition: [0, 4, 0], failureBoundaryY: -20, objects: [
    { id: "ground", role: "ground", transform: { position: [100, -1, 100], scale: [10, 1, 10], rotation: [0, 0, 0, 1] }, visual: { kind: "box", material: "ground" }, collision: { kind: "box", dimensions: [1, 1, 1] } },
    { id: "ramp", role: "platform", surface: { profile: "ice" }, transform: { position: [0, -0.5, 0], scale: [20, 1, 10], rotation: [0, 0, 0, 1] }, visual: { kind: "box", material: "platform" }, collision: { kind: "slope", dimensions: [1, 1, 1], rise: 4 } },
] });

test("native slope geometry and pogo queries agree continuously, including rotated ramps", async () => {
    for (const angle of [0, Math.PI / 2]) {
        const changed = parseLevelDefinition({ ...level, objects: level.objects.map(object => object.id === "ramp" ? { ...object, transform: { ...object.transform, rotation: [0, Math.sin(angle / 2), 0, Math.cos(angle / 2)] } } : object) });
        const app = await createApp({ defaults: false, plugins: [PogoWorldCollisionPlugin], setup(world) { addLevelPhysics(world, changed); } });
        try {
            app.world.step(Time.FIXED_DT);
            const surface = levelSurfaces(changed).find(surface => surface.id === "ramp")!;
            for (let local = -9; local <= 9; local += 0.25) {
                const x = Math.cos(angle) * local, z = -Math.sin(angle) * local;
                const y = surfaceHeightAt(surface, x, z);
                const contact = findLandingSurface(app.world, { previousTip: { x, y: y + 0.2, z }, currentTip: { x, y: y - 0.2, z } });
                expect(contact?.surfaceY).toBeCloseTo(y, 5);
                const hit = emptyQueryHit();
                expect(castRayClosest(app.world, { x, y: y + 1, z }, { x: 0, y: -2, z: 0 }, hit)).toBe(true);
                expect(hit.point.y).toBeCloseTo(y, 4);
            }
        } finally { app.dispose(); }
    }
});

test("holding ice follows the continuous slope and releasing launches without charging", async () => {
    const app = await createApp({ defaults: false, plugins: [PogoWorldCollisionPlugin] });
    try {
        const world = app.world, entities = addLevelPhysics(world, level);
        world.step(Time.FIXED_DT);
        resetPlatforms(world, entities);
        const sim = createSim({ x: 4, y: 2, z: 0 });
        sim.body.vel.x = -2;
        let contacts = 0, holdTicks = 0;
        for (let tick = 0; tick < 180; tick++) {
            advancePlatforms(world, entities, sim, 1 / 120);
            const contact = step(sim, DEFAULT_TUNING, { ...NEUTRAL_CONTROLS, compress: true }, sweep => findLandingSurface(world, sweep), sweep => findPlayerContact(world, sweep), platformSupport(world, sim));
            if (contact) contacts++;
            if (sim.pogo.state === "Compression") {
                holdTicks++;
                expect(sim.pogo.contactTip.y).toBeCloseTo(sim.pogo.contactTip.x * 0.2, 5);
            }
        }
        expect(holdTicks).toBeGreaterThan(100);
        expect(contacts).toBe(1);
        expect(sim.body.vel.x).toBeLessThan(-2);
        expect(sim.pogo.chargeT).toBeGreaterThan(0);
        step(sim, DEFAULT_TUNING, NEUTRAL_CONTROLS, sweep => findLandingSurface(world, sweep), sweep => findPlayerContact(world, sweep), platformSupport(world, sim));
        expect(sim.pogo.state).toBe("Airborne");
        expect(sim.pogo.diagnostics.charge).toBe(0);
    } finally { app.dispose(); }
});
