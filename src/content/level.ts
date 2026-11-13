import type { PlatformMotion, PlatformCrumble } from "../platforms.ts";
import { parseAuthoredSurface, type AuthoredSurface } from "../surfaces.ts";
export type Vec3Tuple = readonly [number, number, number];
export type QuaternionTuple = readonly [number, number, number, number];
export type LevelObjectRole = "ground" | "platform" | "goal" | "checkpoint";
export type LevelMaterial = LevelObjectRole;
export type LevelAssetId = string;

type LevelObjectBase = {
    id: string;
    transform: {
        position: Vec3Tuple;
        rotation: QuaternionTuple;
        scale: Vec3Tuple;
    };
};

export type LevelGroundObjectDefinition = LevelObjectBase & {
    role: "ground";
    surface?: AuthoredSurface;
    visual: { kind: "box"; material: "ground" };
    collision: { kind: "box"; dimensions: Vec3Tuple; mode?: "solid" | "one-way" };
};

export type LevelBoxPlatformObjectDefinition = LevelObjectBase & {
    role: "platform";
    motion?: PlatformMotion;
    crumble?: PlatformCrumble;
    surface?: AuthoredSurface;
    visual: { kind: "box"; material: "platform" };
    collision: { kind: "box"; dimensions: Vec3Tuple; mode?: "solid" | "one-way" };
};

export type LevelModelPlatformObjectDefinition = LevelObjectBase & {
    role: "platform";
    motion?: PlatformMotion;
    crumble?: PlatformCrumble;
    surface?: AuthoredSurface;
    visual: { kind: "gltf"; asset: LevelAssetId };
    collision: { kind: "box"; dimensions: Vec3Tuple; mode?: "solid" | "one-way" };
};

export type LevelSurfaceObjectDefinition =
    | LevelGroundObjectDefinition
    | LevelBoxPlatformObjectDefinition
    | LevelModelPlatformObjectDefinition;

export type LevelTriggerObjectDefinition = LevelObjectBase & {
    role: "goal" | "checkpoint";
    visual: { kind: "box"; material: "goal" | "checkpoint" };
    collision: { kind: "trigger-box"; dimensions: Vec3Tuple };
};

export type LevelObjectDefinition = LevelSurfaceObjectDefinition | LevelTriggerObjectDefinition;

export type LevelDefinition = {
    id: string;
    spawnPosition: Vec3Tuple;
    failureBoundaryY: number;
    objects: readonly LevelObjectDefinition[];
};

export type LevelSurface = {
    id: string;
    role: "ground" | "platform";
    centerX: number;
    centerZ: number;
    rotationY: number;
    width: number;
    height: number;
    depth: number;
    topY: number;
};

function invalid(path: string, message: string): never {
    throw new Error(`Invalid level data at ${path}: ${message}`);
}

function record(value: unknown, path: string): Record<string, unknown> {
    if (typeof value !== "object" || value === null || Array.isArray(value))
        return invalid(path, "expected an object");
    return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, path: string, keys: readonly string[]): void {
    for (const key of keys) {
        if (!(key in value)) invalid(`${path}.${key}`, "is required");
    }
    for (const key of Object.keys(value)) {
        if (!keys.includes(key)) invalid(`${path}.${key}`, "is not supported");
    }
}

function string(value: unknown, path: string): string {
    if (typeof value !== "string" || value.trim().length === 0 || value !== value.trim())
        return invalid(path, "expected a non-empty string without surrounding whitespace");
    return value;
}

function tuple<T extends readonly number[]>(value: unknown, length: number, path: string): T {
    if (!Array.isArray(value) || value.length !== length)
        return invalid(path, `expected an array of ${length} numbers`);
    for (let index = 0; index < length; index++) {
        if (typeof value[index] !== "number" || !Number.isFinite(value[index]))
            invalid(`${path}[${index}]`, "expected a finite number");
    }
    return value as unknown as T;
}

function positiveTuple(value: unknown, path: string): Vec3Tuple {
    const result = tuple<Vec3Tuple>(value, 3, path);
    for (let index = 0; index < result.length; index++) {
        if (result[index]! <= 0) invalid(`${path}[${index}]`, "must be greater than zero");
    }
    return result;
}

