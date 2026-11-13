import { parseSurfaceSnapshot, resolveSurface, type SurfaceSnapshot } from "./surfaces";
import { normalizeVec3, setVec3, type Vec3 } from "./vec";
import { DEFAULT_TUNING, type Tuning } from "./config/gameplay";

export type Controls = {
    leanX: number;
    leanZ: number;
    compress: boolean;
    jumpPressed?: boolean;
    extend: boolean;
    retract: boolean;
};

export type SurfaceDiagnostics = {
    incoming: Vec3;
    retained: Vec3;
    outgoing: Vec3;
    dragLoss: number;
    powered: Vec3;
    reboundY: number;
    impulse: Vec3;
    horizontalSaturated: boolean;
    verticalSaturated: boolean;
    impactSaturated: boolean;
    charge: number;
    dwell: number;
    reason: string;
    source: "powered" | "impact";
};

export type Sim = {
    tick: number;
    body: { pos: Vec3; vel: Vec3 };
    pole: { d: Vec3; length: number; leanX: number; leanZ: number; leanVelX: number; leanVelZ: number };
    pogo: {
        state: "Airborne" | "Compression";
        contactId: number;
        lastLaunchedContactId: number;
        compressT: number;
        chargeT: number;
        jumpBufferT: number;
        compressionM: number;
        contactTip: Vec3;
        carryVelX: number;
        carryVelZ: number;
        response: SurfaceSnapshot;
        incomingDownwardSpeed: number;
        pendingLaunch: "release" | "full-charge" | "automatic" | undefined;
        diagnostics: SurfaceDiagnostics;
    };
};

export type LandingSweep = {
    previousTip: Vec3;
    currentTip: Vec3;
};

export type LandingContact = { surfaceY: number; response?: SurfaceSnapshot };

export type LandingQuery = (sweep: LandingSweep) => LandingContact | undefined;

export const NEUTRAL_CONTROLS: Controls = {
    leanX: 0,
    leanZ: 0,
    compress: false,
    jumpPressed: false,
    extend: false,
    retract: false,
};

export function createSim(spawn: Vec3 = { x: 0, y: 2, z: 0 }): Sim {
    return {
        tick: 0,
        body: {
            pos: { ...spawn },
            vel: { x: 0, y: 0, z: 0 },
        },
        pole: {
            d: { x: 0, y: 1, z: 0 },
            length: DEFAULT_TUNING.POLE_LENGTH_M,
            leanX: 0,
            leanZ: 0,
            leanVelX: 0,
            leanVelZ: 0,
        },
        pogo: {
            state: "Airborne",
            contactId: 0,
            // Keep the initial contact ID distinct from any launch.
            lastLaunchedContactId: -1,
            compressT: 0,
            chargeT: 0,
            jumpBufferT: 0,
            compressionM: 0,
            contactTip: { x: 0, y: 0, z: 0 },
            carryVelX: 0,
            carryVelZ: 0,
            response: resolveSurface(),
            incomingDownwardSpeed: 0,
            pendingLaunch: undefined,
            diagnostics: {
                incoming: { x: 0, y: 0, z: 0 }, retained: { x: 0, y: 0, z: 0 },
                outgoing: { x: 0, y: 0, z: 0 }, powered: { x: 0, y: 0, z: 0 },
                impulse: { x: 0, y: 0, z: 0 }, dragLoss: 0, reboundY: 0,
                horizontalSaturated: false, verticalSaturated: false, impactSaturated: false,
                charge: 0, dwell: 0, reason: "", source: "powered",
            },
        },
    };
}

function assert(condition: boolean, message: string): asserts condition {
    if (!condition) throw new Error(message);
}

function applyLeanTarget(current: number, velocity: number, target: number, response: number, dt: number) {
    // Exact spring integration keeps the response stable when the fixed timestep changes.
    const error = current - target;
    const velocityTerm = velocity + response * error;
    const decay = Math.exp(-response * dt);
    return {
        angle: target + (error + velocityTerm * dt) * decay,
        velocity: (velocity - response * velocityTerm * dt) * decay,
    };
}

