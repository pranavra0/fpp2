import { expect, test } from "bun:test";
import { parseLevelDefinition } from "../src/content/level";
import { advanceCrumble, contactCrumble, motionOffset, type PlatformMotion } from "../src/platforms";
import { DEFAULT_TUNING } from "../src/config/gameplay";
import { createSim, NEUTRAL_CONTROLS, type LandingContact } from "../src/sim";
import { step } from "../src/game/simulation-step";
import prototype from "../public/levels/prototype.json";

const motion: PlatformMotion = { path: [[0, 0, 0], [3, 0, 0], [3, 4, 0]], duration: 7, phase: 0, mode: "ping-pong" };

test("path traversal uses distance, reverses at endpoints and applies cycle phase", () => {
    expect(motionOffset(motion, 1.5)).toEqual({ x: 1.5, y: 0, z: 0 });
    expect(motionOffset(motion, 5)).toEqual({ x: 3, y: 2, z: 0 });
    expect(motionOffset(motion, 7)).toEqual({ x: 3, y: 4, z: 0 });
    expect(motionOffset(motion, 9).y).toBeCloseTo(2);
    expect(motionOffset(motion, 14)).toEqual({ x: 0, y: 0, z: 0 });
    expect(motionOffset({ ...motion, phase: 0.5 }, 0)).toEqual({ x: 3, y: 4, z: 0 });
    const loop = { ...motion, mode: "loop" as const, duration: 12 };
    expect(motionOffset(loop, 9.5)).toEqual({ x: 1.5, y: 2, z: 0 });
    expect(motionOffset(loop, 12)).toEqual({ x: 0, y: 0, z: 0 });
    expect(() => motionOffset(motion, -1)).toThrow("elapsed");
});

test("crumble contacts do not restart timers and occupied space defers returning", () => {
    const config = { delay: 0.25, returnDelay: 0.5 };
    const counting = contactCrumble({ phase: "ready", remaining: 0 }, config);
    const halfway = advanceCrumble(counting, config, 0.125, false);
    expect(contactCrumble(halfway, config)).toEqual(halfway);
    const absent = advanceCrumble(halfway, config, 0.125, false);
    expect(absent).toEqual({ phase: "absent", remaining: 0.5 });
    expect(advanceCrumble(absent, config, 0.5, true)).toEqual({ phase: "absent", remaining: 0 });
    expect(advanceCrumble({ phase: "absent", remaining: 0 }, config, 0.01, false)).toEqual({ phase: "ready", remaining: 0 });
    expect(advanceCrumble(absent, { delay: 0.25 }, 100, false).phase).toBe("absent");
});

test("platform settings round trip and reject invalid data without adding runtime fields", () => {
    const level = parseLevelDefinition(prototype);
    const changed = (settings: object, index = 1) => ({ ...level, objects: level.objects.map((object, i) => i === index ? { ...object, ...settings } : object) });
    const saved = parseLevelDefinition(JSON.parse(JSON.stringify(changed({ motion, crumble: { delay: 0, returnDelay: 2 } }))));
    expect(saved.objects[1]).toMatchObject({ motion, crumble: { delay: 0, returnDelay: 2 } });
    for (const settings of [
        { motion: { ...motion, duration: 0 } }, { motion: { ...motion, phase: 1 } },
        { motion: { ...motion, mode: "other" } }, { motion: { ...motion, path: [[0, 0, 0]] } },
        { motion: { ...motion, path: [[1, 0, 0], [2, 0, 0]] } },
        { motion: { ...motion, path: [[0, 0, 0], [0, 0, 0]] } },
        { motion: { ...motion, path: [[0, 0, 0], [Infinity, 0, 0]] } },
        { motion: { ...motion, elapsed: 1 } }, { crumble: { delay: -1 } },
        { crumble: { delay: 1, returnDelay: NaN } }, { crumble: { delay: 1, phase: "ready" } },
    ]) expect(() => parseLevelDefinition(changed(settings))).toThrow("Invalid level data");
    expect(() => parseLevelDefinition(changed({ motion }, 0))).toThrow("only platforms");
    expect(() => parseLevelDefinition(changed({ crumble: { delay: 1 } }, 0))).toThrow("only platforms");
    expect(parseLevelDefinition(prototype).objects[1]).not.toHaveProperty("motion");
});

test("impact and launch use relative velocity once throughout a supported contact", () => {
    const sim = createSim({ x: 0, y: 1.001, z: 0 });
    sim.body.vel = { x: 4, y: -3, z: 0 };
    const contact: LandingContact = { surfaceY: 0, platformId: 1, fraction: 0.5, point: { x: 0, y: 0, z: 0 },
        platformPosition: { x: 0, y: -0.5, z: 0 }, platformVelocity: { x: 2, y: 3, z: 0 } };
    const query = () => contact;
    step(sim, DEFAULT_TUNING, NEUTRAL_CONTROLS, query);
    expect(sim.pogo.carryVelX).toBe(2);
    expect(sim.pogo.incomingDownwardSpeed).toBeGreaterThan(6);
    for (let i = 0; i < 10; i++) {
        step(sim, DEFAULT_TUNING, { ...NEUTRAL_CONTROLS, compress: true }, query, undefined,
            { platformId: 1, position: { x: 0, y: -0.5, z: 0 }, velocity: { x: 2, y: 3, z: 0 }, available: true });
        expect(sim.pogo.carryVelX).toBe(2);
    }
    step(sim, DEFAULT_TUNING, NEUTRAL_CONTROLS, query);
    expect(sim.body.vel.x).toBe(4);
    expect(sim.body.vel.y).toBeCloseTo(DEFAULT_TUNING.LAUNCH_SPEED_MPS + Math.max(DEFAULT_TUNING.CHARGE_BONUS_MPS, DEFAULT_TUNING.CHARGE_VERTICAL_BONUS_MPS) * (10 / DEFAULT_TUNING.SIM_HZ / DEFAULT_TUNING.CHARGE_MAX_S) + 3);
    expect(sim.pogo.support).toBeUndefined();
});

test("support loss releases high traction compression without launching", () => {
    const sim = createSim({ x: 0, y: 1.001, z: 0 });
    sim.body.vel.y = -1;
    step(sim, DEFAULT_TUNING, NEUTRAL_CONTROLS, () => ({ surfaceY: 0 }));
    expect(sim.pogo.state).toBe("Compression");
    step(sim, DEFAULT_TUNING, NEUTRAL_CONTROLS, () => undefined);
    expect(sim.pogo.state).toBe("Airborne");
    expect(sim.pogo.compressionM).toBe(0);
    expect(sim.pogo.lastLaunchedContactId).toBe(-1);
});

test("body collision rejection does not expose a provisional landing as confirmed", () => {
    const sim = createSim({ x: 0, y: 1.001, z: 0 });
    sim.body.vel.y = -1;
    let queried = false;
    const contact = step(sim, DEFAULT_TUNING, NEUTRAL_CONTROLS, () => ({ surfaceY: 0, platformId: 1 }), () => {
        if (queried) return undefined;
        queried = true;
        return { fraction: 0.1, normal: { x: -1, y: 0, z: 0 } };
    });
    expect(contact).toBeUndefined();
    expect(sim.pogo.contactId).toBe(0);
    expect(sim.pogo.state).toBe("Airborne");
});
