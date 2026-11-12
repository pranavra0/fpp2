import { type Resource } from "@dylanebert/shallot";
import { CAMERA_TUNING } from "../config/camera";
import type { LevelDefinition, LevelMaterial } from "../content/level";
import { createSim, type Controls, type Sim } from "../sim";
import { setVec3, type Vec3 } from "../vec";
import type { LevelEntity } from "./physics";

export type GameRuntime = {
    sim: Sim;
    level: LevelDefinition | undefined;
    levelEntities: LevelEntity[];
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
    levelMaterials: Record<LevelMaterial, number>;
    activeCheckpointMaterial: number;
};

export const runtime: Resource<GameRuntime> = {
    create: () => {
        const sim = createSim();
        return {
            sim,
            level: undefined,
            levelEntities: [],
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
            levelMaterials: { ground: 0, platform: 0, goal: 0, checkpoint: 0 },
            activeCheckpointMaterial: 0,
        };
    },
};

export function activeLevel(state: GameRuntime): LevelDefinition {
    if (state.level === undefined) throw new Error("The active level has not been loaded");
    return state.level;
}

export function resetPlayerToSpawn(state: GameRuntime): void {
    resetPlayerToPosition(state, activeLevel(state).spawnPosition);
}

export function resetPlayerToPosition(state: GameRuntime, position: readonly [number, number, number]): void {
    const spawn = position;
    state.sim = createSim({ x: spawn[0], y: spawn[1], z: spawn[2] });
    Object.assign(state.controls, {
        leanX: 0,
        leanZ: 0,
        compress: false,
        jumpPressed: false,
        extend: false,
        retract: false,
    });
    state.pendingJumpPress = false;

    const focus = state.cameraFocus;
    setVec3(focus, spawn[0], spawn[1] + CAMERA_TUNING.TARGET_HEIGHT_M, spawn[2]);
    setVec3(state.previousCameraFocus, focus.x, focus.y, focus.z);
    setVec3(state.cameraLookahead, 0, 0, 0);
    state.impact = 0;
    state.cameraImpact = 0;
    state.previousCameraImpact = 0;
    state.launchStretch = 0;
    state.launchFovPulse = 0;
    state.lastContactId = state.sim.pogo.contactId;
    state.lastLaunchId = state.sim.pogo.lastLaunchedContactId;
}
