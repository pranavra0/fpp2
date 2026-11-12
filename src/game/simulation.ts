import { type World } from "@dylanebert/shallot";
import { StepPhysicsSystem } from "@dylanebert/shallot/standard/physics";
import { DEFAULT_TUNING } from "../config/gameplay";
import { simulationSubstepCount, step } from "../sim";
import { findLandingSurface } from "./physics";
import { updateLandingMarker, updateVisualFeedback, writePose } from "./presentation";
import { runtime } from "./state";

export const Simulate = {
    name: "PogoSimulation",
    group: "fixed" as const,
    after: [StepPhysicsSystem],
    update(world: World): void {
        const state = world.resource(runtime);
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
            const incomingVerticalVelocity = state.sim.body.vel.y;
            const previousContactId = state.sim.pogo.contactId;
            step(state.sim, DEFAULT_TUNING, state.controls, (sweep) =>
                findLandingSurface(world, sweep),
            );
            // Consume the buffered edge once so multiple substeps cannot start multiple charges.
            state.pendingJumpPress = false;
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
