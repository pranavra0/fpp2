import type { Vec3 } from "./vec";

export type PlatformMotion = {
    path: readonly (readonly [number, number, number])[];
    duration: number;
    phase: number;
    mode: "loop" | "ping-pong";
};
export type PlatformCrumble = { delay: number; returnDelay?: number };
export type CrumbleState = { phase: "ready" | "counting" | "absent"; remaining: number };

export function motionOffset(motion: PlatformMotion, elapsed: number): Vec3 {
    if (!Number.isFinite(elapsed) || elapsed < 0) throw new Error("Invalid platform elapsed time");
    const period = motion.mode === "ping-pong" ? 2 : 1;
    const cycle = (elapsed / motion.duration + motion.phase * period) % period;
    const progress = cycle > 1 ? 2 - cycle : cycle;
    const points = motion.mode === "loop" ? [...motion.path, motion.path[0]!] : motion.path;
    const lengths = points.slice(1).map((point, index) => Math.hypot(...point.map((value, axis) => value - points[index]![axis]!)));
    const length = lengths.reduce((sum, value) => sum + value, 0);
    if (!(length > 0)) throw new Error("Platform path must have positive length");
    let distance = progress * length;
    for (let index = 0; index < lengths.length; index++) {
        const segment = lengths[index]!;
        if (segment === 0) continue;
        if (distance <= segment || index === lengths.length - 1) {
            const a = points[index]!;
            const b = points[index + 1]!;
            const t = distance / segment;
            return { x: a[0] + (b[0] - a[0]) * t, y: a[1] + (b[1] - a[1]) * t, z: a[2] + (b[2] - a[2]) * t };
        }
        distance -= segment;
    }
    const last = points[points.length - 1]!;
    return { x: last[0], y: last[1], z: last[2] };
}

export function advanceCrumble(state: CrumbleState, config: PlatformCrumble, dt: number, occupied: boolean): CrumbleState {
    if (!Number.isFinite(dt) || dt < 0) throw new Error("Invalid crumble timestep");
    if (state.phase === "ready" || (state.phase === "absent" && config.returnDelay === undefined)) return { ...state };
    const remaining = state.remaining - dt;
    if (remaining > 1e-10) return { ...state, remaining };
    if (state.phase === "counting") return { phase: "absent", remaining: config.returnDelay ?? 0 };
    return occupied ? { phase: "absent", remaining: 0 } : { phase: "ready", remaining: 0 };
}

export function contactCrumble(state: CrumbleState, config: PlatformCrumble): CrumbleState {
    return state.phase === "ready" ? { phase: "counting", remaining: config.delay } : { ...state };
}