function parseTransform(value: unknown, path: string): LevelObjectBase["transform"] {
    const input = record(value, path);
    exactKeys(input, path, ["position", "rotation", "scale"]);
    const position = tuple<Vec3Tuple>(input.position, 3, `${path}.position`);
    const rotation = tuple<QuaternionTuple>(input.rotation, 4, `${path}.rotation`);
    const rotationLength = Math.hypot(...rotation);
    if (Math.abs(rotationLength - 1) > 1e-4)
        invalid(`${path}.rotation`, "must be a unit quaternion");
    if (Math.abs(rotation[0]) > 1e-6 || Math.abs(rotation[2]) > 1e-6)
        invalid(`${path}.rotation`, "level objects may rotate around Y only");
    return {
        position,
        rotation,
        scale: positiveTuple(input.scale, `${path}.scale`),
    };
}

function finiteNumber(value: unknown, path: string, minimum: number, exclusive = false): number {
    if (typeof value !== "number" || !Number.isFinite(value) || (exclusive ? value <= minimum : value < minimum))
        invalid(path, `expected a finite number ${exclusive ? "greater than" : "at least"} ${minimum}`);
    return value;
}

function parseMotion(value: unknown, path: string): PlatformMotion {
    const input = record(value, path);
    exactKeys(input, path, ["path", "duration", "phase", "mode"]);
    if (!Array.isArray(input.path) || input.path.length < 2) invalid(`${path}.path`, "expected at least two offsets");
    const points = input.path.map((point, index) => tuple<Vec3Tuple>(point, 3, `${path}.path[${index}]`));
    if (points[0]!.some(value => value !== 0)) invalid(`${path}.path[0]`, "must be the starting offset [0, 0, 0]");
    for (let index = 1; index < points.length; index++) {
        const length = Math.hypot(...points[index]!.map((value, axis) => value - points[index - 1]![axis]!));
        if (!(length > 0) || !Number.isFinite(length)) invalid(`${path}.path[${index}]`, "must form a finite, nonzero segment");
    }
    const duration = finiteNumber(input.duration, `${path}.duration`, 0, true);
    const phase = finiteNumber(input.phase, `${path}.phase`, 0);
    if (phase >= 1) invalid(`${path}.phase`, "must be less than one");
    if (input.mode !== "loop" && input.mode !== "ping-pong") invalid(`${path}.mode`, 'expected "loop" or "ping-pong"');
    return { path: points, duration, phase, mode: input.mode };
}

function parseCrumble(value: unknown, path: string): PlatformCrumble {
    const input = record(value, path);
    exactKeys(input, path, ["delay", ...(Object.hasOwn(input, "returnDelay") ? ["returnDelay"] : [])]);
    const delay = finiteNumber(input.delay, `${path}.delay`, 0);
    return { delay, ...(Object.hasOwn(input, "returnDelay") ? { returnDelay: finiteNumber(input.returnDelay, `${path}.returnDelay`, 0) } : {}) };
}

