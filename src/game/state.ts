import { type Resource } from "@dylanebert/shallot";
import { CAMERA_TUNING } from "../config/camera";
import { DEFAULT_LEVEL, type LevelDefinition } from "../content/default-level";
import { createSim, type Controls, type Sim } from "../sim";
import type { Vec3 } from "../vec";

export type GameRuntime = {
    sim: Sim;
    level: LevelDefinition;
    controls: Controls;
    pendingJumpPress: boolean;
    camera: number;
    body: number;
    pole: number;
    tip: number;
    validLandingMarker: number;
    uncertainLandingMarker: number;
    cameraYaw: number;
    cameraPitch: number;
    cameraDistance: number;
    cameraFocus: Vec3;
    previousCameraFocus: Vec3;
    cameraLookahead: Vec3;
    impact: number;
    cameraImpact: number;
    previousCameraImpact: number;
    launchStretch: number;
    launchFovPulse: number;
    lastContactId: number;
    lastLaunchId: number;
};

export const runtime: Resource<GameRuntime> = {
    create: () => {
        const sim = createSim();
        return {
            sim,
            level: DEFAULT_LEVEL,
            controls: {
                leanX: 0,
                leanZ: 0,
                compress: false,
                jumpPressed: false,
                extend: false,
                retract: false,
            },
            pendingJumpPress: false,
            camera: 0,
            body: 0,
            pole: 0,
            tip: 0,
            validLandingMarker: 0,
            uncertainLandingMarker: 0,
            cameraYaw: CAMERA_TUNING.YAW_RAD,
            cameraPitch: CAMERA_TUNING.PITCH_RAD,
            cameraDistance: CAMERA_TUNING.DISTANCE_M,
            cameraFocus: { x: 0, y: 3, z: 0 },
            previousCameraFocus: { x: 0, y: 3, z: 0 },
            cameraLookahead: { x: 0, y: 0, z: 0 },
            impact: 0,
            cameraImpact: 0,
            previousCameraImpact: 0,
            launchStretch: 0,
            launchFovPulse: 0,
            lastContactId: sim.pogo.contactId,
            lastLaunchId: sim.pogo.lastLaunchedContactId,
        };
    },
};
