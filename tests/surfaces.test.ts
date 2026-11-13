import { expect, test } from "bun:test";
import { DEFAULT_TUNING as tuning } from "../src/config/gameplay";
import { createSim, effectiveCharge, landingAlpha, NEUTRAL_CONTROLS, type Sim, type Controls } from "../src/sim";
import { step } from "../src/game/simulation-step";
import { DEFAULT_SURFACE, parseAuthoredSurface, parseSurfaceSnapshot, resolveSurface, SURFACE_PROFILES, validateSurfaceResponse, type SurfaceResponse, type SurfaceSnapshot } from "../src/surfaces";
import { parseLevelDefinition } from "../src/content/level";
import prototype from "../public/levels/prototype.json";
import { crumbleDamageStage, surfaceVisualProperties } from "../src/game/platform-visuals";

const snapshot = (response: SurfaceResponse): SurfaceSnapshot => ({ ...response, directionX: 0, directionZ: 0 });
function tick(sim: Sim, response: SurfaceSnapshot, controls = NEUTRAL_CONTROLS) {
    step(sim, tuning, controls, sweep => landingAlpha(sweep, 0) === undefined ? undefined : { surfaceY: 0, response });
}
function contact(response: SurfaceSnapshot, fall = 1, carry = 10) {
    const sim = createSim({ x: 0, y: tuning.POLE_LENGTH_M + 0.001, z: 0 });
    sim.body.vel = { x: carry, y: -fall, z: 0 };
    tick(sim, response);
    expect(sim.pogo.state).toBe("Compression");
    return sim;
}
function depart(sim: Sim, response: SurfaceSnapshot, controls = NEUTRAL_CONTROLS) {
    for (let i = 0; i < 120 && sim.pogo.state === "Compression"; i++) tick(sim, response, controls);
    expect(sim.pogo.state).toBe("Airborne");
    return sim;
}

test("surface coefficient validation rejects invalid ranges, nonfinite and missing values", () => {
    for (const profile of Object.values(SURFACE_PROFILES)) expect(() => validateSurfaceResponse(profile)).not.toThrow();
    for (const [key, values] of Object.entries({ bounceScale: [0, -1, NaN], restitution: [-1, 1.01, Infinity], impactSpeedLimit: [0], momentumRetention: [-0.01, 1.01], contactDrag: [-1], traction: [-1, 1.01, NaN, Infinity], minimumDwell: [-1, 0.301], directionalSpeed: [-1], maximumVerticalSpeed: [0, -1, Infinity] }))
        for (const value of values) expect(() => validateSurfaceResponse({ ...DEFAULT_SURFACE, [key]: value })).toThrow();
    expect(() => validateSurfaceResponse({} as SurfaceResponse)).toThrow();
    expect(() => validateSurfaceResponse({ ...DEFAULT_SURFACE, restitution: 1, momentumRetention: 0, minimumDwell: 0.3 })).not.toThrow();
});

test("directional launch composes with other profiles and visual cues follow resolved coefficients", () => {
    const mixed = parseAuthoredSurface({ profile: "ice", directionXZ: [3, 4], overrides: { directionalSpeed: 6, bounceScale: 1.4 } });
    expect(resolveSurface(mixed)).toMatchObject({ traction: 0.12, directionalSpeed: 6, directionX: 0.6, directionZ: 0.8, bounceScale: 1.4 });
    expect(surfaceVisualProperties(resolveSurface(mixed))).toEqual({ lowTraction: true, rebound: true, grip: false, directionalLaunch: true, holdUntilRelease: true });
    const disabled = parseAuthoredSurface({ profile: "elastic", overrides: { bounceScale: 1, restitution: 0 } });
    expect(surfaceVisualProperties(resolveSurface(disabled)).rebound).toBe(false);
    expect(() => parseAuthoredSurface({ profile: "grip", overrides: { directionalSpeed: 2 } })).toThrow();
});

test("crumble damage stages include ready, countdown boundaries, zero delay, and invalid timers", () => {
    expect(crumbleDamageStage(4, 4, "ready")).toBe(1);
    expect(crumbleDamageStage(4, 4, "counting")).toBe(1);
    expect(crumbleDamageStage(4, 2, "counting")).toBe(5);
    expect(crumbleDamageStage(4, 0, "counting")).toBe(10);
    expect(crumbleDamageStage(0, 0, "counting")).toBe(10);
    expect(crumbleDamageStage(1, 4, "absent")).toBe(10);
    expect(() => crumbleDamageStage(1, 2, "counting")).toThrow();
    expect(() => crumbleDamageStage(1, -1, "ready")).toThrow();
});