function parseObject(value: unknown, path: string): LevelObjectDefinition {
    const input = record(value, path);
    exactKeys(input, path, ["id", "role", "transform", "visual", "collision", ...["surface", "motion", "crumble"].filter(key => Object.hasOwn(input, key))]);
    const id = string(input.id, `${path}.id`);
    const role = input.role;
    if (role !== "ground" && role !== "platform" && role !== "goal" && role !== "checkpoint")
        invalid(`${path}.role`, 'expected "ground", "platform", "goal", or "checkpoint"');
    if ((role === "goal" || role === "checkpoint") && Object.hasOwn(input, "surface")) invalid(`${path}.surface`, "trigger cannot have a surface");
    const surface = Object.hasOwn(input, "surface") ? { surface: parseAuthoredSurface(input.surface) } : {};
    const behaviors: { motion?: PlatformMotion; crumble?: PlatformCrumble } = {};
    for (const key of ["motion", "crumble"] as const) {
        if (!Object.hasOwn(input, key)) continue;
        if (role !== "platform") invalid(`${path}.${key}`, "only platforms support this behavior");
        if (key === "motion") behaviors.motion = parseMotion(input.motion, `${path}.motion`);
        else behaviors.crumble = parseCrumble(input.crumble, `${path}.crumble`);
    }
    const transform = parseTransform(input.transform, `${path}.transform`);
    const visualInput = record(input.visual, `${path}.visual`);
    let visual: { kind: "box"; material: LevelMaterial } | { kind: "gltf"; asset: LevelAssetId };
    if (visualInput.kind === "box") {
        exactKeys(visualInput, `${path}.visual`, ["kind", "material"]);
        if (visualInput.material !== role)
            invalid(`${path}.visual.material`, `must match role "${role}"`);
        visual = { kind: "box", material: role };
    } else if (visualInput.kind === "gltf") {
        exactKeys(visualInput, `${path}.visual`, ["kind", "asset"]);
        if (role !== "platform")
            invalid(`${path}.visual.kind`, 'glTF visuals are supported only for "platform" objects');
        const asset = string(visualInput.asset, `${path}.visual.asset`);
        if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(asset))
            invalid(`${path}.visual.asset`, "must be a model filename without its .glb extension");
        visual = { kind: "gltf", asset };
    } else {
        invalid(`${path}.visual.kind`, 'expected "box" or "gltf"');
    }
    const collisionInput = record(input.collision, `${path}.collision`);
    exactKeys(collisionInput, `${path}.collision`, ["kind", "dimensions", ...(Object.hasOwn(collisionInput, "mode") ? ["mode"] : [])]);
    const trigger = role === "goal" || role === "checkpoint";
    if (collisionInput.kind !== (trigger ? "trigger-box" : "box"))
        invalid(
            `${path}.collision.kind`,
            trigger ? 'expected "trigger-box" for non-solid gameplay objects' : 'expected "box" for solid surfaces',
        );
    const mode = collisionInput.mode;
    if (mode !== undefined && (role !== "platform" || (mode !== "solid" && mode !== "one-way")))
        invalid(`${path}.collision.mode`, 'expected "solid" or "one-way" on a platform');
    const collisionMode = mode === undefined ? {} : { mode: mode as "solid" | "one-way" };
    const dimensions = positiveTuple(collisionInput.dimensions, `${path}.collision.dimensions`);
    if (role === "goal" || role === "checkpoint") {
        if (visual.kind !== "box")
            invalid(`${path}.visual.kind`, 'trigger objects require a "box" visual');
        return {
            id,
            role,
            transform,
            visual: { kind: "box", material: role },
            collision: { kind: "trigger-box", dimensions },
        };
    }
    if (role === "ground") {
        if (visual.kind !== "box")
            invalid(`${path}.visual.kind`, 'ground objects require a "box" visual');
        return {
            id,
            role,
            transform,
            visual: { kind: "box", material: "ground" },
            collision: { kind: "box", dimensions, ...collisionMode },
            ...surface,
            ...behaviors,
        };
    }
    if (visual.kind === "gltf")
        return {
            id,
            role,
            transform,
            visual,
            collision: { kind: "box", dimensions, ...collisionMode },
            ...surface,
            ...behaviors,
        };
    return {
        id,
        role,
        transform,
        visual: { kind: "box", material: "platform" },
        collision: { kind: "box", dimensions, ...collisionMode },
            ...surface,
            ...behaviors,
    };
}

export function parseLevelDefinition(value: unknown): LevelDefinition {
    const input = record(value, "level");
    exactKeys(input, "level", ["id", "spawnPosition", "failureBoundaryY", "objects"]);
    const id = string(input.id, "level.id");
    if (!/^[a-z0-9][a-z0-9-]*$/.test(id))
        invalid("level.id", "must use lowercase letters, numbers, and hyphens");
    const spawnPosition = tuple<Vec3Tuple>(input.spawnPosition, 3, "level.spawnPosition");
    const failureBoundaryY = input.failureBoundaryY;
    if (typeof failureBoundaryY !== "number" || !Number.isFinite(failureBoundaryY))
        invalid("level.failureBoundaryY", "expected a finite number");
    if (failureBoundaryY >= spawnPosition[1])
        invalid("level.failureBoundaryY", "must be below the spawn position");
    if (!Array.isArray(input.objects)) invalid("level.objects", "expected an array");
    const objects = input.objects.map((object, index) =>
        parseObject(object, `level.objects[${index}]`),
    );
    const objectIds = new Set<string>();
    let groundCount = 0;
    let goalCount = 0;
    for (const object of objects) {
        if (objectIds.has(object.id))
            invalid("level.objects", `duplicate object id "${object.id}"`);
        objectIds.add(object.id);
        if (object.role === "ground") groundCount++;
        if (object.role === "goal") goalCount++;
    }
    if (groundCount !== 1) invalid("level.objects", "must contain exactly one ground object");
    if (goalCount > 1) invalid("level.objects", "may contain at most one goal object");
    for (const object of objects) {
        if (object.role === "checkpoint" && object.transform.position[1] <= failureBoundaryY)
            invalid(`level.objects.${object.id}`, "checkpoint respawn position must be above the failure boundary");
    }
    return { id, spawnPosition, failureBoundaryY, objects };
}

