import type { Vec3 } from "./vec";

/** Authored path and cycle used to move a platform in world space. Duration is in seconds. */
export type PlatformMotion = {
    path: readonly (readonly [number, number, number])[];
    duration: number;
    phase: number;
    mode: "loop" | "ping-pong";
};
/** Delay before a contacted platform disappears; an optional return delay restores it. */
export type PlatformCrumble = { delay: number; returnDelay?: number };
/** Crumble lifecycle; `absent` platforms cannot support the player. */
export type CrumbleState = { phase: "ready" | "counting" | "absent"; remaining: number };

export type CompiledPlatformMotion = PlatformMotion & {
    points: readonly (readonly [number, number, number])[];
    cumulative: readonly number[];
    length: number;
};

export function compileMotion(motion: PlatformMotion): CompiledPlatformMotion {
    const points = motion.mode === "loop" ? [...motion.path, motion.path[0]!] : [...motion.path];
    const cumulative = [0];
    for (let index = 1; index < points.length; index++) {
        const a = points[index - 1]!, b = points[index]!;
        cumulative.push(cumulative[index - 1]! + Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]));
    }
    const length = cumulative.at(-1)!;
    if (!(length > 0) || !Number.isFinite(length) || !(motion.duration > 0)) throw new Error("Invalid platform path");
    return { ...motion, points, cumulative, length };
}

export function motionOffset(motion: PlatformMotion | CompiledPlatformMotion, elapsed: number): Vec3 {
    if (!Number.isFinite(elapsed) || elapsed < 0) throw new Error("Invalid platform elapsed time");
    const compiled = "cumulative" in motion ? motion : compileMotion(motion);
    const period = motion.mode === "ping-pong" ? 2 : 1;
    const cycle = (elapsed / motion.duration + motion.phase * period) % period;
    const distance = (cycle > 1 ? 2 - cycle : cycle) * compiled.length;
    for (let index = 1; index < compiled.points.length; index++) {
        const end = compiled.cumulative[index]!, start = compiled.cumulative[index - 1]!;
        if (end === start || (distance > end && index !== compiled.points.length - 1)) continue;
        const a = compiled.points[index - 1]!, b = compiled.points[index]!;
        const t = (distance - start) / (end - start);
        return { x: a[0] + (b[0] - a[0]) * t, y: a[1] + (b[1] - a[1]) * t, z: a[2] + (b[2] - a[2]) * t };
    }
    throw new Error("Invalid compiled platform path");
}

/** Advance crumble timing; occupied contact pauses the countdown and return timer. */
export function advanceCrumble(state: CrumbleState, config: PlatformCrumble, dt: number, occupied: boolean): CrumbleState {
    if (!Number.isFinite(dt) || dt < 0) throw new Error("Invalid crumble timestep");
    if (state.phase === "ready" || (state.phase === "absent" && config.returnDelay === undefined)) return { ...state };
    const remaining = state.remaining - dt;
    if (remaining > 1e-10) return { ...state, remaining };
    if (state.phase === "counting") return { phase: "absent", remaining: config.returnDelay ?? 0 };
    return occupied ? { phase: "absent", remaining: 0 } : { phase: "ready", remaining: 0 };
}

/** Start a ready platform's crumble countdown when the player contacts it. */
export function contactCrumble(state: CrumbleState, config: PlatformCrumble): CrumbleState {
    return state.phase === "ready" ? { phase: "counting", remaining: config.delay } : { ...state };
}