test("bounce strength and restitution produce independent height outcomes with fixed pole length", () => {
    const base = snapshot(DEFAULT_SURFACE);
    const weak = snapshot({ ...DEFAULT_SURFACE, bounceScale: 0.5 });
    const strong = snapshot({ ...DEFAULT_SURFACE, bounceScale: 1.15 });
    const rebound = snapshot({ ...DEFAULT_SURFACE, restitution: 0.85 });
    const launchY = (r: SurfaceSnapshot, fall = 1) => depart(contact(r, fall, 0), r).body.vel.y;
    expect(launchY(weak)).toBe(launchY(base) * 0.5);
    expect(launchY(strong)).toBe(launchY(base) * 1.15);
    expect(launchY(rebound, 1)).toBe(launchY(base));
    expect(launchY(rebound, 18)).toBeGreaterThan(launchY(base));
    expect(launchY(rebound, 100)).toBeCloseTo(18 * 0.85);
    expect(launchY(base, 100)).toBe(launchY(base));
    const capped = snapshot({ ...DEFAULT_SURFACE, bounceScale: 3, maximumVerticalSpeed: 12 });
    const sim = depart(contact(capped), capped);
    expect(sim.body.vel.y).toBe(12);
    expect(sim.pogo.diagnostics.verticalSaturated).toBe(true);
});

test("impact is sampled at interpolated contact and the response is copied once", () => {
    const response = snapshot(SURFACE_PROFILES.elastic);
    const sim = contact(response, 10);
    expect(sim.pogo.incomingDownwardSpeed).toBeGreaterThan(10);
    expect(sim.pogo.incomingDownwardSpeed).toBeLessThan(10 + tuning.GRAVITY_MPS2 / tuning.SIM_HZ);
    response.bounceScale = 0.1;
    expect(sim.pogo.response.bounceScale).toBe(1.15);
    tick(sim, response);
    expect(sim.pogo.response.bounceScale).toBe(1.15);
});

test("retention applies once and drag compounds with contact duration", () => {
    const retention = snapshot({ ...DEFAULT_SURFACE, momentumRetention: 0.35 });
    const sim = contact(retention);
    expect(sim.pogo.carryVelX).toBeCloseTo(3.5);
    for (let i = 0; i < 8; i++) tick(sim, retention, { ...NEUTRAL_CONTROLS, compress: true });
    expect(sim.pogo.carryVelX).toBeCloseTo(3.5);
    const drag = snapshot({ ...DEFAULT_SURFACE, contactDrag: 4 });
    const short = contact(drag), long = contact(drag);
    for (let i = 0; i < 6; i++) tick(short, drag, { ...NEUTRAL_CONTROLS, compress: true });
    for (let i = 0; i < 12; i++) tick(long, drag, { ...NEUTRAL_CONTROLS, compress: true });
    expect(long.pogo.carryVelX).toBeLessThan(short.pogo.carryVelX);
    expect(long.pogo.carryVelX / 10).toBeCloseTo((short.pogo.carryVelX / 10) ** 2);
    const stopped = snapshot({ ...DEFAULT_SURFACE, momentumRetention: 0 });
    expect(contact(stopped).pogo.carryVelX).toBe(0);
});

test("release and full-charge requests survive dwell and launch once", () => {
    for (const full of [false, true]) {
        const response = snapshot({ ...DEFAULT_SURFACE, minimumDwell: 0.3 });
        const sim = contact(response);
        sim.pogo.chargeT = full ? tuning.CHARGE_MAX_S : 0;
        tick(sim, response, { ...NEUTRAL_CONTROLS, compress: true });
        tick(sim, response);
        expect(sim.pogo.pendingLaunch).toBe(full ? "full-charge" : "release");
        for (let i = 0; i < 33; i++) tick(sim, response, { ...NEUTRAL_CONTROLS, compress: true });
        expect(sim.pogo.state).toBe("Compression");
        tick(sim, response, { ...NEUTRAL_CONTROLS, compress: true });
        expect(sim.pogo.state).toBe("Airborne");
        expect(sim.pogo.diagnostics.dwell).toBeCloseTo(0.3);
        expect(sim.pogo.diagnostics.charge).toBeLessThanOrEqual(1);
        const id = sim.pogo.lastLaunchedContactId;
        tick(sim, response);
        expect(sim.pogo.lastLaunchedContactId).toBe(id);
    }
});

