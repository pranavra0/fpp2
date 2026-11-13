import { expect, test } from "bun:test";
import { createApp, Time } from "@dylanebert/shallot";
import { parseLevelDefinition, type LevelSurfaceObjectDefinition } from "../src/content/level";
import { addLevelPhysics, destroyLevelEntities, findLandingSurface, PogoWorldCollisionPlugin, surfaceDiagnostics, updateLevelEntity } from "../src/game/physics";
import { createSim, NEUTRAL_CONTROLS, step } from "../src/sim";
import { DEFAULT_TUNING } from "../src/config/gameplay";
import { parseAuthoredSurface, resolveSurface } from "../src/surfaces";
import prototype from "../public/levels/prototype.json";

const base = parseLevelDefinition(prototype).objects[0] as LevelSurfaceObjectDefinition;
const sweep = { previousTip: { x: 0, y: 1, z: 0 }, currentTip: { x: 0, y: -1, z: 0 } };
const pad = (id: string, profile: "elastic" | "grip"): LevelSurfaceObjectDefinition => ({ ...base, id, surface: { profile } });

test("equal crossing contacts choose stable authored ID across allocation order and diagnose ambiguity", async () => {
    for (const objects of [[pad("a", "elastic"), pad("b", "grip")], [pad("b", "grip"), pad("a", "elastic")]]) {
        const app = await createApp({ defaults: false, plugins: [PogoWorldCollisionPlugin], setup(world) {
            addLevelPhysics(world, { ...parseLevelDefinition(prototype), objects });
        } });
        try {
            app.world.step(Time.FIXED_DT);
            expect(findLandingSurface(app.world, sweep)?.response?.bounceScale).toBe(1.15);
            expect(app.world.resource(surfaceDiagnostics)).toMatchObject({ acceptedObjectId: "a", acceptedProfile: "elastic", ambiguousObjectIds: ["a", "b"] });
        } finally { app.dispose(); }
    }
});

test("profile-only edits update collision, Y rotation resolves local direction independently of scale and visual", async () => {
    const app = await createApp({ defaults: false, plugins: [PogoWorldCollisionPlugin] });
    try {
        const world = app.world;
        const entities = addLevelPhysics(world, { ...parseLevelDefinition(prototype), objects: [pad("pad", "elastic")] });
        const entity = entities[0]!;
        world.step(Time.FIXED_DT);
        const original = findLandingSurface(world, sweep)!;
        const changed = { ...entity.object, surface: { profile: "grip" as const } } as LevelSurfaceObjectDefinition;
        updateLevelEntity(world, entity, changed);
        expect(findLandingSurface(world, sweep)?.response?.momentumRetention).toBe(0.35);
        expect(original.response?.bounceScale).toBe(1.15);
        const directional: LevelSurfaceObjectDefinition = { ...changed, surface: { profile: "directional", directionXZ: [1, 0] }, transform: { ...changed.transform, rotation: [0, Math.SQRT1_2, 0, Math.SQRT1_2], scale: [5, 1, 3] } };
        updateLevelEntity(world, entity, directional);
        world.step(Time.FIXED_DT);
        const box = findLandingSurface(world, sweep)!;
        expect(box.response?.directionX).toBeCloseTo(0);
        expect(box.response?.directionZ).toBeCloseTo(-1);
        destroyLevelEntities(world, entities);
        const model: LevelSurfaceObjectDefinition = { ...directional, role: "platform", visual: { kind: "gltf", asset: "sample-platform" } };
        entities.push(...addLevelPhysics(world, { ...parseLevelDefinition(prototype), objects: [model] }));
        world.step(Time.FIXED_DT);
        expect(findLandingSurface(world, sweep)).toEqual(box);
        destroyLevelEntities(world, entities);
        world.step(Time.FIXED_DT);
        expect(findLandingSurface(world, sweep)).toBeUndefined();
        expect(world.resource(surfaceDiagnostics).ids.size).toBe(0);
    } finally { app.dispose(); }
});

