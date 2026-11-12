export type Vec3 = { x: number; y: number; z: number };

export function setVec3(out: Vec3, x: number, y: number, z: number): void {
    out.x = x;
    out.y = y;
    out.z = z;
}

export function normalizeVec3(value: Vec3): void {
    const length = Math.hypot(value.x, value.y, value.z);
    if (length === 0) throw new Error("cannot normalize a zero vector");
    value.x /= length;
    value.y /= length;
    value.z /= length;
}
