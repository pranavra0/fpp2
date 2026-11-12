import type {
    LevelDefinition,
    LevelTriggerObjectDefinition,
    Vec3Tuple,
} from "../content/level";

export type GameplayMode = "active" | "complete";
export type GameplayEvent = "checkpoint" | "failure" | "complete";
export type GameplayProgress = {
    mode: GameplayMode;
    checkpointId: string | null;
    respawnPosition: Vec3Tuple;
    previousPosition: Vec3Tuple;
    insideTriggerIds: Set<string>;
    event: GameplayEvent | null;
    eventRemaining: number;
};

export function createGameplayProgress(level: LevelDefinition): GameplayProgress {
    return {
        mode: "active",
        checkpointId: null,
        respawnPosition: level.spawnPosition,
        previousPosition: level.spawnPosition,
        insideTriggerIds: new Set(),
        event: null,
        eventRemaining: 0,
    };
}

function localPoint(trigger: LevelTriggerObjectDefinition, point: Vec3Tuple): Vec3Tuple {
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

function halfExtents(trigger: LevelTriggerObjectDefinition): Vec3Tuple {
    return [
        trigger.transform.scale[0] * trigger.collision.dimensions[0] * 0.5,
        trigger.transform.scale[1] * trigger.collision.dimensions[1] * 0.5,
        trigger.transform.scale[2] * trigger.collision.dimensions[2] * 0.5,
    ];
}

export function pointInsideTrigger(
    trigger: LevelTriggerObjectDefinition,
    point: Vec3Tuple,
): boolean {
    const local = localPoint(trigger, point);
    const half = halfExtents(trigger);
    return Math.abs(local[0]) <= half[0] && Math.abs(local[1]) <= half[1] && Math.abs(local[2]) <= half[2];
}

export function segmentTriggerEntry(
    trigger: LevelTriggerObjectDefinition,
    start: Vec3Tuple,
    end: Vec3Tuple,
): number | undefined {
    const from = localPoint(trigger, start);
    const to = localPoint(trigger, end);
    const half = halfExtents(trigger);
    let enter = 0;
    let exit = 1;
    for (let axis = 0; axis < 3; axis++) {
        const delta = to[axis]! - from[axis]!;
        if (Math.abs(delta) < 1e-8) {
            if (from[axis]! < -half[axis]! || from[axis]! > half[axis]!) return undefined;
            continue;
        }
        const first = (-half[axis]! - from[axis]!) / delta;
        const second = (half[axis]! - from[axis]!) / delta;
        enter = Math.max(enter, Math.min(first, second));
        exit = Math.min(exit, Math.max(first, second));
        if (enter > exit) return undefined;
    }
    return exit >= 0 && enter <= 1 ? Math.max(0, enter) : undefined;
}

export function segmentIntersectsTrigger(
    trigger: LevelTriggerObjectDefinition,
    start: Vec3Tuple,
    end: Vec3Tuple,
): boolean {
    return segmentTriggerEntry(trigger, start, end) !== undefined;
}

export function advanceGameplay(
    level: LevelDefinition,
    progress: GameplayProgress,
    previousPosition: Vec3Tuple,
    currentPosition: Vec3Tuple,
): GameplayEvent | null {
    if (progress.mode !== "active") return null;
    if (currentPosition[1] < level.failureBoundaryY) {
        progress.event = "failure";
        progress.eventRemaining = 1.5;
        return "failure";
    }

    let activatedCheckpoint: { object: LevelTriggerObjectDefinition; entry: number } | undefined;
    for (const object of level.objects) {
        if (object.role !== "checkpoint" && object.role !== "goal") continue;
        const entry = segmentTriggerEntry(object, previousPosition, currentPosition);
        const inside = pointInsideTrigger(object, currentPosition);
        const wasInside = progress.insideTriggerIds.has(object.id);
        if (
            object.role === "checkpoint" &&
            entry !== undefined &&
            !wasInside &&
            (activatedCheckpoint === undefined || entry > activatedCheckpoint.entry)
        ) {
            activatedCheckpoint = { object, entry };
        }
        if (inside) progress.insideTriggerIds.add(object.id);
        else progress.insideTriggerIds.delete(object.id);
    }

    if (activatedCheckpoint) {
        progress.checkpointId = activatedCheckpoint.object.id;
        progress.respawnPosition = activatedCheckpoint.object.transform.position;
        progress.event = "checkpoint";
        progress.eventRemaining = 2;
    }

    const goal = level.objects.find(
        (object): object is LevelTriggerObjectDefinition =>
            object.role === "goal" && object.collision.kind === "trigger-box",
    );
    if (goal && segmentTriggerEntry(goal, previousPosition, currentPosition) !== undefined) {
        progress.mode = "complete";
        progress.event = "complete";
        progress.eventRemaining = Number.POSITIVE_INFINITY;
        return "complete";
    }
    return activatedCheckpoint ? "checkpoint" : null;
}

export function triggerObjects(level: LevelDefinition): LevelTriggerObjectDefinition[] {
    return level.objects.filter(
        (object): object is LevelTriggerObjectDefinition => object.collision.kind === "trigger-box",
    );
}

