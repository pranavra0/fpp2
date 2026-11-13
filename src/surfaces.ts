export type SurfaceResponse = {
    bounceScale: number;
    restitution: number;
    impactSpeedLimit: number;
    momentumRetention: number;
    contactDrag: number;
    traction: number;
    minimumDwell: number;
    directionalSpeed: number;
    holdMode: SurfaceHoldMode;
    chargeScale: number;
    maximumVerticalSpeed?: number;
};

export type SurfaceHoldMode = "bounded" | "until-release";

export const DEFAULT_SURFACE: Readonly<SurfaceResponse> = Object.freeze({
    bounceScale: 1, restitution: 0, impactSpeedLimit: 18, momentumRetention: 1,
    contactDrag: 0, traction: 1, minimumDwell: 0, directionalSpeed: 0,
    holdMode: "bounded", chargeScale: 1,
});
export const SURFACE_PROFILES = Object.freeze({
    default: DEFAULT_SURFACE,
    elastic: Object.freeze({ ...DEFAULT_SURFACE, bounceScale: 1.15, restitution: 0.85, maximumVerticalSpeed: 18 }),
    grip: Object.freeze({ ...DEFAULT_SURFACE, momentumRetention: 0.35, contactDrag: 4, minimumDwell: 0.08 }),
    ice: Object.freeze({ ...DEFAULT_SURFACE, traction: 0.12, holdMode: "until-release", chargeScale: 0 }),
    directional: Object.freeze({ ...DEFAULT_SURFACE, directionalSpeed: 4, maximumVerticalSpeed: 18 }),
});
export type SurfaceProfile = keyof typeof SURFACE_PROFILES;
export type SurfaceOverrides = Partial<Omit<SurfaceResponse, "maximumVerticalSpeed">> & {
    maximumVerticalSpeed?: number | null;
};
export type AuthoredSurface = ({ profile: Exclude<SurfaceProfile, "directional"> } |
    { profile: "directional"; directionXZ: readonly [number, number] }) & { overrides?: SurfaceOverrides };
export type SurfaceSnapshot = SurfaceResponse & { directionX: number; directionZ: number };

export function validateSurfaceResponse(value: SurfaceResponse): void {
    const numeric = ["bounceScale", "restitution", "impactSpeedLimit", "momentumRetention", "contactDrag", "traction", "minimumDwell", "directionalSpeed", "chargeScale"] as const;
    const allowed = [...numeric, "holdMode", "maximumVerticalSpeed"] as const;
    for (const key of Object.keys(value)) {
        if (!allowed.includes(key as typeof allowed[number]))
            throw new Error(`Unsupported surface coefficient: ${key}`);
    }
    for (const key of numeric) {
        const number = value[key];
        if (typeof number !== "number" || !Number.isFinite(number) || number < 0)
            throw new Error(`Invalid surface coefficient: ${key}`);
    }
    if (value.holdMode !== "bounded" && value.holdMode !== "until-release")
        throw new Error("Invalid surface hold mode");
    if (value.bounceScale <= 0 || value.impactSpeedLimit <= 0 || value.restitution > 1 ||
        value.momentumRetention > 1 || value.traction > 1 || value.chargeScale > 1 || value.minimumDwell > 0.3 ||
        (value.maximumVerticalSpeed !== undefined && (!Number.isFinite(value.maximumVerticalSpeed) || value.maximumVerticalSpeed <= 0)))
        throw new Error("Surface coefficient outside admissible range");
}

export function parseAuthoredSurface(value: unknown): AuthoredSurface {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected surface object");
    const input = value as Record<string, unknown>;
    if (typeof input.profile !== "string" || !Object.hasOwn(SURFACE_PROFILES, input.profile))
        throw new Error("Unknown surface profile");
    const profile = input.profile as SurfaceProfile;
    const keys = profile === "directional" ? ["profile", "directionXZ", "overrides"] : ["profile", "overrides"];
    if (Object.keys(input).some(key => !keys.includes(key))) throw new Error("Unsupported surface field");
    let overrides: SurfaceOverrides | undefined;
    if (Object.hasOwn(input, "overrides")) {
        if (!input.overrides || typeof input.overrides !== "object" || Array.isArray(input.overrides))
            throw new Error("Expected surface coefficient overrides");
        const coefficients = input.overrides as Record<string, unknown>;
        for (const [key, coefficient] of Object.entries(coefficients)) {
            const valid = key === "holdMode"
                ? coefficient === "bounded" || coefficient === "until-release"
                : key === "maximumVerticalSpeed"
                    ? typeof coefficient === "number" || coefficient === null
                    : Object.hasOwn(DEFAULT_SURFACE, key) && key !== "holdMode" && typeof coefficient === "number";
            if (!valid)
                throw new Error(`Invalid surface override: ${key}`);
        }
        overrides = { ...coefficients } as SurfaceOverrides;
    }
    const authoredOverrides = overrides && Object.keys(overrides).length ? { overrides } : {};
    const response = resolveSurfaceCoefficients(profile, overrides);
    validateSurfaceResponse(response);
    if (profile !== "directional") {
        if (response.directionalSpeed !== 0) throw new Error("Directional speed requires a directional profile");
        return { profile, ...authoredOverrides };
    }
    const d = input.directionXZ;
    if (!Array.isArray(d) || d.length !== 2 || !d.every(n => typeof n === "number" && Number.isFinite(n)))
        throw new Error("Expected finite local XZ direction");
    const length = Math.hypot(d[0], d[1]);
    if (!Number.isFinite(length) || length === 0) throw new Error("Surface direction must be nonzero");
    return { profile, directionXZ: [d[0] / length, d[1] / length], ...authoredOverrides };
}

function resolveSurfaceCoefficients(profile: SurfaceProfile, overrides?: SurfaceOverrides): SurfaceResponse {
    const { maximumVerticalSpeed, ...coefficients } = overrides ?? {};
    const response: SurfaceResponse = { ...SURFACE_PROFILES[profile], ...coefficients };
    if (maximumVerticalSpeed === null) delete response.maximumVerticalSpeed;
    else if (maximumVerticalSpeed !== undefined) response.maximumVerticalSpeed = maximumVerticalSpeed;
    return response;
}

export function resolveSurface(surface?: AuthoredSurface, rotationY = 0): SurfaceSnapshot {
    const response = resolveSurfaceCoefficients(surface?.profile ?? "default", surface?.overrides);
    const [x, z] = surface?.profile === "directional" ? surface.directionXZ : [0, 0];
    return { ...response, directionX: Math.cos(rotationY) * x + Math.sin(rotationY) * z,
        directionZ: -Math.sin(rotationY) * x + Math.cos(rotationY) * z };
}

export function parseSurfaceSnapshot(value: unknown): SurfaceSnapshot {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected surface response snapshot");
    const { directionX, directionZ, ...coefficients } = value as SurfaceSnapshot;
    validateSurfaceResponse(coefficients);
    if (!Number.isFinite(directionX) || !Number.isFinite(directionZ) ||
        (coefficients.directionalSpeed > 0 && Math.abs(Math.hypot(directionX, directionZ) - 1) > 1e-6))
        throw new Error("Invalid world-space surface direction");
    return { ...coefficients, directionX, directionZ };
}
