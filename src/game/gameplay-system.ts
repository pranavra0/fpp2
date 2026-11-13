import { flatMaterial } from "./visual-mesh";
import { resetPlatforms } from "./platforms";
import {
    MeshMaterial,
    releasePointerLock,
    requirePointerLock,
    type World,
} from "@dylanebert/shallot";
import { activeLevel, clearMovement, resetPlayerToPosition, runtime } from "./state";
import { gameplayProgress, resetGameplayProgress } from "./gameplay-state";
import { advanceGameplay, type GameplayEvent } from "./gameplay";
import { playGameAudio } from "./audio";
import { editorState, isEditing } from "./editor-state";
import { updateLandingMarker, writePose } from "./presentation";
import { Simulate } from "./simulation";
import { overlappingCapsuleTriggers, PLAYER_TRIGGER_CAPSULE } from "./trigger-contact";

function playerPosition(world: World): readonly [number, number, number] {
    const position = world.resource(runtime).sim.body.pos;
    return [position.x, position.y, position.z];
}

function setCheckpointMaterials(world: World): void {
    const state = world.resource(runtime);
    const progress = world.resource(gameplayProgress);
    const meshMaterials = world.storage(MeshMaterial).material;
    for (const entity of state.levelEntities) {
        if (entity.object.role !== "checkpoint") continue;
        if (!entity.visualEids || entity.visualEids.length === 0)
            throw new Error(`Checkpoint visual missing for level object "${entity.id}"`);
        for (const visualEid of entity.visualEids) {
            meshMaterials.set(
                visualEid,
                entity.id === progress.checkpointId
                    ? state.activeCheckpointMaterial
                    : world.resource(flatMaterial).material,
            );
        }
    }
}

function syncTriggerOverlaps(world: World): void {
    const progress = world.resource(gameplayProgress);
    progress.insideTriggerIds.clear();
    const position = playerPosition(world);
    for (const id of overlappingCapsuleTriggers(activeLevel(world.resource(runtime)), position, PLAYER_TRIGGER_CAPSULE))
        progress.insideTriggerIds.add(id);
    progress.pendingContactSteps.length = 0;
}

/** Restart at the level spawn or retain the active checkpoint, then reset platform and trigger state. */
export function restartGameplay(world: World, fromStart: boolean): void {
    const state = world.resource(runtime);
    const level = activeLevel(state);
    const progress = world.resource(gameplayProgress);
    const checkpointId = fromStart ? null : progress.checkpointId;
    const respawnPosition = fromStart ? level.spawnPosition : progress.respawnPosition;
    if (fromStart) resetGameplayProgress(progress, level);
    else {
        progress.mode = "active";
        progress.checkpointId = checkpointId;
        progress.respawnPosition = respawnPosition;
        progress.insideTriggerIds.clear();
        progress.event = null;
        progress.eventRemaining = 0;
        progress.pendingContactSteps.length = 0;
    }
    resetGameplayWorld(world);
    requirePointerLock(world, true);
}

/** Consume simulation trigger sweeps after `Simulate` and apply gameplay state transitions. */
export const GameplayProgression = {
    name: "GameplayProgression",
    group: "fixed" as const,
    after: [Simulate],
    update(world: World): void {
        if (isEditing(world.resource(editorState))) return;
        const state = world.resource(runtime);
        const level = activeLevel(state);
        const progress = world.resource(gameplayProgress);
        const current = playerPosition(world);

        if (progress.mode === "active") {
            const contactSteps = progress.pendingContactSteps.splice(0);
            const event = advanceGameplay(level, progress, current, contactSteps);
            if (event) handleGameplayEvent(world, event);
        } else {
            progress.pendingContactSteps.length = 0;
        }

        if (progress.eventRemaining > 0 && progress.event !== "complete") {
            progress.eventRemaining = Math.max(0, progress.eventRemaining - world.time.fixedDeltaTime);
            if (progress.eventRemaining === 0) progress.event = null;
        }
    },
};

function handleGameplayEvent(world: World, event: GameplayEvent): void {
    const state = world.resource(runtime);
    const progress = world.resource(gameplayProgress);
    if (event === "checkpoint") {
        setCheckpointMaterials(world);
        playGameAudio(world, "checkpoint", 0.9);
    } else if (event === "failure") {
        playGameAudio(world, "failure", 0.8);
        resetGameplayWorld(world);
    } else {
        setCheckpointMaterials(world);
        playGameAudio(world, "complete", 0.9);
        clearMovement(state);
        requirePointerLock(world, false);
        releasePointerLock(world);
    }
}

export function resetGameplayWorld(world: World): void {
    const state = world.resource(runtime);
    resetPlayerToPosition(state, world.resource(gameplayProgress).respawnPosition);
    resetPlatforms(world, state.levelEntities, isEditing(world.resource(editorState)));
    syncTriggerOverlaps(world);
    setCheckpointMaterials(world);
    writePose(world, state);
    updateLandingMarker(world, state);
}

export function initializeGameplay(world: World): void {
    resetGameplayProgress(world.resource(gameplayProgress), activeLevel(world.resource(runtime)));
    resetGameplayWorld(world);
}

export function resetGameplayToSpawn(world: World): void {
    initializeGameplay(world);
}
