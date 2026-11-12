import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { parseLevelDefinition, type LevelDefinition, type LevelTriggerObjectDefinition, type Vec3Tuple } from "../src/content/level";
import { advanceGameplay, createGameplayProgress } from "../src/game/gameplay";
import {
    capsuleOverlapsTrigger,
    capsuleTriggerEntry,
    overlappingCapsuleTriggers,
    PLAYER_TRIGGER_CAPSULE,
    sweepCapsuleTriggers,
} from "../src/game/trigger-contact";

async function firstLevel(): Promise<LevelDefinition> {
    const text = await readFile(new URL("../public/levels/first-level.json", import.meta.url), "utf8");
    return parseLevelDefinition(JSON.parse(text));
}

function testTrigger(): LevelTriggerObjectDefinition {
    return {
        id: "checkpoint-test",
        role: "checkpoint",
        transform: {
            position: [0, 0, 0],
            rotation: [0, 0, 0, 1],
            scale: [2, 2, 2],
        },
        visual: { kind: "box", material: "checkpoint" },
        collision: { kind: "trigger-box", dimensions: [1, 1, 1] },
    };
}

test("capsule overlap includes tangent face, edge, and corner contact", () => {
    const trigger = testTrigger();
    const halfMeterRadius = { diameter: 1, height: 1 };
    expect(capsuleOverlapsTrigger(trigger, [1.5, 0, 0], halfMeterRadius)).toBe(true);
    expect(capsuleOverlapsTrigger(trigger, [1.5001, 0, 0], halfMeterRadius)).toBe(false);
    expect(capsuleOverlapsTrigger(trigger, [1.3, 0, 1.4], halfMeterRadius)).toBe(true);
    expect(capsuleOverlapsTrigger(trigger, [1.3, 0, 1.4001], halfMeterRadius)).toBe(false);

    const cornerRadius = Math.SQRT2;
    const cornerCapsule = { diameter: 2 * cornerRadius, height: 2 * cornerRadius };
    expect(capsuleOverlapsTrigger(trigger, [2, 0, 2], cornerCapsule)).toBe(true);
    expect(capsuleTriggerEntry(trigger, [3, 0, 1], [1, 0, 3], cornerCapsule)).toBeCloseTo(0.5, 6);
});

test("capsule sweep detects fast crossings and rotated trigger boxes", async () => {
    const trigger = testTrigger();
    const base = await firstLevel();
    const ground = base.objects.find((object) => object.role === "ground");
    if (!ground) throw new Error("first-level ground is missing");
    const parsed = parseLevelDefinition({
        ...base,
        id: "contact-test",
        objects: [
            ground,
            { ...trigger, id: "checkpoint-1" },
            {
                ...trigger,
                id: "checkpoint-2",
                transform: {
                    ...trigger.transform,
                    position: [10, 0, 0],
                    rotation: [0, Math.SQRT1_2, 0, Math.SQRT1_2],
                },
            },
        ],
    });
    const fast = sweepCapsuleTriggers(parsed, [-8, 0, 0], [8, 0, 0], PLAYER_TRIGGER_CAPSULE);
    expect(fast.contacts.some((contact) => contact.id === "checkpoint-1")).toBe(true);
    expect(fast.insideTriggerIds).not.toContain("checkpoint-1");

    const rootHalf = 4 * Math.SQRT1_2;
    const rotated = sweepCapsuleTriggers(
        parsed,
        [10 - rootHalf, 0, rootHalf],
        [10 + rootHalf, 0, -rootHalf],
        PLAYER_TRIGGER_CAPSULE,
    );
    expect(rotated.contacts.some((contact) => contact.id === "checkpoint-2")).toBe(true);
});

test("checkpoint overlap transitions activate once per entry and ignore spawn overlap", async () => {
    const level = await firstLevel();
    const checkpoint = level.objects.find(
        (object): object is LevelTriggerObjectDefinition => object.role === "checkpoint",
    );
    const goal = level.objects.find(
        (object): object is LevelTriggerObjectDefinition => object.role === "goal",
    );
    if (!checkpoint || !goal) throw new Error("first-level triggers are missing");

    const progress = createGameplayProgress(level);
    const checkpointCenter = checkpoint.transform.position;
    progress.insideTriggerIds = new Set(
        overlappingCapsuleTriggers(level, checkpointCenter, PLAYER_TRIGGER_CAPSULE),
    );
    expect(progress.insideTriggerIds.has(checkpoint.id)).toBe(true);
    expect(
        advanceGameplay(level, progress, checkpointCenter, [
            { contacts: [{ id: checkpoint.id, fraction: 0 }], insideTriggerIds: [checkpoint.id] },
        ]),
    ).toBeNull();
    expect(progress.checkpointId).toBeNull();

    progress.insideTriggerIds.clear();
    const firstEntry = advanceGameplay(level, progress, checkpointCenter, [
        { contacts: [{ id: checkpoint.id, fraction: 0.25 }], insideTriggerIds: [checkpoint.id] },
    ]);
    expect(firstEntry).toBe("checkpoint");
    expect(progress.checkpointId).toBe(checkpoint.id);
    expect(
        advanceGameplay(level, progress, checkpointCenter, [
            { contacts: [{ id: checkpoint.id, fraction: 0 }], insideTriggerIds: [checkpoint.id] },
        ]),
    ).toBeNull();
    advanceGameplay(level, progress, [0, 0, 0], [{ contacts: [], insideTriggerIds: [] }]);
    expect(
        advanceGameplay(level, progress, checkpointCenter, [
            { contacts: [{ id: checkpoint.id, fraction: 0.5 }], insideTriggerIds: [checkpoint.id] },
        ]),
    ).toBe("checkpoint");

    const goalCenter = goal.transform.position;
    progress.insideTriggerIds = new Set([goal.id]);
    expect(
        advanceGameplay(level, progress, goalCenter, [
            { contacts: [{ id: goal.id, fraction: 0 }], insideTriggerIds: [goal.id] },
        ]),
    ).toBeNull();
    expect(progress.mode).toBe("active");

    progress.insideTriggerIds.clear();
    const goalEntry = advanceGameplay(level, progress, goalCenter, [
        { contacts: [{ id: goal.id, fraction: 0.5 }], insideTriggerIds: [goal.id] },
    ]);
    expect(goalEntry).toBe("complete");
    expect(progress.mode).toBe("complete");
});
