import { expect, setDefaultTimeout, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { Time, createApp } from "@dylanebert/shallot";
import { TIMEOUT } from "@dylanebert/shallot/testing";
import { DEFAULT_TUNING } from "../src/config/gameplay";
import { parseLevelDefinition, type Vec3Tuple } from "../src/content/level";
import { advanceGameplay, createGameplayProgress } from "../src/game/gameplay";
import { resetGameplayProgress } from "../src/game/gameplay-state";
import { addLevelPhysics, findLandingSurface, PogoWorldCollisionPlugin } from "../src/game/physics";
import { resetPlayerToPosition, runtime } from "../src/game/state";
import { createSim, NEUTRAL_CONTROLS, step } from "../src/sim";
import { overlappingCapsuleTriggers, PLAYER_TRIGGER_CAPSULE, sweepCapsuleTriggers } from "../src/game/trigger-contact";

setDefaultTimeout(TIMEOUT.node);

async function readFirstLevel() {
    const text = await readFile(new URL("../public/levels/first-level.json", import.meta.url), "utf8");
    return parseLevelDefinition(JSON.parse(text));
}

function position(value: { x: number; y: number; z: number }): Vec3Tuple {
    return [value.x, value.y, value.z];
}

test("first level supports checkpoint, failure respawn, goal, and restart transitions", async () => {
    const level = await readFirstLevel();
    const checkpoint = level.objects.find((object) => object.role === "checkpoint");
    const goal = level.objects.find((object) => object.role === "goal");
    if (!checkpoint || checkpoint.collision.kind !== "trigger-box")
        throw new Error("first-level checkpoint is missing");
    if (!goal || goal.collision.kind !== "trigger-box")
        throw new Error("first-level goal is missing");

    let levelEntities: ReturnType<typeof addLevelPhysics> = [];
    const app = await createApp({
        defaults: false,
        plugins: [PogoWorldCollisionPlugin],
        setup(world) {
            levelEntities = addLevelPhysics(world, level);
        },
    });
    try {
        const { world } = app;
        world.step(Time.FIXED_DT);
        const checkpointEntity = levelEntities.find((entity) => entity.id === checkpoint.id);
        if (!checkpointEntity) throw new Error("checkpoint entity is missing");
        expect(checkpointEntity.collisionEid).toBeUndefined();

        const sim = createSim({
            x: checkpoint.transform.position[0],
            y: checkpoint.transform.position[1] + 3,
            z: checkpoint.transform.position[2],
        });
        sim.body.vel.y = -1;
        const progress = createGameplayProgress(level);
        progress.insideTriggerIds = new Set(
            overlappingCapsuleTriggers(level, position(sim.body.pos), PLAYER_TRIGGER_CAPSULE),
        );
        let checkpointEvent: string | null = null;
        for (let tick = 0; tick < DEFAULT_TUNING.SIM_HZ * 3 && !checkpointEvent; tick++) {
            const previous = position(sim.body.pos);
            step(sim, DEFAULT_TUNING, NEUTRAL_CONTROLS, (sweep) =>
                findLandingSurface(world, sweep),
            );
            const current = position(sim.body.pos);
            checkpointEvent = advanceGameplay(
                level,
                progress,
                current,
                [sweepCapsuleTriggers(level, previous, current, PLAYER_TRIGGER_CAPSULE)],
            );
        }
        expect(checkpointEvent).toBe("checkpoint");
        expect(progress.checkpointId).toBe(checkpoint.id);
        expect(progress.respawnPosition).toEqual(checkpoint.transform.position);

        const progressWhileInside = advanceGameplay(
            level,
            progress,
            position(sim.body.pos),
            [sweepCapsuleTriggers(level, position(sim.body.pos), position(sim.body.pos), PLAYER_TRIGGER_CAPSULE)],
        );
        expect(progressWhileInside).toBeNull();

        const falling = createSim({ x: 100, y: level.failureBoundaryY + 0.02, z: 100 });
        falling.body.vel.y = -3;
        let failureEvent: string | null = null;
        for (let tick = 0; tick < DEFAULT_TUNING.SIM_HZ && !failureEvent; tick++) {
            const previous = position(falling.body.pos);
            step(falling, DEFAULT_TUNING, NEUTRAL_CONTROLS, () => undefined);
            failureEvent = advanceGameplay(level, progress, position(falling.body.pos), [
                sweepCapsuleTriggers(level, previous, position(falling.body.pos), PLAYER_TRIGGER_CAPSULE),
            ]);
        }
        expect(failureEvent).toBe("failure");
        expect(progress.checkpointId).toBe(checkpoint.id);

        const player = runtime.create();
        player.level = level;
        resetPlayerToPosition(player, progress.respawnPosition);
        expect(player.sim.body.pos).toEqual({
            x: checkpoint.transform.position[0],
            y: checkpoint.transform.position[1],
            z: checkpoint.transform.position[2],
        });
        expect(player.sim.body.vel).toEqual({ x: 0, y: 0, z: 0 });
        expect(player.sim.pogo.state).toBe("Airborne");

        const goalPosition = goal.transform.position;
        const goalStart: Vec3Tuple = [goalPosition[0] - 4, goalPosition[1], goalPosition[2]];
        const goalEnd: Vec3Tuple = [goalPosition[0] + 4, goalPosition[1], goalPosition[2]];
        const goalEvent = advanceGameplay(level, progress, goalEnd, [
            sweepCapsuleTriggers(level, goalStart, goalEnd, PLAYER_TRIGGER_CAPSULE),
        ]);
        expect(goalEvent).toBe("complete");
        expect(progress.mode).toBe("complete");
        expect(
            advanceGameplay(level, progress, [0, 0, 0], []),
        ).toBeNull();

        resetGameplayProgress(progress, level);
        resetPlayerToPosition(player, level.spawnPosition);
        expect(progress.mode).toBe("active");
        expect(progress.checkpointId).toBeNull();
        expect(player.sim.body.pos).toEqual({ x: 0, y: 2, z: 0 });
    } finally {
        app.dispose();
    }
});
