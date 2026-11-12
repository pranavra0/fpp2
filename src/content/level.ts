export type Vec3Tuple = readonly [number, number, number];
export type QuaternionTuple = readonly [number, number, number, number];
export type LevelMaterial = "ground" | "platform";
export type LevelObjectRole = "ground" | "platform";

export type LevelObjectDefinition = {
    id: string;
    role: LevelObjectRole;
    transform: {
        position: Vec3Tuple;
        rotation: QuaternionTuple;
        scale: Vec3Tuple;
    };
    visual: {
        kind: "box";
        material: LevelMaterial;
    };
    collision: {
        kind: "box";
        dimensions: Vec3Tuple;
    };
};

export type LevelDefinition = {
    formatVersion: 1;
    id: string;
    spawnPosition: Vec3Tuple;
    objects: readonly LevelObjectDefinition[];
};

export type LevelSurface = {
    id: string;
    role: LevelObjectRole;
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

function exactKeys(
    value: Record<string, unknown>,
    path: string,
    keys: readonly string[],
): void {
    for (const key of keys) {
        if (!(key in value)) invalid(`${path}.${key}`, "is required");
    }
    for (const key of Object.keys(value)) {
        if (!keys.includes(key)) invalid(`${path}.${key}`, "is not supported by format version 1");
    }
}

function string(value: unknown, path: string): string {
    if (typeof value !== "string" || value.trim().length === 0 || value !== value.trim())
        return invalid(path, "expected a non-empty string without surrounding whitespace");
    return value;
}

function tuple<T extends readonly number[]>(
    value: unknown,
    length: number,
    path: string,
): T {
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

function parseObject(value: unknown, path: string): LevelObjectDefinition {
    const input = record(value, path);
    exactKeys(input, path, ["id", "role", "transform", "visual", "collision"]);

    const id = string(input.id, `${path}.id`);
    const role = input.role;
    if (role !== "ground" && role !== "platform")
        invalid(`${path}.role`, 'expected "ground" or "platform"');

    const transformInput = record(input.transform, `${path}.transform`);
    exactKeys(transformInput, `${path}.transform`, ["position", "rotation", "scale"]);
    const position = tuple<Vec3Tuple>(
        transformInput.position,
        3,
        `${path}.transform.position`,
    );
    const rotation = tuple<QuaternionTuple>(
        transformInput.rotation,
        4,
        `${path}.transform.rotation`,
    );
    const rotationLength = Math.hypot(...rotation);
    if (Math.abs(rotationLength - 1) > 1e-4)
        invalid(`${path}.transform.rotation`, "must be a unit quaternion");
    if (Math.abs(rotation[0]) > 1e-6 || Math.abs(rotation[2]) > 1e-6)
        invalid(`${path}.transform.rotation`, "level surfaces may rotate around Y only");
    const scale = positiveTuple(transformInput.scale, `${path}.transform.scale`);

    const visualInput = record(input.visual, `${path}.visual`);
    exactKeys(visualInput, `${path}.visual`, ["kind", "material"]);
    if (visualInput.kind !== "box")
        invalid(`${path}.visual.kind`, 'expected "box"');
    if (visualInput.material !== "ground" && visualInput.material !== "platform")
        invalid(`${path}.visual.material`, 'expected "ground" or "platform"');

    const collisionInput = record(input.collision, `${path}.collision`);
    exactKeys(collisionInput, `${path}.collision`, ["kind", "dimensions"]);
    if (collisionInput.kind !== "box")
        invalid(`${path}.collision.kind`, 'expected "box"');
    const dimensions = positiveTuple(
        collisionInput.dimensions,
        `${path}.collision.dimensions`,
    );

    return {
        id,
        role,
        transform: { position, rotation, scale },
        visual: { kind: "box", material: visualInput.material },
        collision: { kind: "box", dimensions },
    };
}

export function parseLevelDefinition(value: unknown): LevelDefinition {
    const input = record(value, "level");
    exactKeys(input, "level", ["formatVersion", "id", "spawnPosition", "objects"]);
    if (input.formatVersion !== 1)
        invalid("level.formatVersion", "expected supported version 1");

    const id = string(input.id, "level.id");
    if (!/^[a-z0-9][a-z0-9-]*$/.test(id))
        invalid("level.id", "must use lowercase letters, numbers, and hyphens");
    const spawnPosition = tuple<Vec3Tuple>(input.spawnPosition, 3, "level.spawnPosition");
    if (!Array.isArray(input.objects)) invalid("level.objects", "expected an array");

    const objects = input.objects.map((object, index) =>
        parseObject(object, `level.objects[${index}]`),
    );
    const objectIds = new Set<string>();
    let groundCount = 0;
    for (const object of objects) {
        if (objectIds.has(object.id))
            invalid("level.objects", `duplicate object id "${object.id}"`);
        objectIds.add(object.id);
        if (object.role === "ground") groundCount++;
    }
    if (groundCount !== 1) invalid("level.objects", "must contain exactly one ground object");

    return { formatVersion: 1, id, spawnPosition, objects };
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
    return level.objects.map((object) => {
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
