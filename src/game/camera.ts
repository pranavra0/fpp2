import {
    Camera,
    lookAtRotation,
    Transform,
    type World,
} from "@dylanebert/shallot";
import { PrepareViewsSystem } from "@dylanebert/shallot/rendering";
import { Simulate } from "./simulation";
import { CAMERA_TUNING } from "../config/camera";
import { runtime } from "./state";
import { clamp01 } from "./math";
import { editorState, isEditing } from "./editor-state";

export function cameraPosition(
    focus: { x: number; y: number; z: number },
    yaw: number,
    pitch: number,
    distance: number,
): { x: number; y: number; z: number } {
    const horizontal = Math.cos(pitch) * distance;
    return {
        x: focus.x + Math.sin(yaw) * horizontal,
        y: focus.y + Math.sin(pitch) * distance,
        z: focus.z + Math.cos(yaw) * horizontal,
    };
}

export function targetCameraFov(
    horizontalSpeed: number,
    fallSpeed: number,
    launchFovPulse: number,
): number {
    const speedFactor = clamp01(
        (horizontalSpeed - CAMERA_TUNING.SPEED_FOV_START_MPS) /
            (CAMERA_TUNING.SPEED_FOV_FULL_MPS - CAMERA_TUNING.SPEED_FOV_START_MPS),
    );
    const fallFactor = clamp01(
        (fallSpeed - CAMERA_TUNING.FALL_FOV_START_MPS) /
            (CAMERA_TUNING.FALL_FOV_FULL_MPS - CAMERA_TUNING.FALL_FOV_START_MPS),
    );
    return Math.min(
        CAMERA_TUNING.MAX_FOV_DEG,
        CAMERA_TUNING.BASE_FOV_DEG +
            speedFactor * CAMERA_TUNING.SPEED_FOV_MAX_DEG +
            fallFactor * CAMERA_TUNING.FALL_FOV_MAX_DEG +
            launchFovPulse * CAMERA_TUNING.LAUNCH_FOV_MAX_DEG,
    );
}

export const FollowCamera = {
    name: "PogoCamera",
    group: "fixed" as const,
    after: [Simulate],
    update(world: World): void {
        if (isEditing(world.resource(editorState))) return;
        const state = world.resource(runtime);
        const dt = world.time.fixedDeltaTime;
        const { body } = state.sim;
        const speed = Math.hypot(body.vel.x, body.vel.z);
        const lookaheadScale = Math.min(
            CAMERA_TUNING.LOOKAHEAD_SECONDS,
            CAMERA_TUNING.LOOKAHEAD_MAX_M / Math.max(speed, 1e-6),
        );
        // Cap lookahead distance so high speed does not move the focus too far ahead.
        const targetLookaheadX = body.vel.x * lookaheadScale;
        const targetLookaheadZ = body.vel.z * lookaheadScale;
        const lookaheadAlpha = 1 - Math.exp(-CAMERA_TUNING.LOOKAHEAD_RESPONSE * dt);
        const lookahead = state.cameraLookahead;
        lookahead.x += (targetLookaheadX - lookahead.x) * lookaheadAlpha;
        lookahead.z += (targetLookaheadZ - lookahead.z) * lookaheadAlpha;

        const horizontalAlpha = 1 - Math.exp(-CAMERA_TUNING.HORIZONTAL_RESPONSE * dt);
        // Exponential weights keep camera smoothing consistent across fixed timestep sizes.
        const focus = state.cameraFocus;
        const targetX = body.pos.x + lookahead.x;
        const targetZ = body.pos.z + lookahead.z;
        focus.x += (targetX - focus.x) * horizontalAlpha;
        focus.z += (targetZ - focus.z) * horizontalAlpha;

        const targetY = body.pos.y + CAMERA_TUNING.TARGET_HEIGHT_M;
        const verticalError = targetY - focus.y;
        const deadZoneEdge = CAMERA_TUNING.VERTICAL_DEAD_ZONE_M * 0.5;
        const outsideDeadZone = Math.abs(verticalError) - deadZoneEdge;
        if (outsideDeadZone > 0) {
            // The dead zone suppresses small vertical camera motion; faster response limits fall lag.
            const deadZonedTarget = targetY - Math.sign(verticalError) * deadZoneEdge;
            const response =
                body.vel.y < -CAMERA_TUNING.FALL_RESPONSE_THRESHOLD_MPS
                    ? CAMERA_TUNING.FALL_RESPONSE
                    : CAMERA_TUNING.VERTICAL_RESPONSE;
            const verticalAlpha = 1 - Math.exp(-response * dt);
            focus.y += (deadZonedTarget - focus.y) * verticalAlpha;
        }
    },
};

export const PresentFollowCamera = {
    name: "PogoCameraPosePresentation",
    group: "simulation" as const,
    update(world: World): void {
        if (isEditing(world.resource(editorState))) return;
        const state = world.resource(runtime);
        const alpha = world.time.fixedAlpha;
        const focus = {
            x:
                state.previousCameraFocus.x +
                (state.cameraFocus.x - state.previousCameraFocus.x) * alpha,
            y:
                state.previousCameraFocus.y +
                (state.cameraFocus.y - state.previousCameraFocus.y) * alpha,
            z:
                state.previousCameraFocus.z +
                (state.cameraFocus.z - state.previousCameraFocus.z) * alpha,
        };
        const impact =
            state.previousCameraImpact +
            (state.cameraImpact - state.previousCameraImpact) * alpha;
        const camera = cameraPosition(
            focus,
            state.cameraYaw,
            state.cameraPitch,
            state.cameraDistance,
        );
        const cameraUp = {
            x: -Math.sin(state.cameraYaw) * Math.sin(state.cameraPitch),
            y: Math.cos(state.cameraPitch),
            z: -Math.cos(state.cameraYaw) * Math.sin(state.cameraPitch),
        };
        camera.x -= cameraUp.x * impact;
        camera.y -= cameraUp.y * impact;
        camera.z -= cameraUp.z * impact;
        const pose = world.storage(Transform);
        pose.translation.set(state.camera, camera.x, camera.y, camera.z);
        pose.rotation.set(
            state.camera,
            ...lookAtRotation(camera.x, camera.y, camera.z, focus.x, focus.y, focus.z),
        );
    },
};

export const PresentCamera = {
    name: "PogoCameraPresentation",
    group: "draw" as const,
    first: true,
    // FOV must be updated before view preparation to affect the current frame.
    before: [PrepareViewsSystem],
    update(world: World): void {
        if (isEditing(world.resource(editorState))) return;
        const state = world.resource(runtime);
        const body = state.sim.body;
        const horizontalSpeed = Math.hypot(body.vel.x, body.vel.z);
        const fallSpeed = Math.max(0, -body.vel.y);
        const targetFov = targetCameraFov(
            horizontalSpeed,
            fallSpeed,
            state.launchFovPulse,
        );
        const fov = world.storage(Camera).fov;
        const currentFov = fov.get(state.camera);
        const alpha = 1 - Math.exp(-CAMERA_TUNING.FOV_RESPONSE * world.time.deltaTime);
        fov.set(state.camera, currentFov + (targetFov - currentFov) * alpha);
    },
};
