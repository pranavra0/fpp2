import { PlatformPose } from "./platform-components";
import type { World } from "@dylanebert/shallot";
import { PLAYER_TRIGGER_CAPSULE_DIAMETER_M, PLAYER_TRIGGER_CAPSULE_HEIGHT_M } from "../config/gameplay";
import type { PlayerContact, PlayerPose, PlayerSweep } from "../sim";
import type { Vec3 } from "../vec";
import { LandingSurface } from "./physics";

const AXES = ["x", "y", "z"] as const;
const SKIN = 0.0001;
const ROD_RADIUS = 0.1;
type Capsule = { a: Vec3; b: Vec3; radius: number };

function mix(a: Vec3, b: Vec3, t: number): Vec3 {
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
}

function capsules(pose: PlayerPose): Capsule[] {
    const radius = PLAYER_TRIGGER_CAPSULE_DIAMETER_M / 2;
    const halfSegment = PLAYER_TRIGGER_CAPSULE_HEIGHT_M / 2 - radius;
    return [
        { a: { ...pose.position, y: pose.position.y - halfSegment },
            b: { ...pose.position, y: pose.position.y + halfSegment }, radius },
        { a: { ...pose.tip, y: pose.tip.y + ROD_RADIUS }, b: { ...pose.position }, radius: ROD_RADIUS },
    ];
}

// Each interval has a fixed set of outside axes, making squared distance quadratic.
function segmentBoxDistance(a: Vec3, b: Vec3, half: Vec3): { distance: number; normal: Vec3 } {
    const delta = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
    const breaks = [0, 1];
    for (const axis of AXES) {
        if (delta[axis] === 0) continue;
        for (const side of [-half[axis], half[axis]]) {
            const t = (side - a[axis]) / delta[axis];
            if (t > 0 && t < 1) breaks.push(t);
        }
    }
    breaks.sort((x, y) => x - y);
    let bestSquared = Infinity;
    let normal: Vec3 = { x: 0, y: 1, z: 0 };
    const consider = (t: number): void => {
        const point = mix(a, b, t);
        const offset = { x: 0, y: 0, z: 0 };
        for (const axis of AXES)
            offset[axis] = point[axis] - Math.max(-half[axis], Math.min(half[axis], point[axis]));
        const squared = offset.x ** 2 + offset.y ** 2 + offset.z ** 2;
        if (squared < bestSquared) {
            bestSquared = squared;
            if (squared > 0) {
                const length = Math.sqrt(squared);
                normal = { x: offset.x / length, y: offset.y / length, z: offset.z / length };
            } else {
                const axis = AXES.reduce((best, next) => half[next] - Math.abs(point[next]) < half[best] - Math.abs(point[best]) ? next : best);
                normal = { x: 0, y: 0, z: 0 };
                normal[axis] = point[axis] < 0 ? -1 : 1;
            }
        }
    };
    for (let index = 1; index < breaks.length; index++) {
        const lo = breaks[index - 1]!;
        const hi = breaks[index]!;
        const mid = mix(a, b, (lo + hi) / 2);
        let numerator = 0;
        let denominator = 0;
        for (const axis of AXES) {
            if (Math.abs(mid[axis]) <= half[axis]) continue;
            const side = mid[axis] < 0 ? -half[axis] : half[axis];
            numerator += delta[axis] * (a[axis] - side);
            denominator += delta[axis] ** 2;
        }
        consider(lo);
        consider(hi);
        if (denominator > 0) consider(Math.max(lo, Math.min(hi, -numerator / denominator)));
    }
    return { distance: Math.sqrt(bestSquared), normal };
}