test("direction is applied once and complete horizontal velocity is limited", () => {
    for (const [direction, expected] of [[[1, 0], 14], [[-1, 0], 6], [[0, 1], Math.hypot(10, 4)]] as const) {
        const response = resolveSurface({ profile: "directional", directionXZ: direction });
        const sim = depart(contact(response), response);
        expect(Math.hypot(sim.body.vel.x, sim.body.vel.z)).toBeCloseTo(expected);
        const velocity = { ...sim.body.vel };
        tick(sim, response);
        expect(sim.body.vel.x).toBe(velocity.x);
        expect(sim.body.vel.z).toBe(velocity.z);
    }
    const response = resolveSurface({ profile: "directional", directionXZ: [1, 0] });
    const sim = depart(contact(response, 1, 18), response);
    expect(sim.body.vel.x).toBe(tuning.MAX_HORIZONTAL_SPEED_MPS);
    expect(sim.pogo.diagnostics.horizontalSaturated).toBe(true);
    expect(createSim().pogo).toMatchObject({ response: resolveSurface(), incomingDownwardSpeed: 0, pendingLaunch: undefined });
});

test("production level boundary preserves omission and validates profile and local direction", () => {
    expect(parseLevelDefinition(prototype)).toEqual(prototype);
    for (const surface of [{ profile: "ice" }, { profile: "elastic" }, { profile: "grip" }, { profile: "default" }, { profile: "directional", directionXZ: [3, 4] }]) {
        const raw = structuredClone(prototype) as any;
        raw.objects[0].surface = surface;
        const parsed = parseLevelDefinition(raw);
        expect(parseLevelDefinition(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed);
        if (surface.profile === "directional") expect((parsed.objects[0] as any).surface.directionXZ).toEqual([0.6, 0.8]);
    }
    for (const surface of [{ profile: "unknown" }, { profile: "elastic", overrides: { directionalSpeed: 2 } }, { profile: "directional" }, { profile: "directional", directionXZ: [0, 0] }, { profile: "directional", directionXZ: [Infinity, 0] }, { profile: "default", bounceScale: 2 }]) {
        const raw = structuredClone(prototype) as any;
        raw.objects[0].surface = surface;
        expect(() => parseLevelDefinition(raw)).toThrow();
    }
    const raw = structuredClone(prototype) as any;
    raw.objects[0] = { ...raw.objects[0], role: "goal", visual: { kind: "box", material: "goal" }, collision: { kind: "trigger-box", dimensions: [1, 1, 1] }, surface: { profile: "grip" } };
    expect(() => parseLevelDefinition(raw)).toThrow();
});

test("neutral movement matches the pre-surface trace across contacts and controls", () => {
    const sim = createSim({ x: 0, y: 8, z: 0 });
    const trace = [];
    for (let i = 0; i < 2400; i++) {
        step(sim, tuning, { leanX: Math.sin(i * 0.01), leanZ: Math.cos(i * 0.017), compress: i % 137 < 42, jumpPressed: i % 137 === 0, extend: i % 200 < 20, retract: i % 200 >= 100 && i % 200 < 120 }, sweep => landingAlpha(sweep, 0) === undefined ? undefined : { surfaceY: 0 });
        const { response, incomingDownwardSpeed, pendingLaunch, diagnostics, gradient, ...pogo } = sim.pogo;
        trace.push(structuredClone({ tick: sim.tick, body: sim.body, pole: sim.pole, pogo }));
    }
    expect(Bun.hash(JSON.stringify(trace)).toString()).toBe("2238867786155907160");
});

test("experiment response snapshots require compatible complete coefficients and world direction", () => {
    expect(parseSurfaceSnapshot(resolveSurface())).toEqual(resolveSurface());
    expect(parseSurfaceSnapshot(resolveSurface({ profile: "directional", directionXZ: [1, 0] }))).toEqual(resolveSurface({ profile: "directional", directionXZ: [1, 0] }));
    for (const value of [undefined, {}, { ...resolveSurface(), directionX: NaN }, { ...resolveSurface(), bounceScale: undefined }, { ...resolveSurface(), extra: 1 }, { ...resolveSurface({ profile: "directional", directionXZ: [1, 0] }), directionX: 2 }])
        expect(() => parseSurfaceSnapshot(value)).toThrow();
});

test("elastic increases matched-charge apex and impact-only rebounds do not grow over repeated drops", () => {
    function apex(sim: Sim) {
        let maximum = sim.body.pos.y;
        while (sim.body.vel.y > 0) {
            step(sim, tuning, NEUTRAL_CONTROLS, () => undefined);
            maximum = Math.max(maximum, sim.body.pos.y);
        }
        return maximum;
    }
    const neutral = resolveSurface(), elastic = resolveSurface({ profile: "elastic" });
    const baseline = contact(neutral, 1, 0), candidate = contact(elastic, 1, 0);
    depart(baseline, neutral, { ...NEUTRAL_CONTROLS, compress: true });
    depart(candidate, elastic, { ...NEUTRAL_CONTROLS, compress: true });
    expect(apex(candidate)).toBeGreaterThan(apex(baseline) + 2);
    const impact = snapshot({ ...DEFAULT_SURFACE, restitution: 1, impactSpeedLimit: 100 });
    const sim = createSim({ x: 0, y: 40, z: 0 });
    let previous = 40;
    for (let bounce = 0; bounce < 5; bounce++) {
        for (let i = 0; i < 2000 && sim.pogo.state === "Airborne"; i++) tick(sim, impact);
        depart(sim, impact);
        const height = apex(sim);
        expect(height).toBeLessThanOrEqual(previous + 0.05);
        previous = height;
    }
});

test("comparison environments use valid production profiles and retain ordinary platforms", async () => {
    for (const name of ["surface-trials", "surface-comparison"]) {
        const level = parseLevelDefinition(await Bun.file(new URL(`../public/levels/${name}.json`, import.meta.url)).json());
        const profiles = level.objects.map(o => "surface" in o ? o.surface?.profile ?? "default" : "default");
        expect(new Set(profiles)).toEqual(new Set(["default", "elastic", "grip", "directional", ...(name === "surface-trials" ? ["ice"] : [])]));
    }
});

test("respawn clears a latched surface response and pending dwell", async () => {
    const { runtime, resetPlayerToSpawn } = await import("../src/game/state");
    const state = runtime.create();
    state.level = parseLevelDefinition(prototype);
    state.sim = contact(resolveSurface({ profile: "grip" }));
    state.sim.pogo.pendingLaunch = "release";
    resetPlayerToSpawn(state);
    expect(state.sim.pogo.response).toEqual(resolveSurface());
    expect(state.sim.pogo.pendingLaunch).toBeUndefined();
    expect(state.sim.pogo.incomingDownwardSpeed).toBe(0);
    expect(state.sim.pogo.diagnostics.dragLoss).toBe(0);
});

test("per-platform coefficient overrides round trip, inherit omitted values and reject invalid authoring", () => {
    const authored = parseAuthoredSurface({ profile: "elastic", overrides: { bounceScale: 0.7, contactDrag: 2.5, minimumDwell: 0.12, maximumVerticalSpeed: null } });
    expect(parseAuthoredSurface(JSON.parse(JSON.stringify(authored)))).toEqual(authored);
    expect(resolveSurface(authored)).toMatchObject({ bounceScale: 0.7, contactDrag: 2.5, minimumDwell: 0.12, restitution: 0.85 });
    expect(resolveSurface(authored).maximumVerticalSpeed).toBeUndefined();
    expect(resolveSurface(parseAuthoredSurface({ profile: "elastic" })).maximumVerticalSpeed).toBe(18);
    expect(resolveSurface(parseAuthoredSurface({ profile: "ice" }))).toMatchObject({ holdMode: "until-release", chargeScale: 0 });
    expect(resolveSurface(parseAuthoredSurface({ profile: "default", overrides: { holdMode: "until-release", chargeScale: 0.5 } })))
        .toMatchObject({ holdMode: "until-release", chargeScale: 0.5 });
    expect(parseAuthoredSurface({ profile: "default", overrides: {} })).toEqual({ profile: "default" });
    const level = { ...prototype, objects: prototype.objects.map((object, index) => index === 0 ? { ...object, surface: authored } : object) };
    expect(parseLevelDefinition(JSON.parse(JSON.stringify(level)))).toEqual(level);
    for (const overrides of [null, [], { unknown: 2 }, { bounceScale: 0 }, { bounceScale: NaN }, { contactDrag: -1 }, { restitution: 1.1 }, { momentumRetention: 1.1 }, { minimumDwell: 0.31 }, { maximumVerticalSpeed: 0 }, { impactSpeedLimit: Infinity }, { contactDrag: null }, { directionalSpeed: 2 }, { bounceScale: "1" }, { bounceScale: undefined }, { holdMode: "unknown" }, { holdMode: 1 }, { chargeScale: 2 }, { chargeScale: NaN }])
        expect(() => parseAuthoredSurface({ profile: "default", overrides })).toThrow();
    const directional = parseAuthoredSurface({ profile: "directional", directionXZ: [3, 4], overrides: { directionalSpeed: 6, restitution: 0.2 } });
    expect(resolveSurface(directional)).toMatchObject({ directionalSpeed: 6, directionX: 0.6, directionZ: 0.8, restitution: 0.2 });
});


test("ice reduces steering and horizontal push-off while preserving momentum at uncharged launch strength", () => {
    const normal = resolveSurface({ profile: "default", overrides: { chargeScale: 0 } }), ice = resolveSurface({ profile: "ice" });
    const controls = { ...NEUTRAL_CONTROLS, leanX: -1, leanZ: 0.5, compress: true };
    const baseline = contact(normal), sliding = contact(ice);
    for (let i = 0; i < 12; i++) {
        tick(baseline, normal, controls);
        tick(sliding, ice, controls);
    }
    expect(sliding.pogo.carryVelX - 10).toBeCloseTo((baseline.pogo.carryVelX - 10) * ice.traction);
    expect(sliding.pogo.carryVelZ).toBeCloseTo(baseline.pogo.carryVelZ * ice.traction);
    expect(sliding.pogo.contactTip.x).toBeGreaterThan(baseline.pogo.contactTip.x + 0.7);
    depart(baseline, normal);
    depart(sliding, ice);
    expect(sliding.body.vel.y).toBeCloseTo(baseline.body.vel.y);
    expect(sliding.pogo.diagnostics.charge).toBe(0);
    expect(sliding.pogo.diagnostics.powered.x).toBeCloseTo(baseline.pogo.diagnostics.powered.x * ice.traction);
    expect(sliding.pogo.diagnostics.powered.z).toBeCloseTo(baseline.pogo.diagnostics.powered.z * ice.traction);
    const neutral = depart(contact(ice), ice);
    expect(neutral.body.vel.x).toBe(10);
    expect(neutral.pogo.diagnostics.dragLoss).toBe(0);
});

test("ice remains compressed through a long hold and launch strength does not depend on hold duration", () => {
    const ice = resolveSurface({ profile: "ice" });
    const makeHeld = (ticks: number) => {
        const sim = contact(ice, 1, 10);
        const query = (sweep: Parameters<typeof landingAlpha>[0] & { supportOnly?: boolean }) => {
            if (sweep.supportOnly) return { surfaceY: 0, response: ice };
            return landingAlpha(sweep, 0) === undefined ? undefined : { surfaceY: 0, response: ice };
        };
        for (let i = 0; i < ticks; i++) step(sim, tuning, { ...NEUTRAL_CONTROLS, compress: true }, query);
        expect(sim.pogo.state).toBe("Compression");
        expect(effectiveCharge(sim.pogo.chargeT, sim.pogo.response)).toBe(0);
        expect(sim.pogo.lastLaunchedContactId).toBe(-1);
        return { sim, query };
    };
    const short = makeHeld(2);
    const long = makeHeld(60 * tuning.SIM_HZ);
    for (const value of [long.sim.body.pos.x, long.sim.body.pos.y, long.sim.pogo.contactTip.x, long.sim.pogo.chargeT])
        expect(Number.isFinite(value)).toBe(true);
    step(short.sim, tuning, NEUTRAL_CONTROLS, short.query);
    step(long.sim, tuning, NEUTRAL_CONTROLS, long.query);
    expect(short.sim.pogo.diagnostics.powered.x).toBeCloseTo(long.sim.pogo.diagnostics.powered.x);
    expect(short.sim.pogo.diagnostics.powered.y).toBeCloseTo(long.sim.pogo.diagnostics.powered.y);
});

test("sliding off an unsupported contact falls without a launch or a pending charge release", () => {
    const ice = resolveSurface({ profile: "ice" });
    const sim = contact(ice);
    sim.pogo.pendingLaunch = "release";
    const id = sim.pogo.lastLaunchedContactId;
    step(sim, tuning, NEUTRAL_CONTROLS, () => undefined);
    expect(sim.pogo.state).toBe("Airborne");
    expect(sim.pogo.lastLaunchedContactId).toBe(id);
    expect(sim.pogo.pendingLaunch).toBeUndefined();
    expect(sim.body.vel).toEqual({ x: 10, y: 0, z: 0 });
    step(sim, tuning, NEUTRAL_CONTROLS, () => undefined);
    expect(sim.body.vel.y).toBeLessThan(0);
});
