import type { Resource } from "@dylanebert/shallot";
import type { LevelDefinition } from "../content/level";
import { createGameplayProgress, type GameplayProgress } from "./gameplay";

export const gameplayProgress: Resource<GameplayProgress> = {
    create: () => ({
        mode: "active",
        checkpointId: null,
        respawnPosition: [0, 0, 0],
        insideTriggerIds: new Set(),
        pendingContactSteps: [],
        event: null,
        eventRemaining: 0,
    }),
};

export function resetGameplayProgress(progress: GameplayProgress, level: LevelDefinition): void {
    Object.assign(progress, createGameplayProgress(level));
}
