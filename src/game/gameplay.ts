import type {
    LevelDefinition,
    LevelTriggerObjectDefinition,
    Vec3Tuple,
} from "../content/level";
import type { TriggerContactStep } from "./trigger-contact";

export type GameplayMode = "active" | "complete";
export type GameplayEvent = "checkpoint" | "failure" | "complete";
export type GameplayProgress = {
    mode: GameplayMode;
    checkpointId: string | null;
    respawnPosition: Vec3Tuple;
    insideTriggerIds: Set<string>;
    pendingContactSteps: TriggerContactStep[];
    event: GameplayEvent | null;
    eventRemaining: number;
};

export function createGameplayProgress(level: LevelDefinition): GameplayProgress {
    return {
        mode: "active",
        checkpointId: null,
        respawnPosition: level.spawnPosition,
        insideTriggerIds: new Set(),
        pendingContactSteps: [],
        event: null,
        eventRemaining: 0,
    };
}

export function advanceGameplay(
    level: LevelDefinition,
    progress: GameplayProgress,
    currentPosition: Vec3Tuple,
    contactSteps: readonly TriggerContactStep[],
): GameplayEvent | null {
    if (progress.mode !== "active") return null;
    if (currentPosition[1] < level.failureBoundaryY) {
        progress.event = "failure";
        progress.eventRemaining = 1.5;
        return "failure";
    }

    const triggerById = new Map(
        triggerObjects(level).map((trigger) => [trigger.id, trigger]),
    );
    let activatedCheckpoint = false;
    for (const step of contactSteps) {
        for (const contact of step.contacts) {
            if (progress.insideTriggerIds.has(contact.id)) continue;
            const trigger = triggerById.get(contact.id);
            if (!trigger) continue;
            if (trigger.role === "goal") {
                progress.mode = "complete";
                progress.event = "complete";
                progress.eventRemaining = Number.POSITIVE_INFINITY;
                progress.insideTriggerIds = new Set(step.insideTriggerIds);
                return "complete";
            }
            progress.checkpointId = trigger.id;
            progress.respawnPosition = trigger.transform.position;
            progress.event = "checkpoint";
            progress.eventRemaining = 2;
            activatedCheckpoint = true;
        }
        progress.insideTriggerIds = new Set(step.insideTriggerIds);
    }
    return activatedCheckpoint ? "checkpoint" : null;
}

export function triggerObjects(level: LevelDefinition): LevelTriggerObjectDefinition[] {
    return level.objects.filter(
        (object): object is LevelTriggerObjectDefinition => object.collision.kind === "trigger-box",
    );
}

