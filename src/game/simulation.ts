import { advancePlatforms, confirmPlatformContact, platformSupport } from "./platforms";
import { type World } from "@dylanebert/shallot";
import { StepPhysicsSystem } from "@dylanebert/shallot/standard/physics";
import { DEFAULT_TUNING } from "../config/gameplay";
import { simulationSubstepCount } from "../sim";
import { step } from "./simulation-step";
import { findLandingSurface } from "./physics";
import { findPlayerContact } from "./player-collision";
import { updateLandingMarker, updateVisualFeedback, writePose } from "./presentation";
import { editorState, isEditing } from "./editor-state";
import { runtime } from "./state";
import { gameplayProgress } from "./gameplay-state";
import { playGameAudio } from "./audio";
import { activeLevel } from "./state";
import { PLAYER_TRIGGER_CAPSULE, sweepCapsuleTriggers } from "./trigger-contact";

/** Fixed gameplay simulation; runs after engine physics and before gameplay progression. */
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
            advancePlatforms(world, state.levelEntities, state.sim, 1 / DEFAULT_TUNING.SIM_HZ);
            const contact = step(state.sim, DEFAULT_TUNING, state.controls,
                sweep => findLandingSurface(world, sweep),
                sweep => findPlayerContact(world, sweep),
                platformSupport(world, state.sim),
            );
            confirmPlatformContact(world, contact);
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
            // One input edge can start one charge even when an ECS step contains multiple simulation ticks.
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