function updatePole(sim: Sim, tuning: Tuning, controls: Controls, response: number, dt: number): void {
    const pole = sim.pole;
    if (controls.extend) pole.length += tuning.POLE_LENGTH_RATE_MPS * dt;
    if (controls.retract) pole.length -= tuning.POLE_LENGTH_RATE_MPS * dt;
    pole.length = Math.max(
        tuning.POLE_MIN_LENGTH_M,
        Math.min(tuning.POLE_MAX_LENGTH_M, pole.length),
    );

    const inputLength = Math.hypot(controls.leanX, controls.leanZ);
    // A diagonal lean must not exceed the maximum angle on either axis.
    const inputScale = inputLength > 1 ? 1 / inputLength : 1;
    const targetX = controls.leanX * inputScale * tuning.MAX_LEAN_RAD;
    const targetZ = controls.leanZ * inputScale * tuning.MAX_LEAN_RAD;
    const nextX = applyLeanTarget(pole.leanX, pole.leanVelX, targetX, response, dt);
    const nextZ = applyLeanTarget(pole.leanZ, pole.leanVelZ, targetZ, response, dt);
    pole.leanX = nextX.angle;
    pole.leanZ = nextZ.angle;
    pole.leanVelX = nextX.velocity;
    pole.leanVelZ = nextZ.velocity;

    const cosX = Math.cos(pole.leanX);
    const cosZ = Math.cos(pole.leanZ);
    setVec3(
        pole.d,
        Math.sin(pole.leanX) * cosZ,
        cosX * cosZ,
        Math.sin(pole.leanZ),
    );
    // Length-based positions and collision tests assume a unit direction.
    normalizeVec3(pole.d);
}

function limitHorizontalSpeed(velocity: Vec3, tuning: Tuning): void {
    const speed = Math.hypot(velocity.x, velocity.z);
    if (speed <= tuning.MAX_HORIZONTAL_SPEED_MPS) return;
    const scale = tuning.MAX_HORIZONTAL_SPEED_MPS / speed;
    velocity.x *= scale;
    velocity.z *= scale;
}

function land(sim: Sim, topY: number, tipX: number, tipZ: number, response: SurfaceSnapshot): void {
    const { body, pole, pogo } = sim;
    assert(Object.values(body.vel).every(Number.isFinite), "nonfinite incoming velocity");
    pogo.response = parseSurfaceSnapshot(response);
    pogo.incomingDownwardSpeed = Math.max(0, -body.vel.y);
    pogo.pendingLaunch = undefined;
    pogo.diagnostics.incoming = { ...body.vel };
    pogo.diagnostics.dragLoss = 0;
    pogo.contactId++;
    pogo.state = "Compression";
    pogo.compressT = 0;
    pogo.chargeT = 0;
    pogo.compressionM = 0;
    setVec3(pogo.contactTip, tipX, topY, tipZ);
    // Horizontal momentum survives contact so the launch carries the incoming motion.
    pogo.carryVelX = body.vel.x * response.momentumRetention;
    pogo.carryVelZ = body.vel.z * response.momentumRetention;
    pogo.diagnostics.retained = { x: pogo.carryVelX, y: 0, z: pogo.carryVelZ };
    setVec3(
        body.pos,
        tipX + pole.d.x * pole.length,
        topY + pole.d.y * pole.length,
        tipZ + pole.d.z * pole.length,
    );
    body.vel.y = 0;
}

function launch(sim: Sim, tuning: Tuning): void {
    const { body, pole, pogo } = sim;
    assert(pogo.contactId !== pogo.lastLaunchedContactId, "a pogo contact launched twice");
    const charge = pogo.chargeT / tuning.CHARGE_MAX_S;
    const speed = tuning.LAUNCH_SPEED_MPS + tuning.CHARGE_BONUS_MPS * charge;
    const baseVerticalSpeed = Math.max(
        tuning.MIN_LAUNCH_VERTICAL_MPS,
        pole.d.y * tuning.LAUNCH_SPEED_MPS,
    );
    // A leaned pole still needs enough upward speed to clear the contact surface.
    pogo.lastLaunchedContactId = pogo.contactId;
    pogo.state = "Airborne";
    pogo.compressionM = 0;
    setVec3(
        body.pos,
        pogo.contactTip.x + pole.d.x * pole.length,
        pogo.contactTip.y + pole.d.y * pole.length,
        pogo.contactTip.z + pole.d.z * pole.length,
    );
    const response = pogo.response;
    const powered = {
        x: pole.d.x * speed * response.bounceScale * response.traction,
        y: Math.max(baseVerticalSpeed + tuning.CHARGE_VERTICAL_BONUS_MPS * charge, pole.d.y * speed) * response.bounceScale,
        z: pole.d.z * speed * response.bounceScale * response.traction,
    };
    const reboundY = response.restitution * Math.min(pogo.incomingDownwardSpeed, response.impactSpeedLimit);
    const vertical = Math.max(powered.y, reboundY);
    const impulse = { x: response.directionalSpeed * response.directionX, y: 0, z: response.directionalSpeed * response.directionZ };
    setVec3(body.vel, pogo.carryVelX + powered.x + impulse.x,
        response.maximumVerticalSpeed === undefined ? vertical : Math.min(vertical, response.maximumVerticalSpeed),
        pogo.carryVelZ + powered.z + impulse.z);
    Object.assign(pogo.diagnostics, { powered, reboundY, impulse,
        horizontalSaturated: Math.hypot(body.vel.x, body.vel.z) > tuning.MAX_HORIZONTAL_SPEED_MPS,
        verticalSaturated: body.vel.y < vertical,
        impactSaturated: response.restitution > 0 && pogo.incomingDownwardSpeed > response.impactSpeedLimit,
        charge, dwell: pogo.compressT, reason: pogo.pendingLaunch ?? "", source: reboundY > powered.y ? "impact" : "powered" });
    pogo.pendingLaunch = undefined;
    limitHorizontalSpeed(body.vel, tuning);
    pogo.diagnostics.outgoing = { ...body.vel };
}

