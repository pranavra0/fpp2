import { Devices, requestPointerLock, type World } from "@dylanebert/shallot";
import { CAMERA_TUNING } from "../config/camera";
import { campaignControlEnabled } from "../content/campaign";
import { editorState, isEditing } from "./editor-state";
import { activeLevel, runtime } from "./state";
import { gameplayProgress } from "./gameplay-state";
import { restartGameplay } from "./gameplay-system";

export const ReadControls = {
    name: "PogoControls",
    group: "setup" as const,
    update(world: World): void {
        const devices = world.resource(Devices);
        const state = world.resource(runtime);
        const held = devices.keys.held;
        const editor = world.resource(editorState);
        if (isEditing(editor)) {
            Object.assign(state.controls, {
                leanX: 0,
                leanZ: 0,
                compress: false,
                jumpPressed: false,
                extend: false,
                retract: false,
            });
            state.pendingJumpPress = false;
            return;
        }
        const active = devices.enabled;
        const progress = world.resource(gameplayProgress);
        if (active && devices.keys.pressed.has("KeyR")) {
            const completed = progress.mode === "complete";
            const fromStart =
                completed ||
                held.has("ShiftLeft") ||
                held.has("ShiftRight");
            restartGameplay(world, fromStart);
            if (completed) requestPointerLock(world);
            return;
        }
        if (progress.mode !== "active") {
            Object.assign(state.controls, {
                leanX: 0,
                leanZ: 0,
                compress: false,
                jumpPressed: false,
                extend: false,
                retract: false,
            });
            state.pendingJumpPress = false;
            return;
        }
        const controls = state.controls;
        if (active && devices.pointer.lock.status === "locked") {
            state.cameraYaw -=
                devices.pointer.deltaX * CAMERA_TUNING.ORBIT_SENSITIVITY_RAD_PER_PX;
            state.cameraPitch = Math.max(
                CAMERA_TUNING.MIN_PITCH_RAD,
                Math.min(
                    CAMERA_TUNING.MAX_PITCH_RAD,
                    state.cameraPitch +
                        devices.pointer.deltaY * CAMERA_TUNING.ORBIT_SENSITIVITY_RAD_PER_PX,
                ),
            );
        }
        if (active) {
            state.cameraDistance = Math.max(
                CAMERA_TUNING.MIN_DISTANCE_M,
                Math.min(
                    CAMERA_TUNING.MAX_DISTANCE_M,
                    state.cameraDistance *
                        Math.exp(devices.pointer.scroll * CAMERA_TUNING.ZOOM_RATE_PER_PX),
                ),
            );
        }
        const screenRight = active
            ? Number(held.has("KeyD")) - Number(held.has("KeyA"))
            : 0;
        const screenForward = active
            ? Number(held.has("KeyW")) - Number(held.has("KeyS"))
            : 0;
        const inputLength = Math.hypot(screenRight, screenForward);
        const inputScale = inputLength > 1 ? 1 / inputLength : 1;
        const yaw = state.cameraYaw;
        const rightX = Math.cos(yaw);
        const rightZ = -Math.sin(yaw);
        const forwardX = -Math.sin(yaw);
        const forwardZ = -Math.cos(yaw);
        // Rotate screen directions into world space so controls follow the camera yaw.
        const levelId = activeLevel(state).id;
        const steeringEnabled = campaignControlEnabled(levelId, "steering");
        const chargeEnabled = campaignControlEnabled(levelId, "charge");
        const poleLengthEnabled = campaignControlEnabled(levelId, "pole-length");
        controls.leanX = steeringEnabled
            ? rightX * screenRight * inputScale + forwardX * screenForward * inputScale
            : 0;
        controls.leanZ = steeringEnabled
            ? rightZ * screenRight * inputScale + forwardZ * screenForward * inputScale
            : 0;
        controls.compress = chargeEnabled && active && held.has("Space");
        controls.extend = poleLengthEnabled && active && held.has("KeyE");
        controls.retract = poleLengthEnabled && active && held.has("KeyQ");
        controls.jumpPressed = false;
        if (chargeEnabled && active && devices.keys.pressed.has("Space"))
            state.pendingJumpPress = true;
        if (!active) state.pendingJumpPress = false;
    },
};
