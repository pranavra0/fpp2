import { DEFAULT_SURFACE, type SurfaceResponse } from "../surfaces";

export type SurfaceVisualProperties = {
    lowTraction: boolean;
    rebound: boolean;
    grip: boolean;
    directionalLaunch: boolean;
    holdUntilRelease: boolean;
};

export function surfaceVisualProperties(response: SurfaceResponse): SurfaceVisualProperties {
    return {
        lowTraction: response.traction < DEFAULT_SURFACE.traction,
        rebound: response.bounceScale > DEFAULT_SURFACE.bounceScale || response.restitution > DEFAULT_SURFACE.restitution,
        grip: response.momentumRetention < DEFAULT_SURFACE.momentumRetention || response.contactDrag > DEFAULT_SURFACE.contactDrag,
        directionalLaunch: response.directionalSpeed > 0,
        holdUntilRelease: response.holdMode === "until-release",
    };
}

export function crumbleDamageStage(delay: number, remaining: number, phase: "ready" | "counting" | "absent"): number {
    if (!Number.isFinite(delay) || delay < 0 || !Number.isFinite(remaining) || remaining < 0)
        throw new Error("Invalid crumble timer state");
    if (phase === "absent") return 10;
    if (phase === "ready") return 1;
    if (phase !== "counting") throw new Error("Invalid crumble phase");
    if (delay === 0) return 10;
    if (remaining > delay) throw new Error("Crumble remaining time exceeds its delay");
    return Math.min(10, Math.max(1, 1 + Math.floor((1 - remaining / delay) * 9)));
}
