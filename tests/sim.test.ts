import { describe, expect, test } from "bun:test";
import { Time } from "@dylanebert/shallot";
import { DEFAULT_TUNING } from "../src/config/gameplay";
import {
    createSim,
    landingAlpha,
    NEUTRAL_CONTROLS,
    simulationSubstepCount,
    step,
    type LandingQuery,
} from "../src/sim";

const groundContact: LandingQuery = (sweep) =>
    landingAlpha(sweep, 0, DEFAULT_TUNING) === undefined ? undefined : { surfaceY: 0 };

function stepOnGround(
    sim: ReturnType<typeof createSim>,
    controls = NEUTRAL_CONTROLS,
): void {
    step(sim, DEFAULT_TUNING, controls, groundContact);
}

describe("pogo simulation", () => {
    test("automatically bounces with stable launch height and unique contacts", () => {
        const sim = createSim({ x: 0, y: 3, z: 0 });
        const apexHeights: number[] = [];
        const launchedContacts = new Set<number>();
        let previousVelocityY = sim.body.vel.y;
        let previousContactId = sim.pogo.contactId;
        let previousLaunchId = sim.pogo.lastLaunchedContactId;

        for (let tick = 0; tick < DEFAULT_TUNING.SIM_HZ * 10; tick++) {
            stepOnGround(sim);
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

        const expectedApex =
            1 + DEFAULT_TUNING.LAUNCH_SPEED_MPS ** 2 / (2 * DEFAULT_TUNING.GRAVITY_MPS2);
        expect(launchedContacts.size).toBeGreaterThanOrEqual(5);
        expect(apexHeights.length).toBeGreaterThanOrEqual(5);
        for (const height of apexHeights)
            expect(Math.abs(height - expectedApex)).toBeLessThanOrEqual(0.001);
        for (let index = 1; index < apexHeights.length; index++) {
            expect(Math.abs(apexHeights[index]! - apexHeights[index - 1]!)).toBeLessThanOrEqual(0.001);
        }
    });

    test("charged launch follows pole lean and keeps horizontal carry", () => {
        const sim = createSim({ x: 0, y: 1.1, z: 0 });
        sim.body.vel.y = -1;
        for (let tick = 0; tick < DEFAULT_TUNING.SIM_HZ; tick++) {
            stepOnGround(sim);
            if (sim.pogo.state === "Compression") break;
        }
        expect(sim.pogo.state).toBe("Compression");

        const charging = { ...NEUTRAL_CONTROLS, leanX: 1, compress: true };
        for (let tick = 0; tick < DEFAULT_TUNING.SIM_HZ * 0.15; tick++)
            stepOnGround(sim, charging);
        const carriedVelocity = sim.pogo.carryVelX;
        stepOnGround(sim);

        expect(sim.pogo.state).toBe("Airborne");
        expect(sim.body.vel.x).toBeGreaterThan(carriedVelocity);
        expect(sim.body.vel.y).toBeGreaterThan(DEFAULT_TUNING.LAUNCH_SPEED_MPS);
        expect(sim.pogo.lastLaunchedContactId).toBe(sim.pogo.contactId);
    });

    test("buffers a charge press during descent", () => {
        const sim = createSim({ x: 0, y: 1.12, z: 0 });
        sim.body.vel.y = -2;
        stepOnGround(sim, { ...NEUTRAL_CONTROLS, jumpPressed: true });
        let launched = false;
        for (let tick = 0; tick < DEFAULT_TUNING.SIM_HZ; tick++) {
            stepOnGround(sim);
            if (sim.pogo.lastLaunchedContactId === sim.pogo.contactId) {
                launched = true;
                break;
            }
        }

        expect(launched).toBe(true);
        expect(sim.pogo.chargeT).toBeGreaterThan(0);
        expect(sim.pogo.chargeT).toBeLessThan(DEFAULT_TUNING.INPUT_BUFFER_S);
    });

    test("engine fixed ticks contain only whole 120 Hz simulation steps", () => {
        expect(simulationSubstepCount(Time.FIXED_DT)).toBe(2);
        expect(simulationSubstepCount(1 / DEFAULT_TUNING.SIM_HZ)).toBe(1);
        expect(() => simulationSubstepCount(1 / 90)).toThrow(
            "the pogo simulation rate must divide the ECS fixed rate",
        );
    });
});
