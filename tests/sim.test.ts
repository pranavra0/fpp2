import { describe, expect, test } from "bun:test";
import { createSim, DEFAULT_TUNING, NEUTRAL_CONTROLS, step } from "../src/sim";

describe("pogo simulation", () => {
    test("automatically bounces with stable launch height and unique contacts", () => {
        const sim = createSim(3);
        const apexHeights: number[] = [];
        const launchedContacts = new Set<number>();
        let previousVelocityY = sim.body.vel.y;
        let previousContactId = sim.pogo.contactId;
        let previousLaunchId = sim.pogo.lastLaunchedContactId;

        for (let tick = 0; tick < DEFAULT_TUNING.SIM_HZ * 10; tick++) {
            step(sim);
            if (sim.pogo.contactId !== previousContactId) {
                previousContactId = sim.pogo.contactId;
            }
            if (sim.pogo.lastLaunchedContactId !== previousLaunchId) {
                expect(launchedContacts.has(sim.pogo.lastLaunchedContactId)).toBe(false);
                launchedContacts.add(sim.pogo.lastLaunchedContactId);
                previousLaunchId = sim.pogo.lastLaunchedContactId;
            }
            if (previousVelocityY > 0 && sim.body.vel.y <= 0) {
                apexHeights.push(sim.body.pos.y);
            }
            previousVelocityY = sim.body.vel.y;
        }

        const expectedApex = 1 + DEFAULT_TUNING.LAUNCH_SPEED_MPS ** 2 / (2 * DEFAULT_TUNING.GRAVITY_MPS2);
        expect(launchedContacts.size).toBeGreaterThanOrEqual(5);
        expect(apexHeights.length).toBeGreaterThanOrEqual(5);
        for (const height of apexHeights) expect(Math.abs(height - expectedApex)).toBeLessThanOrEqual(0.001);
        for (let index = 1; index < apexHeights.length; index++) {
            expect(Math.abs(apexHeights[index]! - apexHeights[index - 1]!)).toBeLessThanOrEqual(0.001);
        }
    });

    test("charged launch follows pole lean and keeps horizontal carry", () => {
        const sim = createSim(1.1);
        sim.body.vel.y = -1;
        for (let tick = 0; tick < DEFAULT_TUNING.SIM_HZ; tick++) {
            step(sim);
            if (sim.pogo.state === "Compression") break;
        }
        expect(sim.pogo.state).toBe("Compression");

        const charging = { ...NEUTRAL_CONTROLS, leanX: 1, compress: true };
        for (let tick = 0; tick < DEFAULT_TUNING.SIM_HZ * 0.15; tick++) step(sim, DEFAULT_TUNING, charging);
        const carriedVelocity = sim.pogo.carryVelX;
        step(sim);

        expect(sim.pogo.state).toBe("Airborne");
        expect(sim.body.vel.x).toBeGreaterThan(carriedVelocity);
        expect(sim.body.vel.y).toBeGreaterThan(DEFAULT_TUNING.LAUNCH_SPEED_MPS);
        expect(sim.pogo.lastLaunchedContactId).toBe(sim.pogo.contactId);
    });

    test("buffers a charge press during descent", () => {
        const sim = createSim(1.12);
        sim.body.vel.y = -2;
        step(sim, DEFAULT_TUNING, { ...NEUTRAL_CONTROLS, jumpPressed: true });
        let launched = false;
        for (let tick = 0; tick < DEFAULT_TUNING.SIM_HZ; tick++) {
            step(sim);
            if (sim.pogo.lastLaunchedContactId === sim.pogo.contactId) {
                launched = true;
                break;
            }
        }

        expect(launched).toBe(true);
        expect(sim.pogo.chargeT).toBeGreaterThan(0);
        expect(sim.pogo.chargeT).toBeLessThan(DEFAULT_TUNING.INPUT_BUFFER_S);
    });
});
