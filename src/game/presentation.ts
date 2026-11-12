import { Transform, type World } from "@dylanebert/shallot";
import { CAMERA_TUNING } from "../config/camera";
import { DEFAULT_TUNING } from "../config/gameplay";
import { DEFAULT_LEVEL, type BoxSurface } from "../content/default-level";
import type { Sim } from "../sim";
import { normalizeVec3, type Vec3 } from "../vec";
import { clamp01 } from "./math";
import { runtime, type GameRuntime } from "./state";

export type LandingPrediction = { position: Vec3; time: number; certain: boolean };

export function updateVisualFeedback(
    state: GameRuntime,
    dt: number,
    incomingImpactSpeed: number,
): void {
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

function surfaceContains(surface: BoxSurface, x: number, z: number): boolean {
    return (
        Math.abs(x - surface.centerX) <=
            surface.width * 0.5 + DEFAULT_TUNING.LANDING_EDGE_TOLERANCE_M &&
        Math.abs(z - surface.centerZ) <=
            surface.depth * 0.5 + DEFAULT_TUNING.LANDING_EDGE_TOLERANCE_M
    );
}

export function predictLanding(
    sim: Sim,
    level = DEFAULT_LEVEL,
): LandingPrediction | undefined {
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

    const ground = level.ground;
    const groundTime = positiveDescendingCrossingTime(tipY, body.vel.y, ground.topY);
    if (groundTime !== undefined) {
        const x = tipX + body.vel.x * groundTime;
        const z = tipZ + body.vel.z * groundTime;
        const withinGround =
            Math.abs(x - ground.centerX) <= ground.width * 0.5 &&
            Math.abs(z - ground.centerZ) <= ground.depth * 0.5;
        consider(groundTime, ground.topY, withinGround);
    }

    for (const platform of level.platforms) {
        const time = positiveDescendingCrossingTime(tipY, body.vel.y, platform.topY);
        if (time === undefined) continue;
        const x = tipX + body.vel.x * time;
        const z = tipZ + body.vel.z * time;
        if (surfaceContains(platform, x, z)) consider(time, platform.topY, true);
    }

    return first;
}

export function updateLandingMarker(world: World, state: GameRuntime): void {
    const prediction = predictLanding(state.sim, state.level);
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
        CAMERA_TUNING.MARKER_BASE_SIZE_M + CAMERA_TUNING.MARKER_DESCENT_SIZE_M * descent;
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

export function writePose(world: World, state: GameRuntime): void {
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

