import { Devices, type World } from "@dylanebert/shallot";
import { CAMERA_TUNING } from "../config/camera";
import { runtime } from "./state";

export const ReadControls = {
    name: "PogoControls",
    group: "setup" as const,
    update(world: World): void {
        const devices = world.resource(Devices);
        const state = world.resource(runtime);
        const held = devices.keys.held;
        const controls = state.controls;
        const active = devices.enabled;
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
        controls.leanX =
            rightX * screenRight * inputScale + forwardX * screenForward * inputScale;
        controls.leanZ =
            rightZ * screenRight * inputScale + forwardZ * screenForward * inputScale;
        controls.compress = active && held.has("Space");
        controls.extend = active && held.has("KeyE");
        controls.retract = active && held.has("KeyQ");
        controls.jumpPressed = false;
        if (active && devices.keys.pressed.has("Space")) state.pendingJumpPress = true;
        if (!active) state.pendingJumpPress = false;
    },
};
