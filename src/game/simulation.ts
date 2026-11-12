import { type World } from "@dylanebert/shallot";
import { StepPhysicsSystem } from "@dylanebert/shallot/standard/physics";
import { DEFAULT_TUNING } from "../config/gameplay";
import { simulationSubstepCount, step } from "../sim";
import { findLandingSurface } from "./physics";
import { updateLandingMarker, updateVisualFeedback, writePose } from "./presentation";
import { editorState, isEditing } from "./editor-state";
import { runtime } from "./state";
import { gameplayProgress } from "./gameplay-state";
import { playGameAudio } from "./audio";
import { activeLevel } from "./state";
import { PLAYER_TRIGGER_CAPSULE, sweepCapsuleTriggers } from "./trigger-contact";

export const Simulate = {
    name: "PogoSimulation",
    group: "fixed" as const,
    after: [StepPhysicsSystem],
    update(world: World): void {
        if (isEditing(world.resource(editorState))) return;
        const state = world.resource(runtime);
        if (world.resource(gameplayProgress).mode !== "active") return;
        state.previousCameraFocus.x = state.cameraFocus.x;
        state.previousCameraFocus.y = state.cameraFocus.y;
        state.previousCameraFocus.z = state.cameraFocus.z;
        state.previousCameraImpact = state.cameraImpact;
        const substepCount = simulationSubstepCount(
            world.time.fixedDeltaTime,
            DEFAULT_TUNING,
        );
        for (let index = 0; index < substepCount; index++) {
            state.controls.jumpPressed = state.pendingJumpPress;
            const previousPosition = [
                state.sim.body.pos.x,
                state.sim.body.pos.y,
                state.sim.body.pos.z,
            ] as const;
            const incomingVerticalVelocity = state.sim.body.vel.y;
            const previousContactId = state.sim.pogo.contactId;
            const previousLaunchId = state.sim.pogo.lastLaunchedContactId;
            step(state.sim, DEFAULT_TUNING, state.controls, (sweep) =>
                findLandingSurface(world, sweep),
            );
            const currentPosition = [
                state.sim.body.pos.x,
                state.sim.body.pos.y,
                state.sim.body.pos.z,
            ] as const;
            world.resource(gameplayProgress).pendingContactSteps.push(
                sweepCapsuleTriggers(
                    activeLevel(state),
                    previousPosition,
                    currentPosition,
                    PLAYER_TRIGGER_CAPSULE,
                ),
            );
            // Consume the buffered edge once so multiple substeps cannot start multiple charges.
            state.pendingJumpPress = false;
            if (state.sim.pogo.contactId !== previousContactId)
                playGameAudio(world, "landing", Math.min(1, Math.max(0.35, -incomingVerticalVelocity / 12)));
            if (state.sim.pogo.lastLaunchedContactId !== previousLaunchId)
                playGameAudio(world, "launch", 0.75);
            const impactSpeed =
                state.sim.pogo.contactId !== previousContactId
                    ? Math.max(0, -incomingVerticalVelocity)
                    : 0;
            updateVisualFeedback(state, 1 / DEFAULT_TUNING.SIM_HZ, impactSpeed);
        }
        state.controls.jumpPressed = false;
        writePose(world, state);
        updateLandingMarker(world, state);
    },
};
