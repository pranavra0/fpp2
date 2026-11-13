import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { loadLevel, levelSurfaces, parseLevelDefinition } from "../src/content/level";
import { predictLanding } from "../src/game/presentation";
import { resetPlayerToSpawn, runtime } from "../src/game/state";
import { createSim } from "../src/sim";

async function readLevelFile(name: string) {
    const text = await readFile(new URL(`../public/levels/${name}.json`, import.meta.url), "utf8");
    return parseLevelDefinition(JSON.parse(text));
}

test("external level files validate and keep object collision separate from visual scale", async () => {
    const prototype = await readLevelFile("prototype");
    const alternate = await readLevelFile("alternate");

    expect(prototype.id).toBe("prototype");
    expect(prototype.objects.filter((object) => object.role === "platform")).toHaveLength(3);
    expect(prototype.spawnPosition).toEqual([0, 2, 0]);
    expect(alternate.id).toBe("alternate");
    expect(alternate.spawnPosition).toEqual([-5, 2, 4]);

    const collisionSurface = levelSurfaces(alternate).find(
        (surface) => surface.id === "platform-north",
    );
    expect(collisionSurface?.width).toBeCloseTo(3.6);
    expect(collisionSurface?.depth).toBeCloseTo(4.8);
    expect(collisionSurface?.topY).toBeCloseTo(4.664);
});

test("level loader reports missing files and validates fetched contents", async () => {
    let requestedPath = "";
    const prototype = await readLevelFile("prototype");
    const loaded = await loadLevel("prototype", async (input) => {
        requestedPath = String(input);
        return new Response(JSON.stringify(prototype));
    });
    expect(requestedPath).toBe("/levels/prototype.json");
    expect(loaded.id).toBe("prototype");

    const alternate = await readLevelFile("alternate");
    const selectedAlternate = await loadLevel(" AlternatE ", async (input) => {
        requestedPath = String(input);
        return new Response(JSON.stringify(alternate));
    });
    expect(requestedPath).toBe("/levels/alternate.json");
    expect(selectedAlternate.id).toBe("alternate");

    await expect(
        loadLevel("missing", async () => new Response("", { status: 404 })),
    ).rejects.toThrow('Failed to load level "missing" from /levels/missing.json: HTTP 404');
    await expect(loadLevel("../prototype", fetch)).rejects.toThrow(
        'Invalid level identifier "../prototype"',
    );
});

test("level validation rejects duplicate identifiers and invalid dimensions", async () => {
    const prototype = await readLevelFile("prototype");
    const duplicate = structuredClone(prototype);
    duplicate.objects = [...duplicate.objects, { ...duplicate.objects[1]! }];
    expect(() => parseLevelDefinition(duplicate)).toThrow('duplicate object id "platform-1"');

    const invalidDimensions = structuredClone(prototype);
    invalidDimensions.objects[1]!.transform.scale = [4, 0, 5.5];
    expect(() => parseLevelDefinition(invalidDimensions)).toThrow(
        "level.objects[1].transform.scale[1]: must be greater than zero",
    );

    const nonFiniteSpawn = structuredClone(prototype);
    nonFiniteSpawn.spawnPosition = [0, Number.NaN, 0];
    expect(() => parseLevelDefinition(nonFiniteSpawn)).toThrow(
        "level.spawnPosition[1]: expected a finite number",
    );
});