export async function loadLevel(
    id: string,
    readFile: typeof fetch = fetch,
): Promise<LevelDefinition> {
    const normalizedId = id.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]*$/.test(normalizedId))
        throw new Error(`Invalid level identifier "${id}"`);

    const path = `/levels/${normalizedId}.json`;
    let response: Response;
    try {
        response = await readFile(path);
    } catch (error) {
        throw new Error(`Failed to load level "${normalizedId}" from ${path}: ${errorMessage(error)}`, {
            cause: error,
        });
    }
    if (!response.ok)
        throw new Error(`Failed to load level "${normalizedId}" from ${path}: HTTP ${response.status}`);

    let value: unknown;
    try {
        value = await response.json();
    } catch (error) {
        throw new Error(
            `Failed to parse JSON for level "${normalizedId}" from ${path}: ${errorMessage(error)}`,
            { cause: error },
        );
    }
    let level: LevelDefinition;
    try {
        level = parseLevelDefinition(value);
    } catch (error) {
        throw new Error(`Invalid level file ${path}: ${errorMessage(error)}`, { cause: error });
    }
    if (level.id !== normalizedId)
        throw new Error(`Level file ${path} contains id "${level.id}" instead of "${normalizedId}"`);
    return level;
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export function levelSurfaces(level: LevelDefinition): LevelSurface[] {
    return level.objects
        .filter(
            (object): object is LevelSurfaceObjectDefinition =>
                object.role === "ground" || object.role === "platform",
        )
        .map((object) => {
            const { position, rotation, scale } = object.transform;
            const collisionDimensions = object.collision.dimensions;
            return {
                id: object.id,
                role: object.role,
                centerX: position[0],
                centerZ: position[2],
                rotationY: 2 * Math.atan2(rotation[1], rotation[3]),
                width: scale[0] * collisionDimensions[0],
                height: scale[1] * collisionDimensions[1],
                depth: scale[2] * collisionDimensions[2],
                topY: position[1] + (scale[1] * collisionDimensions[1]) / 2,
            };
        });
}

export function levelSurfaceContains(
    surface: Pick<LevelSurface, "centerX" | "centerZ" | "rotationY" | "width" | "depth">,
    x: number,
    z: number,
    edgeTolerance: number,
): boolean {
    const deltaX = x - surface.centerX;
    const deltaZ = z - surface.centerZ;
    const cosine = Math.cos(surface.rotationY);
    const sine = Math.sin(surface.rotationY);
    const localX = cosine * deltaX - sine * deltaZ;
    const localZ = sine * deltaX + cosine * deltaZ;
    return (
        Math.abs(localX) <= surface.width * 0.5 + edgeTolerance &&
        Math.abs(localZ) <= surface.depth * 0.5 + edgeTolerance
    );
}

export function overlappingLevelSurfaces(level: LevelDefinition): readonly (readonly [string, string])[] {
    const surfaces = levelSurfaces(level);
    const result: [string, string][] = [];
    for (let i = 0; i < surfaces.length; i++) {
        const a = surfaces[i]!;
        for (const b of surfaces.slice(i + 1)) {
            if (Math.abs(a.topY - b.topY) > 1e-5) continue;
            const axes = [a.rotationY, a.rotationY + Math.PI / 2, b.rotationY, b.rotationY + Math.PI / 2];
            const overlaps = axes.every(angle => {
                const separation = Math.abs((b.centerX - a.centerX) * Math.cos(angle) - (b.centerZ - a.centerZ) * Math.sin(angle));
                const radius = (s: LevelSurface) => Math.abs(Math.cos(angle - s.rotationY)) * s.width / 2 + Math.abs(Math.sin(angle - s.rotationY)) * s.depth / 2;
                return separation < radius(a) + radius(b) - 1e-6;
            });
            if (overlaps) result.push([a.id, b.id]);
        }
    }
    return result;
}