test("coefficient-only edits reach accepted contacts without changing an active compression snapshot", async () => {
    const app = await createApp({ defaults: false, plugins: [PogoWorldCollisionPlugin] });
    try {
        const world = app.world;
        const entities = addLevelPhysics(world, { ...parseLevelDefinition(prototype), objects: [pad("pad", "elastic")] });
        const entity = entities[0]!;
        const authored = parseAuthoredSurface({ profile: "elastic", overrides: { bounceScale: 3, restitution: 0, momentumRetention: 0.2, minimumDwell: 0.1, maximumVerticalSpeed: null } });
        updateLevelEntity(world, entity, { ...base, id: entity.id, surface: authored });
        world.step(Time.FIXED_DT);
        expect(findLandingSurface(world, sweep)?.response).toEqual(resolveSurface(authored));
        const sim = createSim({ x: 0, y: 1.001, z: 0 });
        sim.body.vel = { x: 10, y: -1, z: 0 };
        step(sim, DEFAULT_TUNING, NEUTRAL_CONTROLS, path => findLandingSurface(world, path));
        expect(sim.pogo.state).toBe("Compression");
        expect(sim.pogo.carryVelX).toBe(2);
        updateLevelEntity(world, entity, { ...base, id: entity.id, surface: { profile: "elastic", overrides: { bounceScale: 0.5 } } });
        expect(findLandingSurface(world, sweep)?.response?.bounceScale).toBe(0.5);
        for (let i = 0; i < 20 && sim.pogo.state === "Compression"; i++)
            step(sim, DEFAULT_TUNING, NEUTRAL_CONTROLS, path => findLandingSurface(world, path));
        expect(sim.pogo.state).toBe("Airborne");
        expect(sim.body.vel.y).toBeCloseTo(DEFAULT_TUNING.LAUNCH_SPEED_MPS * 3);
        expect(sim.pogo.diagnostics.dwell).toBeGreaterThanOrEqual(0.1);
        expect(sim.body.vel.x).toBe(2);
        updateLevelEntity(world, entity, { ...base, id: entity.id, surface: { profile: "elastic" } });
        expect(findLandingSurface(world, sweep)?.response).toEqual(resolveSurface({ profile: "elastic" }));
    } finally { app.dispose(); }
});


test("ice authoring persists through level IO and collision edits, supports sliding and releases at the edge", async () => {
    const object: LevelSurfaceObjectDefinition = { ...base, id: "ice-pad", surface: { profile: "ice" },
        transform: { position: [0, -0.2, 0], rotation: [0, 0, 0, 1], scale: [4, 0.4, 4] } };
    const level = parseLevelDefinition(JSON.parse(JSON.stringify({ ...parseLevelDefinition(prototype), objects: [object] })));
    const app = await createApp({ defaults: false, plugins: [PogoWorldCollisionPlugin] });
    try {
        const world = app.world;
        const [entity] = addLevelPhysics(world, level);
        world.step(Time.FIXED_DT);
        expect(findLandingSurface(world, sweep)?.response).toEqual(resolveSurface({ profile: "ice" }));
        const sim = createSim({ x: 0, y: 1.001, z: 0 });
        sim.body.vel = { x: 10, y: -1, z: 0 };
        const tick = () => step(sim, DEFAULT_TUNING, { ...NEUTRAL_CONTROLS, compress: true }, path => findLandingSurface(world, path));
        tick();
        expect(sim.pogo.state).toBe("Compression");
        const start = sim.pogo.contactTip.x;
        for (let i = 0; i < 5; i++) tick();
        expect(sim.pogo.state).toBe("Compression");
        expect(sim.pogo.contactTip.x).toBeGreaterThan(start + 0.3);
        for (let i = 0; i < 30 && sim.pogo.state === "Compression"; i++) tick();
        expect(sim.pogo.state).toBe("Airborne");
        expect(sim.body.vel.y).toBe(0);
        expect(sim.pogo.lastLaunchedContactId).toBe(-1);
        updateLevelEntity(world, entity!, { ...object, surface: { profile: "ice", overrides: { traction: 0.25 } } });
        expect(findLandingSurface(world, sweep)?.response?.traction).toBe(0.25);
    } finally { app.dispose(); }
});
