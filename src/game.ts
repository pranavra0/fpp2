import {
    BrowserInputPlugin,
    Camera,
    Devices,
    DirectionalLight,
    GlobalAmbientLight,
    lookAtRotation,
    Materials,
    MeshInstance,
    MeshMaterial,
    MeshPlugin,
    type Plugin,
    type Resource,
    releasePointerLock,
    requirePointerLock,
    StandardMaterial,
    StandardRenderer,
    StandardRenderingPlugin,
    Transform,
    type World,
} from "@dylanebert/shallot";
import type { MaterialHandle } from "@dylanebert/shallot/standard/rendering";
import { PrepareViewsSystem } from "@dylanebert/shallot/rendering";
import { createSim, DEFAULT_TUNING, step, type Controls, type Platform, type Sim } from "./sim";
import { normalizeVec3, type Vec3 } from "./vec";

export const CAMERA_TUNING = {
    BASE_FOV_DEG: 52,
    MAX_FOV_DEG: 58,
    FOV_RESPONSE: 4.5,
    SPEED_FOV_START_MPS: 8,
    SPEED_FOV_FULL_MPS: 18,
    SPEED_FOV_MAX_DEG: 2.5,
    FALL_FOV_START_MPS: 8,
    FALL_FOV_FULL_MPS: 18,
    FALL_FOV_MAX_DEG: 1.8,
    LAUNCH_FOV_MAX_DEG: 1.2,
    LAUNCH_FOV_DECAY_RATE: 2.2,
    HORIZONTAL_RESPONSE: 14,
    VERTICAL_RESPONSE: 5,
    FALL_RESPONSE: 13,
    FALL_RESPONSE_THRESHOLD_MPS: 5,
    VERTICAL_DEAD_ZONE_M: 1.5,
    TARGET_HEIGHT_M: 1,
    LOOKAHEAD_SECONDS: 0.18,
    LOOKAHEAD_MAX_M: 3.4,
    LOOKAHEAD_RESPONSE: 10,
    DISTANCE_M: Math.hypot(9, 9, 20),
    YAW_RAD: Math.atan2(9, 20),
    PITCH_RAD: (33 * Math.PI) / 180,
    MIN_DISTANCE_M: 6,
    MAX_DISTANCE_M: 36,
    MIN_PITCH_RAD: (8 * Math.PI) / 180,
    MAX_PITCH_RAD: (78 * Math.PI) / 180,
    ORBIT_SENSITIVITY_RAD_PER_PX: 0.004,
    ZOOM_RATE_PER_PX: 0.0015,
    IMPACT_FULL_SPEED_MPS: 13,
    IMPACT_CAMERA_OFFSET_M: 0.075,
    IMPACT_DECAY_RATE: 24,
    BODY_IMPACT_DECAY_RATE: 16,
    LAUNCH_STRETCH_DECAY_RATE: 18,
    PREDICTION_HORIZON_S: 3.5,
    MARKER_BASE_SIZE_M: 0.85,
    MARKER_DESCENT_SIZE_M: 0.45,
    MARKER_DESCENT_SPEED_MPS: 8,
    HIDDEN_MARKER_Y_M: -1000,
} as const;

const GROUND_WIDTH_M = 28;
const GROUND_DEPTH_M = 24;

