import { normalizeVec3, setVec3, type Vec3 } from "./vec";

export type Platform = {
    centerX: number;
    centerZ: number;
    topY: number;
    width: number;
    depth: number;
};

export const DEFAULT_TUNING = {
    SIM_HZ: 120,
    GRAVITY_MPS2: 9.81,
    LAUNCH_SPEED_MPS: 7.8,
    CHARGE_BONUS_MPS: 5.5,
    MIN_LAUNCH_VERTICAL_MPS: 7.4,
    CHARGE_VERTICAL_BONUS_MPS: 2.5,
    POLE_LENGTH_M: 1,
    POLE_MIN_LENGTH_M: 0.7,
    POLE_MAX_LENGTH_M: 3.5,
    POLE_LENGTH_RATE_MPS: 1.5,
    MAX_LEAN_RAD: 0.72,
    LEAN_GROUND_RESPONSE: 25,
    LEAN_ASCENT_RESPONSE: 16,
    LEAN_DESCENT_RESPONSE: 19,
    GROUND_CONTROL_MPS2: 18,
    AIR_ASCENT_CONTROL_MPS2: 4,
    AIR_DESCENT_CONTROL_MPS2: 6,
    MAX_HORIZONTAL_SPEED_MPS: 18,
    CHARGE_MAX_S: 0.3,
    AUTO_BOUNCE_DELAY_S: 0.045,
    INPUT_BUFFER_S: 0.12,
    MIN_COMPRESSION_M: 0.12,
    MAX_COMPRESSION_M: 0.4,
    LANDING_VERTICAL_TOLERANCE_M: 0.06,
    LANDING_EDGE_TOLERANCE_M: 0.12,
    PLATFORMS: [
        { centerX: 3, centerZ: -2, topY: 2.6, width: 4, depth: 5.5 },
        { centerX: -3, centerZ: 3, topY: 5.2, width: 4, depth: 5.5 },
        { centerX: 3, centerZ: -3, topY: 7.8, width: 4, depth: 5.5 },
    ] as Platform[],
};

export type Tuning = typeof DEFAULT_TUNING;

export type Controls = {
    leanX: number;
    leanZ: number;
    compress: boolean;
    jumpPressed?: boolean;
    extend: boolean;
    retract: boolean;
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
    };
};

export const NEUTRAL_CONTROLS: Controls = {
    leanX: 0,
    leanZ: 0,
    compress: false,
    jumpPressed: false,
    extend: false,
    retract: false,
};

export function createSim(bodyY = 2): Sim {
    return {
        tick: 0,
        body: {
            pos: { x: 0, y: bodyY, z: 0 },
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

function land(sim: Sim, topY: number, tipX: number, tipZ: number): void {
    const { body, pole, pogo } = sim;
    pogo.contactId++;
    pogo.state = "Compression";
    pogo.compressT = 0;
    pogo.chargeT = 0;
    pogo.compressionM = 0;
    // Keeping a fixed tip point prevents the pogo from sliding during compression.
    setVec3(pogo.contactTip, tipX, topY, tipZ);
    // Horizontal momentum survives contact so the launch carries the incoming motion.
    pogo.carryVelX = body.vel.x;
    pogo.carryVelZ = body.vel.z;
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
    setVec3(
        body.vel,
        pogo.carryVelX + pole.d.x * speed,
        Math.max(
            baseVerticalSpeed + tuning.CHARGE_VERTICAL_BONUS_MPS * charge,
            pole.d.y * speed,
        ),
        pogo.carryVelZ + pole.d.z * speed,
    );
    limitHorizontalSpeed(body.vel, tuning);
}

function platformContains(platform: Platform, x: number, z: number, edgeTolerance: number): boolean {
    return (
        Math.abs(x - platform.centerX) <= platform.width * 0.5 + edgeTolerance &&
        Math.abs(z - platform.centerZ) <= platform.depth * 0.5 + edgeTolerance
    );
}

function clamp01(value: number): number {
    return Math.max(0, Math.min(1, value));
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

    if (pogo.chargeT >= tuning.CHARGE_MAX_S) {
        launch(sim, tuning);
        return;
    }
    if (controls.compress || pogo.jumpBufferT > 0) return;
    // A short contact window permits a deliberate charge without leaving an idle pogo stuck.
    if (pogo.chargeT > 0 || pogo.compressT >= tuning.AUTO_BOUNCE_DELAY_S) launch(sim, tuning);
}

/* Fixed steps keep landings and charge timing independent of render cadence. */
export function step(
    sim: Sim,
    tuning: Tuning = DEFAULT_TUNING,
    controls: Controls = NEUTRAL_CONTROLS,
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
        pogo.carryVelX += controls.leanX * inputScale * tuning.GROUND_CONTROL_MPS2 * dt;
        pogo.carryVelZ += controls.leanZ * inputScale * tuning.GROUND_CONTROL_MPS2 * dt;
        setVec3(body.vel, pogo.carryVelX, 0, pogo.carryVelZ);
        limitHorizontalSpeed(body.vel, tuning);
        pogo.carryVelX = body.vel.x;
        pogo.carryVelZ = body.vel.z;
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
    let impactAlpha = 2;
    let impactY = 0;
    let impactX = 0;
    let impactZ = 0;
    const tolerance = tuning.LANDING_VERTICAL_TOLERANCE_M;
    // Interpolate within the tick so a fast tip cannot pass through a thin surface.
    if (previousTipY >= -tolerance && currentTipY <= tolerance) {
        impactAlpha = clamp01(previousTipY / -tipDeltaY);
        impactY = 0;
        impactX = previousTipX + (currentTipX - previousTipX) * impactAlpha;
        impactZ = previousTipZ + (currentTipZ - previousTipZ) * impactAlpha;
    }
    // Keep the earliest valid crossing when multiple surfaces overlap vertically.
    for (const platform of tuning.PLATFORMS) {
        if (previousTipY < platform.topY - tolerance || currentTipY > platform.topY + tolerance) {
            continue;
        }
        const alpha = clamp01((previousTipY - platform.topY) / -tipDeltaY);
        const x = previousTipX + (currentTipX - previousTipX) * alpha;
        const z = previousTipZ + (currentTipZ - previousTipZ) * alpha;
        if (
            alpha < impactAlpha &&
            platformContains(platform, x, z, tuning.LANDING_EDGE_TOLERANCE_M)
        ) {
            impactAlpha = alpha;
            impactY = platform.topY;
            impactX = x;
            impactZ = z;
        }
    }
    if (impactAlpha > 1) return;

    // Launch from the velocity at contact time, not from the end of the fixed step.
    body.vel.y = previousVelY - tuning.GRAVITY_MPS2 * dt * impactAlpha;
    land(sim, impactY, impactX, impactZ);
}
