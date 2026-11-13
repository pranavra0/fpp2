import type { Vec3Tuple } from "./level";

export type SurfaceAppearance = { top: string; side: string; edge: string; shadow: string };
export type SceneryPlacement = {
    id: string;
    shape: "tree" | "rock" | "ridge" | "plane";
    position: Vec3Tuple;
    scale: Vec3Tuple;
    yaw: number;
    color: string;
    shade: string;
};
export type LevelAppearance = {
    sky: string;
    resolution: number;
    surface: SurfaceAppearance;
    scenery: readonly SceneryPlacement[];
};
export const DEFAULT_APPEARANCE: LevelAppearance = {
    sky: "#c7d7cf", resolution: 480,
    surface: { top: "#b9bc7d", side: "#8e7967", edge: "#e0cfa0", shadow: "#596b69" },
    scenery: [],
};
export function colorValue(color: string): number { return Number.parseInt(color.slice(1), 16); }
function record(value: unknown, path: string, keys: readonly string[]): Record<string, unknown> {
    if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${path}: expected an object`);
    const input = value as Record<string, unknown>;
    if (Object.keys(input).some(key => !keys.includes(key)) || keys.some(key => !(key in input))) throw new Error(`${path}: expected ${keys.join(", ")}`);
    return input;
}
function color(value: unknown, path: string): string {
    if (typeof value !== "string" || !/^#[0-9a-fA-F]{6}$/.test(value)) throw new Error(`${path}: expected #rrggbb`);
    return value.toLowerCase();
}
export function parseSurfaceAppearance(value: unknown): SurfaceAppearance {
    const input = record(value, "appearance.surface", ["top", "side", "edge", "shadow"]);
    return { top: color(input.top, "top"), side: color(input.side, "side"), edge: color(input.edge, "edge"), shadow: color(input.shadow, "shadow") };
}
function vector(value: unknown, positive: boolean): Vec3Tuple {
    if (!Array.isArray(value) || value.length !== 3 || value.some(v => typeof v !== "number" || !Number.isFinite(v) || (positive && v <= 0))) throw new Error("Scenery transform requires three finite numbers and positive scale");
    return value as unknown as Vec3Tuple;
}
export function parseLevelAppearance(value: unknown): LevelAppearance {
    const input = record(value, "appearance", ["sky", "resolution", "surface", "scenery"]);
    if (!Number.isInteger(input.resolution) || Number(input.resolution) < 180 || Number(input.resolution) > 1080) throw new Error("Resolution must be an integer from 180 to 1080");
    if (!Array.isArray(input.scenery) || input.scenery.length > 256) throw new Error("Scenery must be an array of at most 256 placements");
    const ids = new Set<string>();
    const scenery = input.scenery.map((value): SceneryPlacement => {
        const item = record(value, "scenery", ["id", "shape", "position", "scale", "yaw", "color", "shade"]);
        if (typeof item.id !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(item.id) || ids.has(item.id)) throw new Error("Scenery ids must be unique lowercase identifiers");
        ids.add(item.id);
        if (item.shape !== "tree" && item.shape !== "rock" && item.shape !== "ridge" && item.shape !== "plane") throw new Error("Unsupported scenery shape");
        if (typeof item.yaw !== "number" || !Number.isFinite(item.yaw)) throw new Error("Scenery yaw must be finite");
        return { id: item.id, shape: item.shape, position: vector(item.position, false), scale: vector(item.scale, true), yaw: item.yaw, color: color(item.color, "scenery.color"), shade: color(item.shade, "scenery.shade") };
    });
    return { sky: color(input.sky, "appearance.sky"), resolution: input.resolution as number, surface: parseSurfaceAppearance(input.surface), scenery };
}
