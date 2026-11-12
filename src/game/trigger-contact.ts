import type { LevelDefinition, LevelTriggerObjectDefinition, Vec3Tuple } from "../content/level";
import {
    PLAYER_TRIGGER_CAPSULE_DIAMETER_M,
    PLAYER_TRIGGER_CAPSULE_HEIGHT_M,
} from "../config/gameplay";

export type TriggerContact = { id: string; fraction: number };

export type TriggerContactStep = {
    contacts: readonly TriggerContact[];
    insideTriggerIds: readonly string[];
};

export type TriggerCapsule = { diameter: number; height: number };

export const PLAYER_TRIGGER_CAPSULE: TriggerCapsule = {
    diameter: PLAYER_TRIGGER_CAPSULE_DIAMETER_M,
    height: PLAYER_TRIGGER_CAPSULE_HEIGHT_M,
};

function localPoint(
    trigger: LevelTriggerObjectDefinition,
    point: Vec3Tuple,
): [number, number, number] {
    const [, y, , w] = trigger.transform.rotation;
    const rotationY = 2 * Math.atan2(y, w);
    const dx = point[0] - trigger.transform.position[0];
    const dz = point[2] - trigger.transform.position[2];
    const cosine = Math.cos(rotationY);
    const sine = Math.sin(rotationY);
    return [
        cosine * dx - sine * dz,
        point[1] - trigger.transform.position[1],
        sine * dx + cosine * dz,
    ];
}

function triggerHalfExtents(trigger: LevelTriggerObjectDefinition): [number, number, number] {
    return [
        trigger.transform.scale[0] * trigger.collision.dimensions[0] * 0.5,
        trigger.transform.scale[1] * trigger.collision.dimensions[1] * 0.5,
        trigger.transform.scale[2] * trigger.collision.dimensions[2] * 0.5,
    ];
}

function capsuleSegmentHalfLength(capsule: TriggerCapsule): number {
    return capsule.height * 0.5 - capsule.diameter * 0.5;
}

export function capsuleOverlapsTrigger(
    trigger: LevelTriggerObjectDefinition,
    position: Vec3Tuple,
    capsule: TriggerCapsule,
): boolean {
    const local = localPoint(trigger, position);
    const half = triggerHalfExtents(trigger);
    half[1] += capsuleSegmentHalfLength(capsule);
    let distanceSquared = 0;
    for (let axis = 0; axis < 3; axis++) {
        const distance = Math.max(Math.abs(local[axis]!) - half[axis]!, 0);
        distanceSquared += distance * distance;
    }
    const radius = capsule.diameter * 0.5;
    return distanceSquared <= radius * radius;
}

function entryInInterval(
    start: readonly [number, number, number],
    delta: readonly [number, number, number],
    half: readonly [number, number, number],
    radius: number,
    from: number,
    to: number,
): number | undefined {
    const midpoint = (from + to) * 0.5;
    let quadratic = 0;
    let linear = 0;
    let constant = -radius * radius;
    for (let axis = 0; axis < 3; axis++) {
        const value = start[axis]! + delta[axis]! * midpoint;
        let slope = 0;
        let intercept = 0;
        if (value < -half[axis]!) {
            slope = delta[axis]!;
            intercept = start[axis]! + half[axis]!;
        } else if (value > half[axis]!) {
            slope = delta[axis]!;
            intercept = start[axis]! - half[axis]!;
        }
        quadratic += slope * slope;
        linear += 2 * slope * intercept;
        constant += intercept * intercept;
    }

    const valueAt = (fraction: number) =>
        (quadratic * fraction + linear) * fraction + constant;
    if (valueAt(from) <= 0) return from;
    if (quadratic === 0) return undefined;

    const minimum = Math.max(from, Math.min(to, -linear / (2 * quadratic)));
    if (valueAt(minimum) > 0) return undefined;
    const discriminant = linear * linear - 4 * quadratic * constant;
    if (discriminant < 0) return minimum;
    const root = (-linear - Math.sqrt(discriminant)) / (2 * quadratic);
    return Math.max(from, Math.min(to, root));
}

export function capsuleTriggerEntry(
    trigger: LevelTriggerObjectDefinition,
    start: Vec3Tuple,
    end: Vec3Tuple,
    capsule: TriggerCapsule,
): number | undefined {
    const localStart = localPoint(trigger, start);
    const localEnd = localPoint(trigger, end);
    const delta = [
        localEnd[0] - localStart[0],
        localEnd[1] - localStart[1],
        localEnd[2] - localStart[2],
    ] as const;
    const half = triggerHalfExtents(trigger);
    half[1] += capsuleSegmentHalfLength(capsule);
    const breakpoints = [0, 1];
    for (let axis = 0; axis < 3; axis++) {
        const velocity = delta[axis]!;
        if (velocity === 0) continue;
        for (const boundary of [-half[axis]!, half[axis]!]) {
            const fraction = (boundary - localStart[axis]!) / velocity;
            if (fraction > 0 && fraction < 1) breakpoints.push(fraction);
        }
    }
    breakpoints.sort((a, b) => a - b);
    const uniqueBreakpoints = breakpoints.filter(
        (value, index) => index === 0 || value !== breakpoints[index - 1],
    );
    const radius = capsule.diameter * 0.5;
    for (let index = 0; index < uniqueBreakpoints.length - 1; index++) {
        const from = uniqueBreakpoints[index]!;
        const to = uniqueBreakpoints[index + 1]!;
        const entry = entryInInterval(localStart, delta, half, radius, from, to);
        if (entry !== undefined) return entry;
    }
    return undefined;
}

export function sweepCapsuleTriggers(
    level: LevelDefinition,
    start: Vec3Tuple,
    end: Vec3Tuple,
    capsule: TriggerCapsule,
): TriggerContactStep {
    const contacts: TriggerContact[] = [];
    const insideTriggerIds: string[] = [];
    for (const object of level.objects) {
        if (object.role !== "goal" && object.role !== "checkpoint") continue;
        if (capsuleOverlapsTrigger(object, end, capsule)) insideTriggerIds.push(object.id);
        const fraction = capsuleTriggerEntry(object, start, end, capsule);
        if (fraction !== undefined) contacts.push({ id: object.id, fraction });
    }
    contacts.sort((a, b) => a.fraction - b.fraction || a.id.localeCompare(b.id));
    return { contacts, insideTriggerIds };
}

export function overlappingCapsuleTriggers(
    level: LevelDefinition,
    position: Vec3Tuple,
    capsule: TriggerCapsule,
): string[] {
    return level.objects.flatMap((object) => {
        if (object.role !== "goal" && object.role !== "checkpoint") return [];
        return capsuleOverlapsTrigger(object, position, capsule) ? [object.id] : [];
    });
}