function clamp01(value: number): number {
    return Math.max(0, Math.min(1, value));
}

export function landingAlpha(
    sweep: LandingSweep,
    surfaceY: number,
    tuning: Tuning = DEFAULT_TUNING,
): number | undefined {
    const deltaY = sweep.currentTip.y - sweep.previousTip.y;
    if (deltaY >= 0) return undefined;
    if (
        sweep.previousTip.y < surfaceY - tuning.LANDING_VERTICAL_TOLERANCE_M ||
        sweep.currentTip.y > surfaceY + tuning.LANDING_VERTICAL_TOLERANCE_M
    )
        return undefined;
    return clamp01((sweep.previousTip.y - surfaceY) / -deltaY);
}

export function simulationSubstepCount(
    fixedDeltaTime: number,
    tuning: Tuning = DEFAULT_TUNING,
): number {
    const count = fixedDeltaTime * tuning.SIM_HZ;
    if (!Number.isInteger(count) || count < 1) {
        throw new Error("the pogo simulation rate must divide the ECS fixed rate");
    }
    return count;
}

function updateCompression(sim: Sim, tuning: Tuning, controls: Controls, dt: number): void {
    const { body, pogo } = sim;
    pogo.compressT += dt;
    // A buffered press begins charging on the first contact tick.
    if (controls.compress || pogo.jumpBufferT > 0) {
        pogo.chargeT = Math.min(tuning.CHARGE_MAX_S, pogo.chargeT + dt);
    }
    const charge = pogo.chargeT / tuning.CHARGE_MAX_S;
    pogo.compressionM =
        tuning.MIN_COMPRESSION_M +
        (tuning.MAX_COMPRESSION_M - tuning.MIN_COMPRESSION_M) * charge;
    const compressedLength = sim.pole.length - pogo.compressionM;
    setVec3(
        body.pos,
        pogo.contactTip.x + sim.pole.d.x * compressedLength,
        pogo.contactTip.y + sim.pole.d.y * compressedLength,
        pogo.contactTip.z + sim.pole.d.z * compressedLength,
    );

    if (pogo.pendingLaunch === undefined) {
        if (pogo.chargeT >= tuning.CHARGE_MAX_S) pogo.pendingLaunch = "full-charge";
        else if (!controls.compress && pogo.jumpBufferT <= 0) {
            if (pogo.chargeT > 0) pogo.pendingLaunch = "release";
            else if (pogo.compressT >= tuning.AUTO_BOUNCE_DELAY_S) pogo.pendingLaunch = "automatic";
        }
    }
    if (pogo.pendingLaunch !== undefined && pogo.compressT >= pogo.response.minimumDwell) launch(sim, tuning);
}

