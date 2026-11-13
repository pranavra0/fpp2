import type { LevelObjectDefinition, Vec3Tuple, QuaternionTuple } from "../content/level";
import type { TransformAxis } from "./editor-state";
import type { Vec3 } from "../vec";
const DRAG_DISTANCE = 100;
type Axis = Exclude<TransformAxis, "free">;

export function moveAxisLength(screenSize: number, halfExtent: number): number {
    return Math.max(screenSize, halfExtent + screenSize * 0.4);
}

export function moveAxisHalfExtents(
    scale: Vec3Tuple,
    rotation: QuaternionTuple,
    localHalfExtents: Vec3Tuple = [0.5, 0.5, 0.5],
): Vec3Tuple {
    const cosine = Math.abs(1 - 2 * rotation[1] * rotation[1]);
    const sine = Math.abs(2 * rotation[1] * rotation[3]);
    const halfX = scale[0] * localHalfExtents[0];
    const halfY = scale[1] * localHalfExtents[1];
    const halfZ = scale[2] * localHalfExtents[2];
    return [
        cosine * halfX + sine * halfZ,
        halfY,
        sine * halfX + cosine * halfZ,
    ];
}

export function axisVector(axis: Axis): Vec3 {
    if (axis === "x") return { x: 1, y: 0, z: 0 };
    if (axis === "y") return { x: 0, y: 1, z: 0 };
    return { x: 0, y: 0, z: 1 };
}

export function axisRotation(axis: Axis): readonly [number, number, number, number] {
    const half = Math.SQRT1_2;
    if (axis === "x") return [0, 0, -half, half];
    if (axis === "z") return [half, 0, 0, half];
    return [0, 0, 0, 1];
}

export function arrowMeshData(): { vertices: Float32Array; indices: Uint32Array } {
    const vertices: number[] = [];
    const indices: number[] = [];
    const tip: Vec3 = { x: 0, y: 0.5, z: 0 };
    const center: Vec3 = { x: 0, y: -0.5, z: 0 };
    const base = Array.from({ length: 6 }, (_, index): Vec3 => {
        const angle = (index * Math.PI * 2) / 6;
        return { x: Math.cos(angle) * 0.5, y: -0.5, z: Math.sin(angle) * 0.5 };
    });

    function triangle(a: Vec3, b: Vec3, c: Vec3): void {
        const ab = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
        const ac = { x: c.x - a.x, y: c.y - a.y, z: c.z - a.z };
        const normal = {
            x: ab.y * ac.z - ab.z * ac.y,
            y: ab.z * ac.x - ab.x * ac.z,
            z: ab.x * ac.y - ab.y * ac.x,
        };
        const length = Math.hypot(normal.x, normal.y, normal.z);
        const offset = vertices.length / 8;
        for (const point of [a, b, c])
            vertices.push(
                point.x,
                point.y,
                point.z,
                0,
                normal.x / length,
                normal.y / length,
                normal.z / length,
                0,
            );
        indices.push(offset, offset + 1, offset + 2);
    }

    for (let index = 0; index < base.length; index++) {
        const current = base[index]!;
        const next = base[(index + 1) % base.length]!;
        triangle(current, tip, next);
        triangle(center, current, next);
    }
    return { vertices: new Float32Array(vertices), indices: new Uint32Array(indices) };
}

export function closestRayAxis(
    ray: { origin: readonly [number, number, number]; dir: readonly [number, number, number] },
    origin: Vec3,
    axis: Vec3,
): { axisParameter: number; distance: number } | undefined {
    const dx = ray.dir[0];
    const dy = ray.dir[1];
    const dz = ray.dir[2];
    const wx = ray.origin[0] - origin.x;
    const wy = ray.origin[1] - origin.y;
    const wz = ray.origin[2] - origin.z;
    const directionDotAxis = dx * axis.x + dy * axis.y + dz * axis.z;
    const directionDotOffset = dx * wx + dy * wy + dz * wz;
    const axisDotOffset = axis.x * wx + axis.y * wy + axis.z * wz;
    const denominator = dx * dx + dy * dy + dz * dz - directionDotAxis * directionDotAxis;
    if (denominator < 1e-6) return undefined;
    const rayParameter =
        (directionDotAxis * axisDotOffset - directionDotOffset) / denominator;
    if (rayParameter < 0) return undefined;
    const axisParameter = axisDotOffset + directionDotAxis * rayParameter;
    const rayX = ray.origin[0] + dx * rayParameter;
    const rayY = ray.origin[1] + dy * rayParameter;
    const rayZ = ray.origin[2] + dz * rayParameter;
    const axisX = origin.x + axis.x * axisParameter;
    const axisY = origin.y + axis.y * axisParameter;
    const axisZ = origin.z + axis.z * axisParameter;
    return {
        axisParameter,
        distance: Math.hypot(rayX - axisX, rayY - axisY, rayZ - axisZ),
    };
}