function sweepCapsule(previous: Capsule, current: Capsule, half: Vec3): PlayerContact | undefined {
    const da = { x: current.a.x - previous.a.x, y: current.a.y - previous.a.y, z: current.a.z - previous.a.z };
    const db = { x: current.b.x - previous.b.x, y: current.b.y - previous.b.y, z: current.b.z - previous.b.z };
    const speed = Math.max(Math.hypot(da.x, da.y, da.z), Math.hypot(db.x, db.y, db.z));
    if (speed < 1e-10) return undefined;
    let fraction = 0;
    for (let iteration = 0; iteration < 64; iteration++) {
        const { distance, normal } = segmentBoxDistance(mix(previous.a, current.a, fraction), mix(previous.b, current.b, fraction), half);
        const closing = Math.min(...[da, db].map(d => d.x * normal.x + d.y * normal.y + d.z * normal.z));
        if (closing >= -1e-10) return undefined;
        const separation = distance - previous.radius;
        if (separation <= SKIN) return { fraction, normal };
        // The separating plane bounds both endpoints throughout rotation and extension.
        fraction += (separation - SKIN * 0.5) / -closing;
        if (fraction > 1) return undefined;
    }
    throw new Error("Player collision sweep failed to converge");
}

export function findPlayerContact(world: World, sweep: PlayerSweep): PlayerContact | undefined {
    const surfaces = world.storage(LandingSurface);
    const poses = world.storage(PlatformPose);
    const previous = capsules(sweep.previous);
    const current = capsules(sweep.current);
    let first: PlayerContact | undefined;
    for (const eid of world.query([LandingSurface])) {
        if (surfaces.oneWay.get(eid) || !poses.available.get(eid)) continue;
        const displacement = { x: poses.x.get(eid) - poses.previousX.get(eid), y: poses.y.get(eid) - poses.previousY.get(eid), z: poses.z.get(eid) - poses.previousZ.get(eid) };
        const startFraction = sweep.startFraction ?? 0;
        const cosine = Math.cos(surfaces.rotationY.get(eid));
        const sine = Math.sin(surfaces.rotationY.get(eid));
        const centerX = surfaces.centerX.get(eid);
        const centerZ = surfaces.centerZ.get(eid);
        const half = { x: surfaces.width.get(eid) / 2, y: surfaces.height.get(eid) / 2, z: surfaces.depth.get(eid) / 2 };
        const centerY = surfaces.topY.get(eid) - half.y;
        const local = (v: Vec3, previous = false): Vec3 => {
            const x = v.x - centerX + (previous ? displacement.x * (1 - startFraction) : 0);
            const y = v.y - centerY + (previous ? displacement.y * (1 - startFraction) : 0);
            const z = v.z - centerZ + (previous ? displacement.z * (1 - startFraction) : 0);
            return { x: cosine * x - sine * z, y, z: sine * x + cosine * z };
        };
        for (let index = 0; index < previous.length; index++) {
            const a = previous[index]!;
            const b = current[index]!;
            const contact = sweepCapsule({ a: local(a.a, true), b: local(a.b, true), radius: a.radius },
                { a: local(b.a), b: local(b.b), radius: b.radius }, half);
            if (!contact || (first && contact.fraction >= first.fraction)) continue;
            // Tip landings own the top plane; volume contacts still block earlier walls and ceilings.
            if (index === 1 && contact.normal.y > 0.99999 &&
                sweep.previous.tip.y >= surfaces.topY.get(eid) - displacement.y * (1 - startFraction) - 1e-6 &&
                Math.abs(sweep.current.tip.y - surfaces.topY.get(eid)) < 1e-6) continue;
            const n = contact.normal;
            first = { displacement, velocity: { x: poses.velocityX.get(eid), y: poses.velocityY.get(eid), z: poses.velocityZ.get(eid) }, fraction: contact.fraction, normal: { x: cosine * n.x + sine * n.z, y: n.y, z: -sine * n.x + cosine * n.z } };
        }
    }
    return first;
}

export function playerOccupiesSurface(world: World, eid: number, pose: PlayerPose): boolean {
    const surface = world.storage(LandingSurface);
    const cosine = Math.cos(surface.rotationY.get(eid));
    const sine = Math.sin(surface.rotationY.get(eid));
    const half = { x: surface.width.get(eid) / 2, y: surface.height.get(eid) / 2, z: surface.depth.get(eid) / 2 };
    const local = (v: Vec3): Vec3 => {
        const x = v.x - surface.centerX.get(eid), z = v.z - surface.centerZ.get(eid);
        return { x: cosine * x - sine * z, y: v.y - surface.topY.get(eid) + half.y, z: sine * x + cosine * z };
    };
    return capsules(pose).some(capsule => segmentBoxDistance(local(capsule.a), local(capsule.b), half).distance <= capsule.radius + SKIN);
}