test("level validation accepts reusable platform asset IDs and rejects unsafe IDs", async () => {
    const prototype = await readLevelFile("prototype");
    const platformIndex = prototype.objects.findIndex((object) => object.role === "platform");
    const modelLevel = structuredClone(prototype);
    modelLevel.objects[platformIndex] = {
        ...modelLevel.objects[platformIndex]!,
        visual: { kind: "gltf", asset: "sample-platform" },
    } as (typeof modelLevel.objects)[number];
    expect(parseLevelDefinition(modelLevel).objects[platformIndex]?.visual).toEqual({
        kind: "gltf",
        asset: "sample-platform",
    });

    const importedModelLevel = structuredClone(modelLevel);
    (importedModelLevel.objects[platformIndex] as { visual: { kind: string; asset: string } }).visual.asset =
        "model-01234567-abcd-4abc-8def-0123456789ab";
    expect(parseLevelDefinition(importedModelLevel).objects[platformIndex]?.visual).toEqual({
        kind: "gltf",
        asset: "model-01234567-abcd-4abc-8def-0123456789ab",
    });

    const projectModelLevel = structuredClone(modelLevel);
    (projectModelLevel.objects[platformIndex] as { visual: { kind: string; asset: string } }).visual.asset =
        "Duck";
    expect(parseLevelDefinition(projectModelLevel).objects[platformIndex]?.visual).toEqual({
        kind: "gltf",
        asset: "Duck",
    });

    const unsafeAsset = structuredClone(modelLevel);
    (unsafeAsset.objects[platformIndex] as { visual: { kind: string; asset: string } }).visual.asset =
        "../outside";
    expect(() => parseLevelDefinition(unsafeAsset)).toThrow(
        "level.objects[1].visual.asset: must be a model filename without its .glb extension",
    );

    const modelGround = structuredClone(modelLevel);
    const groundIndex = modelGround.objects.findIndex((object) => object.role === "ground");
    (modelGround.objects[groundIndex] as { visual: { kind: string; asset: string } }).visual = {
        kind: "gltf",
        asset: "sample-platform",
    };
    expect(() => parseLevelDefinition(modelGround)).toThrow(
        'level.objects[0].visual.kind: glTF visuals are supported only for "platform" objects',
    );
});

test("landing prediction uses finite ground and active level collision surfaces", async () => {
    const level = await readLevelFile("prototype");
    const insideGround = createSim({ x: 0, y: 1.5, z: 0 });
    insideGround.body.vel.y = -1;
    expect(predictLanding(insideGround, level)?.certain).toBe(true);
    expect(predictLanding(insideGround, level)?.position.y).toBe(0);

    const outsideGround = createSim({ x: 14.1, y: 1.5, z: 0 });
    outsideGround.body.vel.y = -1;
    expect(predictLanding(outsideGround, level)?.certain).toBe(false);
});

test("reset restores level spawn and clears movement and presentation state", async () => {
    const level = await readLevelFile("alternate");
    const state = runtime.create();
    state.level = level;
    state.sim.body.vel = { x: 4, y: -3, z: 2 };
    state.sim.pogo.state = "Compression";
    state.sim.pogo.contactId = 7;
    state.pendingJumpPress = true;
    state.controls.leanX = 1;
    state.controls.compress = true;
    state.cameraLookahead.x = 2;
    state.impact = 1;
    state.cameraImpact = 1;
    state.launchStretch = 1;
    state.launchFovPulse = 1;

    resetPlayerToSpawn(state);

    expect(state.sim.body.pos).toEqual({ x: -5, y: 2, z: 4 });
    expect(state.sim.body.vel).toEqual({ x: 0, y: 0, z: 0 });
    expect(state.sim.pogo.state).toBe("Airborne");
    expect(state.sim.pogo.contactId).toBe(0);
    expect(state.pendingJumpPress).toBe(false);
    expect(state.controls.leanX).toBe(0);
    expect(state.controls.compress).toBe(false);
    expect(state.cameraFocus).toEqual({ x: -5, y: 3, z: 4 });
    expect(state.cameraLookahead).toEqual({ x: 0, y: 0, z: 0 });
    expect(state.impact).toBe(0);
    expect(state.cameraImpact).toBe(0);
    expect(state.launchStretch).toBe(0);
    expect(state.launchFovPulse).toBe(0);
});

test("platform collision modes round trip and reject invalid modes and triggers", async () => {
    const level = await readLevelFile("prototype");
    const platform = level.objects.find(object => object.role === "platform")!;
    const withMode = (mode: unknown, object = platform) => ({ ...level, objects: level.objects.map(entry => entry.id === object.id
        ? { ...object, collision: { ...object.collision, mode } } : entry) });
    for (const mode of ["solid", "one-way"]) {
        const parsed = parseLevelDefinition(JSON.parse(JSON.stringify(withMode(mode))));
        expect(parsed.objects.find(entry => entry.id === platform.id)?.collision).toMatchObject({ mode });
    }
    expect(() => parseLevelDefinition(withMode("invalid"))).toThrow("collision.mode");
    expect(() => parseLevelDefinition(withMode("one-way", level.objects.find(entry => entry.role === "ground")!))).toThrow("collision.mode");
});