/* Fixed steps keep landings and charge timing independent of render cadence. */
export function step(
    sim: Sim,
    tuning: Tuning,
    controls: Controls,
    findLanding: LandingQuery,
): void {
    const dt = 1 / tuning.SIM_HZ;
    const { body, pole, pogo } = sim;
    sim.tick++;
    if (controls.jumpPressed) pogo.jumpBufferT = tuning.INPUT_BUFFER_S;
    else pogo.jumpBufferT = Math.max(0, pogo.jumpBufferT - dt);

    if (pogo.state === "Compression") {
        updatePole(sim, tuning, controls, tuning.LEAN_GROUND_RESPONSE, dt);
        const inputLength = Math.hypot(controls.leanX, controls.leanZ);
        const inputScale = inputLength > 1 ? 1 / inputLength : 1;
        pogo.carryVelX += controls.leanX * inputScale * tuning.GROUND_CONTROL_MPS2 * pogo.response.traction * dt;
        pogo.carryVelZ += controls.leanZ * inputScale * tuning.GROUND_CONTROL_MPS2 * pogo.response.traction * dt;
        if (pogo.response.contactDrag !== 0) {
            const before = Math.hypot(pogo.carryVelX, pogo.carryVelZ);
            const decay = Math.exp(-pogo.response.contactDrag * dt);
            pogo.carryVelX *= decay;
            pogo.carryVelZ *= decay;
            pogo.diagnostics.dragLoss += before - Math.hypot(pogo.carryVelX, pogo.carryVelZ);
        }
        setVec3(body.vel, pogo.carryVelX, 0, pogo.carryVelZ);
        limitHorizontalSpeed(body.vel, tuning);
        pogo.carryVelX = body.vel.x;
        pogo.carryVelZ = body.vel.z;
        if (pogo.response.traction < 1) {
            const slip = (1 - pogo.response.traction) * dt;
            pogo.contactTip.x += pogo.carryVelX * slip;
            pogo.contactTip.z += pogo.carryVelZ * slip;
            const tip = pogo.contactTip;
            const tolerance = tuning.LANDING_VERTICAL_TOLERANCE_M;
            const support = findLanding({
                previousTip: { x: tip.x, y: tip.y + tolerance, z: tip.z },
                currentTip: { x: tip.x, y: tip.y - tolerance, z: tip.z },
            });
            if (!support || Math.abs(support.surfaceY - tip.y) > tolerance) {
                const length = pole.length - pogo.compressionM;
                setVec3(body.pos, tip.x + pole.d.x * length, tip.y + pole.d.y * length, tip.z + pole.d.z * length);
                pogo.state = "Airborne";
                pogo.compressionM = 0;
                pogo.pendingLaunch = undefined;
                return;
            }
        }
        updateCompression(sim, tuning, controls, dt);
        return;
    }

    // Collision interpolation needs the tip pose from before control and movement.
    const previousTipX = body.pos.x - pole.d.x * pole.length;
    const previousTipY = body.pos.y - pole.d.y * pole.length;
    const previousTipZ = body.pos.z - pole.d.z * pole.length;
    const previousVelY = body.vel.y;
    const response = body.vel.y > 0 ? tuning.LEAN_ASCENT_RESPONSE : tuning.LEAN_DESCENT_RESPONSE;
    updatePole(sim, tuning, controls, response, dt);

    const inputLength = Math.hypot(controls.leanX, controls.leanZ);
    const inputScale = inputLength > 1 ? 1 / inputLength : 1;
    const control =
        body.vel.y > 0 ? tuning.AIR_ASCENT_CONTROL_MPS2 : tuning.AIR_DESCENT_CONTROL_MPS2;
    body.vel.x += controls.leanX * inputScale * control * dt;
    body.vel.z += controls.leanZ * inputScale * control * dt;
    limitHorizontalSpeed(body.vel, tuning);

    body.pos.x += body.vel.x * dt;
    body.pos.y += body.vel.y * dt - 0.5 * tuning.GRAVITY_MPS2 * dt * dt;
    body.pos.z += body.vel.z * dt;
    body.vel.y -= tuning.GRAVITY_MPS2 * dt;

    const currentTipX = body.pos.x - pole.d.x * pole.length;
    const currentTipY = body.pos.y - pole.d.y * pole.length;
    const currentTipZ = body.pos.z - pole.d.z * pole.length;
    const tipDeltaY = currentTipY - previousTipY;
    // Upward motion cannot create a landing contact.
    if (tipDeltaY >= 0) return;

    // Keep the no-hit sentinel outside [0, 1], the range of valid within-tick crossings.
    const sweep: LandingSweep = {
        previousTip: { x: previousTipX, y: previousTipY, z: previousTipZ },
        currentTip: { x: currentTipX, y: currentTipY, z: currentTipZ },
    };
    const contact = findLanding(sweep);
    if (contact === undefined) return;
    const impactAlpha = landingAlpha(sweep, contact.surfaceY, tuning);
    if (impactAlpha === undefined) return;

    // Launch from the velocity at contact time, not from the end of the fixed step.
    body.vel.y = previousVelY - tuning.GRAVITY_MPS2 * dt * impactAlpha;
    land(
        sim,
        contact.surfaceY,
        sweep.previousTip.x + (sweep.currentTip.x - sweep.previousTip.x) * impactAlpha,
        sweep.previousTip.z + (sweep.currentTip.z - sweep.previousTip.z) * impactAlpha,
        contact.response ?? resolveSurface(),
    );
}