type GameRuntime = {
    sim: Sim;
    controls: Controls;
    // A key edge can arrive between fixed ticks, so retain it until one tick consumes it.
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

const runtime: Resource<GameRuntime> = {
    create: () => {
        const sim = createSim();
        return {
            sim,
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

function box(
    world: World,
    material: MaterialHandle,
    translation: readonly [number, number, number],
    scale: readonly [number, number, number],
): number {
    const eid = world.create();
    world.add(eid, Transform, { translation, scale });
    world.add(eid, MeshInstance);
    world.add(eid, MeshMaterial, material);
    return eid;
}

function cameraPosition(focus: Vec3, yaw: number, pitch: number, distance: number): Vec3 {
    const horizontal = Math.cos(pitch) * distance;
    return {
        x: focus.x + Math.sin(yaw) * horizontal,
        y: focus.y + Math.sin(pitch) * distance,
        z: focus.z + Math.cos(yaw) * horizontal,
    };
}

function initialize(world: World): void {
    requirePointerLock(world, true);
    world.onDispose(() => releasePointerLock(world));

    const ambient = world.resource(GlobalAmbientLight);
    ambient.color = 0xc9d8ee;
    ambient.brightness = 340;

    const sun = world.create();
    world.add(sun, Transform, { rotation: lookAtRotation(-8, 12, 10, 0, 2, 0) });
    world.add(sun, DirectionalLight, { color: 0xfff0dc, illuminance: 5000 });

    const state = world.resource(runtime);
    const camera = world.create();
    const initialCameraPosition = cameraPosition(
        state.cameraFocus,
        state.cameraYaw,
        state.cameraPitch,
        state.cameraDistance,
    );
    world.add(camera, Camera, {
        fov: CAMERA_TUNING.BASE_FOV_DEG,
        far: 100,
        clearColor: 0x101827,
    });
    world.add(camera, StandardRenderer);
    world.add(camera, Transform, {
        translation: [initialCameraPosition.x, initialCameraPosition.y, initialCameraPosition.z],
        rotation: lookAtRotation(
            initialCameraPosition.x,
            initialCameraPosition.y,
            initialCameraPosition.z,
            state.cameraFocus.x,
            state.cameraFocus.y,
            state.cameraFocus.z,
        ),
    });

    const materials = world.resource(Materials);
    const ground = materials.add(
        StandardMaterial({ baseColor: [0.12, 0.16, 0.2, 1], perceptualRoughness: 0.85 }),
    );
    const platform = materials.add(
        StandardMaterial({ baseColor: [0.28, 0.39, 0.5, 1], perceptualRoughness: 0.72 }),
    );
    const bodyMaterial = materials.add(
        StandardMaterial({ baseColor: [0.95, 0.74, 0.24, 1], perceptualRoughness: 0.48 }),
    );
    const poleMaterial = materials.add(
        StandardMaterial({ baseColor: [0.82, 0.25, 0.2, 1], perceptualRoughness: 0.4 }),
    );
    const tipMaterial = materials.add(
        StandardMaterial({ baseColor: [0.25, 0.68, 0.53, 1], perceptualRoughness: 0.55 }),
    );

    box(world, ground, [0, -0.5, 0], [GROUND_WIDTH_M, 1, GROUND_DEPTH_M]);
    for (const item of DEFAULT_TUNING.PLATFORMS) {
        box(
            world,
            platform,
            [item.centerX, item.topY - 0.18, item.centerZ],
            [item.width, 0.36, item.depth],
        );
    }

    const body = box(world, bodyMaterial, [0, state.sim.body.pos.y, 0], [0.65, 0.82, 0.65]);
    const pole = box(world, poleMaterial, [0, state.sim.body.pos.y - 0.5, 0], [0.14, 1, 0.14]);
    const tip = box(world, tipMaterial, [0, state.sim.body.pos.y - 1, 0], [0.34, 0.2, 0.34]);
    const initialPrediction = predictLanding(state.sim);
    const initialMarkerPosition = initialPrediction?.position ?? { x: 0, y: 0, z: 0 };
    const initialValidMarker = initialPrediction?.certain ?? false;
    const validMarkerMaterial = materials.add(
        StandardMaterial({
            baseColor: [0.1, 0.72, 0.42, 1],
            emissive: [0.03, 0.3, 0.12],
            perceptualRoughness: 0.55,
        }),
    );
    const uncertainMarkerMaterial = materials.add(
        StandardMaterial({
            baseColor: [0.92, 0.48, 0.12, 1],
            emissive: [0.38, 0.12, 0.015],
            perceptualRoughness: 0.55,
        }),
    );
    const validLandingMarker = box(
        world,
        validMarkerMaterial,
        initialValidMarker
            ? [initialMarkerPosition.x, initialMarkerPosition.y + 0.035, initialMarkerPosition.z]
            : [0, CAMERA_TUNING.HIDDEN_MARKER_Y_M, 0],
        [CAMERA_TUNING.MARKER_BASE_SIZE_M, 0.025, CAMERA_TUNING.MARKER_BASE_SIZE_M],
    );
    const uncertainLandingMarker = box(
        world,
        uncertainMarkerMaterial,
        initialPrediction !== undefined && !initialValidMarker
            ? [initialMarkerPosition.x, initialMarkerPosition.y + 0.035, initialMarkerPosition.z]
            : [0, CAMERA_TUNING.HIDDEN_MARKER_Y_M, 0],
        [CAMERA_TUNING.MARKER_BASE_SIZE_M, 0.025, CAMERA_TUNING.MARKER_BASE_SIZE_M],
    );
    Object.assign(state, {
        camera,
        body,
        pole,
        tip,
        validLandingMarker,
        uncertainLandingMarker,
    });
}

const ReadControls = {
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

function clamp01(value: number): number {
    return Math.max(0, Math.min(1, value));
}

function updateVisualFeedback(state: GameRuntime, dt: number, incomingImpactSpeed: number): void {
    const { sim } = state;
    // Contact IDs provide one-shot events without coupling presentation to simulation callbacks.
    if (sim.pogo.contactId !== state.lastContactId) {
        const impactStrength = clamp01(
            incomingImpactSpeed / CAMERA_TUNING.IMPACT_FULL_SPEED_MPS,
        );
        state.impact = impactStrength;
        // Keep the stronger offset when another contact arrives before the previous one decays.
        state.cameraImpact = Math.max(
            state.cameraImpact,
            impactStrength * CAMERA_TUNING.IMPACT_CAMERA_OFFSET_M,
        );
        state.lastContactId = sim.pogo.contactId;
    }
    if (sim.pogo.lastLaunchedContactId !== state.lastLaunchId) {
        const charge = sim.pogo.chargeT / DEFAULT_TUNING.CHARGE_MAX_S;
        state.launchStretch = Math.max(0.55, charge);
        state.launchFovPulse = Math.max(state.launchFovPulse, clamp01((charge - 0.4) / 0.6));
        state.lastLaunchId = sim.pogo.lastLaunchedContactId;
    }
    state.impact *= Math.exp(-CAMERA_TUNING.BODY_IMPACT_DECAY_RATE * dt);
    state.cameraImpact *= Math.exp(-CAMERA_TUNING.IMPACT_DECAY_RATE * dt);
    state.launchStretch *= Math.exp(-CAMERA_TUNING.LAUNCH_STRETCH_DECAY_RATE * dt);
    state.launchFovPulse *= Math.exp(-CAMERA_TUNING.LAUNCH_FOV_DECAY_RATE * dt);
}

type LandingPrediction = { position: Vec3; time: number; certain: boolean };

function positiveDescendingCrossingTime(
    tipY: number,
    verticalVelocity: number,
    surfaceY: number,
): number | undefined {
    // Use the later root because only a downward crossing can create contact.
    const discriminant =
        verticalVelocity * verticalVelocity +
        2 * DEFAULT_TUNING.GRAVITY_MPS2 * (tipY - surfaceY);
    if (discriminant < 0) return undefined;
    const time =
        (verticalVelocity + Math.sqrt(discriminant)) / DEFAULT_TUNING.GRAVITY_MPS2;
    return time > 0 ? time : undefined;
}

function platformContains(platform: Platform, x: number, z: number): boolean {
    return (
        Math.abs(x - platform.centerX) <=
            platform.width * 0.5 + DEFAULT_TUNING.LANDING_EDGE_TOLERANCE_M &&
        Math.abs(z - platform.centerZ) <=
            platform.depth * 0.5 + DEFAULT_TUNING.LANDING_EDGE_TOLERANCE_M
    );
}

function predictLanding(sim: Sim): LandingPrediction | undefined {
    if (sim.pogo.state === "Compression") {
        return { position: { ...sim.pogo.contactTip }, time: 0, certain: true };
    }

    const { body, pole } = sim;
    const tipX = body.pos.x - pole.d.x * pole.length;
    const tipY = body.pos.y - pole.d.y * pole.length;
    const tipZ = body.pos.z - pole.d.z * pole.length;
    let first: LandingPrediction | undefined;

    // Constant horizontal speed avoids simulating future control changes just to place the marker.
    const consider = (time: number | undefined, surfaceY: number, certain: boolean): void => {
        if (time === undefined || (first !== undefined && time >= first.time)) return;
        first = {
            position: {
                x: tipX + body.vel.x * time,
                y: surfaceY,
                z: tipZ + body.vel.z * time,
            },
            time,
            // The constant-velocity estimate becomes less reliable farther into the future.
            certain: certain && time <= CAMERA_TUNING.PREDICTION_HORIZON_S,
        };
    };

    const groundTime = positiveDescendingCrossingTime(tipY, body.vel.y, 0);
    if (groundTime !== undefined) {
        const x = tipX + body.vel.x * groundTime;
        const z = tipZ + body.vel.z * groundTime;
        const withinGround =
            Math.abs(x) <= GROUND_WIDTH_M * 0.5 && Math.abs(z) <= GROUND_DEPTH_M * 0.5;
        consider(groundTime, 0, withinGround);
    }

    for (const platform of DEFAULT_TUNING.PLATFORMS) {
        const time = positiveDescendingCrossingTime(tipY, body.vel.y, platform.topY);
        if (time === undefined) continue;
        const x = tipX + body.vel.x * time;
        const z = tipZ + body.vel.z * time;
        if (platformContains(platform, x, z)) consider(time, platform.topY, true);
    }

    return first;
}

function updateLandingMarker(world: World, state: GameRuntime): void {
    const prediction = predictLanding(state.sim);
    const pose = world.storage(Transform);
    if (prediction === undefined) {
        pose.translation.set(state.validLandingMarker, 0, CAMERA_TUNING.HIDDEN_MARKER_Y_M, 0);
        pose.translation.set(
            state.uncertainLandingMarker,
            0,
            CAMERA_TUNING.HIDDEN_MARKER_Y_M,
            0,
        );
        return;
    }

    const descent = clamp01(
        -state.sim.body.vel.y / CAMERA_TUNING.MARKER_DESCENT_SPEED_MPS,
    );
    const size =
        CAMERA_TUNING.MARKER_BASE_SIZE_M +
        CAMERA_TUNING.MARKER_DESCENT_SIZE_M * descent;
    const entity = prediction.certain
        ? state.validLandingMarker
        : state.uncertainLandingMarker;
    const hiddenEntity = prediction.certain
        ? state.uncertainLandingMarker
        : state.validLandingMarker;

    pose.translation.set(
        entity,
        prediction.position.x,
        prediction.position.y + 0.035,
        prediction.position.z,
    );
    pose.scale.set(entity, size, 0.025, size);
    pose.translation.set(hiddenEntity, 0, CAMERA_TUNING.HIDDEN_MARKER_Y_M, 0);
    pose.scale.set(hiddenEntity, size, 0.025, size);
}

function setRotationFromUp(world: World, eid: number, up: Vec3): void {
    // Without this rotation the pole mesh would stay vertical when the simulated pole leans.
    const qx = up.z;
    const qy = 0;
    const qz = -up.x;
    const qw = 1 + up.y;
    const inverseLength = 1 / Math.hypot(qx, qy, qz, qw);
    world.storage(Transform).rotation.set(
        eid,
        qx * inverseLength,
        qy,
        qz * inverseLength,
        qw * inverseLength,
    );
}

function writePose(world: World, state: GameRuntime): void {
    const { sim } = state;
    const { body, pole, pogo } = sim;
    const pose = world.storage(Transform);
    const charge = pogo.chargeT / DEFAULT_TUNING.CHARGE_MAX_S;
    const compression = pogo.compressionM / DEFAULT_TUNING.MAX_COMPRESSION_M;
    const squash = 0.14 * compression + 0.16 * state.impact - 0.1 * state.launchStretch;
    const bodyWidth = 1 + squash * 0.65 + state.launchStretch * 0.14;
    const bodyHeight = 1 - squash * 0.7 + state.launchStretch * 0.38;
    pose.translation.set(state.body, body.pos.x, body.pos.y, body.pos.z);
    pose.scale.set(state.body, 0.65 * bodyWidth, 0.82 * bodyHeight, 0.65 * bodyWidth);

    const bodyUp: Vec3 = {
        x: pole.d.x * 0.3,
        y: 1 - (1 - pole.d.y) * 0.3,
        z: pole.d.z * 0.3,
    };
    // Partial alignment keeps the body from inheriting the pole's full lean.
    normalizeVec3(bodyUp);
    setRotationFromUp(world, state.body, bodyUp);

    const visibleLength = pole.length - pogo.compressionM;
    pose.scale.set(state.pole, 0.14, visibleLength, 0.14);
    pose.translation.set(
        state.pole,
        body.pos.x - pole.d.x * visibleLength * 0.5,
        body.pos.y - pole.d.y * visibleLength * 0.5,
        body.pos.z - pole.d.z * visibleLength * 0.5,
    );
    setRotationFromUp(world, state.pole, pole.d);
    pose.translation.set(
        state.tip,
        body.pos.x - pole.d.x * visibleLength,
        body.pos.y - pole.d.y * visibleLength,
        body.pos.z - pole.d.z * visibleLength,
    );
    pose.scale.set(state.tip, 0.34 + 0.05 * charge, 0.2, 0.34 + 0.05 * charge);
}

const Simulate = {
    name: "PogoSimulation",
    group: "fixed" as const,
    update(world: World): void {
        const state = world.resource(runtime);
        state.previousCameraFocus.x = state.cameraFocus.x;
        state.previousCameraFocus.y = state.cameraFocus.y;
        state.previousCameraFocus.z = state.cameraFocus.z;
        state.previousCameraImpact = state.cameraImpact;
        const substepCount = world.time.fixedDeltaTime * DEFAULT_TUNING.SIM_HZ;
        // Partial substeps would change charge timing and collision results.
        if (!Number.isInteger(substepCount) || substepCount < 1) {
            throw new Error("the pogo simulation rate must divide the ECS fixed rate");
        }
        for (let index = 0; index < substepCount; index++) {
            state.controls.jumpPressed = state.pendingJumpPress;
            const incomingVerticalVelocity = state.sim.body.vel.y;
            const previousContactId = state.sim.pogo.contactId;
            step(state.sim, DEFAULT_TUNING, state.controls);
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

const FollowCamera = {
    name: "PogoCamera",
    group: "fixed" as const,
    after: [Simulate],
    update(world: World): void {
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
            const deadZonedTarget =
                targetY - Math.sign(verticalError) * deadZoneEdge;
            const response =
                body.vel.y < -CAMERA_TUNING.FALL_RESPONSE_THRESHOLD_MPS
                    ? CAMERA_TUNING.FALL_RESPONSE
                    : CAMERA_TUNING.VERTICAL_RESPONSE;
            const verticalAlpha = 1 - Math.exp(-response * dt);
            focus.y += (deadZonedTarget - focus.y) * verticalAlpha;
        }
    },
};

const PresentFollowCamera = {
    name: "PogoCameraPosePresentation",
    group: "simulation" as const,
    update(world: World): void {
        const state = world.resource(runtime);
        const alpha = world.time.fixedAlpha;
        const focus: Vec3 = {
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

const PresentCamera = {
    name: "PogoCameraPresentation",
    group: "draw" as const,
    first: true,
    // FOV must be updated before view preparation to affect the current frame.
    before: [PrepareViewsSystem],
    update(world: World): void {
        const state = world.resource(runtime);
        const body = state.sim.body;
        const horizontalSpeed = Math.hypot(body.vel.x, body.vel.z);
        const speedFactor = clamp01(
            (horizontalSpeed - CAMERA_TUNING.SPEED_FOV_START_MPS) /
                (CAMERA_TUNING.SPEED_FOV_FULL_MPS - CAMERA_TUNING.SPEED_FOV_START_MPS),
        );
        const fallSpeed = Math.max(0, -body.vel.y);
        const fallFactor = clamp01(
            (fallSpeed - CAMERA_TUNING.FALL_FOV_START_MPS) /
                (CAMERA_TUNING.FALL_FOV_FULL_MPS - CAMERA_TUNING.FALL_FOV_START_MPS),
        );
        const targetFov = Math.min(
            CAMERA_TUNING.MAX_FOV_DEG,
            CAMERA_TUNING.BASE_FOV_DEG +
                speedFactor * CAMERA_TUNING.SPEED_FOV_MAX_DEG +
                fallFactor * CAMERA_TUNING.FALL_FOV_MAX_DEG +
                state.launchFovPulse * CAMERA_TUNING.LAUNCH_FOV_MAX_DEG,
        );
        const fov = world.storage(Camera).fov;
        const currentFov = fov.get(state.camera);
        const alpha = 1 - Math.exp(-CAMERA_TUNING.FOV_RESPONSE * world.time.deltaTime);
        fov.set(state.camera, currentFov + (targetFov - currentFov) * alpha);
    },
};

export const Game: Plugin = {
    name: "Game",
    dependencies: [BrowserInputPlugin, MeshPlugin, StandardRenderingPlugin],
    initialize,
    systems: [ReadControls, Simulate, FollowCamera, PresentFollowCamera, PresentCamera],
};