export function raySphereDistance(
    origin: readonly [number, number, number],
    direction: readonly [number, number, number],
    center: Vec3,
    radius: number,
): number | undefined {
    const ox = origin[0] - center.x;
    const oy = origin[1] - center.y;
    const oz = origin[2] - center.z;
    const projection = ox * direction[0] + oy * direction[1] + oz * direction[2];
    const discriminant = projection * projection - (ox * ox + oy * oy + oz * oz - radius * radius);
    if (discriminant < 0) return undefined;
    const near = -projection - Math.sqrt(discriminant);
    const far = -projection + Math.sqrt(discriminant);
    if (near >= 0) return near;
    return far >= 0 ? far : undefined;
}

export function rayTriggerDistance(
    origin: readonly [number, number, number],
    direction: readonly [number, number, number],
    object: LevelObjectDefinition,
): number | undefined {
    if (object.collision.kind !== "trigger-box") return undefined;
    const rotationY = 2 * Math.atan2(object.transform.rotation[1], object.transform.rotation[3]);
    const cosine = Math.cos(rotationY);
    const sine = Math.sin(rotationY);
    const dx = origin[0] - object.transform.position[0];
    const dz = origin[2] - object.transform.position[2];
    const localOrigin = [
        cosine * dx - sine * dz,
        origin[1] - object.transform.position[1],
        sine * dx + cosine * dz,
    ];
    const localDirection = [
        cosine * direction[0] - sine * direction[2],
        direction[1],
        sine * direction[0] + cosine * direction[2],
    ];
    const half = object.transform.scale.map(
        (scale, axis) => scale * object.collision.dimensions[axis]! * 0.5,
    );
    let enter = 0;
    let exit = DRAG_DISTANCE;
    for (let axis = 0; axis < 3; axis++) {
        const delta = localDirection[axis]!;
        if (Math.abs(delta) < 1e-8) {
            if (localOrigin[axis]! < -half[axis]! || localOrigin[axis]! > half[axis]!)
                return undefined;
            continue;
        }
        const first = (-half[axis]! - localOrigin[axis]!) / delta;
        const second = (half[axis]! - localOrigin[axis]!) / delta;
        enter = Math.max(enter, Math.min(first, second));
        exit = Math.min(exit, Math.max(first, second));
        if (enter > exit) return undefined;
    }
    return exit >= 0 && enter <= DRAG_DISTANCE ? Math.max(0, enter) : undefined;
}

export function intersectPlane(
    ray: { origin: readonly [number, number, number]; dir: readonly [number, number, number] },
    position: Vec3,
    normal: Vec3,
): Vec3 | undefined {
    const denominator = ray.dir[0] * normal.x + ray.dir[1] * normal.y + ray.dir[2] * normal.z;
    if (Math.abs(denominator) < 1e-5) return undefined;
    const distance = (
        (position.x - ray.origin[0]) * normal.x +
        (position.y - ray.origin[1]) * normal.y +
        (position.z - ray.origin[2]) * normal.z
    ) / denominator;
    if (distance < 0) return undefined;
    return {
        x: ray.origin[0] + ray.dir[0] * distance,
        y: ray.origin[1] + ray.dir[1] * distance,
        z: ray.origin[2] + ray.dir[2] * distance,
    };
}

export function snapValue(value: number, step: number): number {
    return step > 0 ? Math.round(value / step) * step : value;
}

export function constrained(delta: Vec3, axis: TransformAxis): Vec3 {
    if (axis === "x") return { x: delta.x, y: 0, z: 0 };
    if (axis === "y") return { x: 0, y: delta.y, z: 0 };
    if (axis === "z") return { x: 0, y: 0, z: delta.z };
    return delta;
}
