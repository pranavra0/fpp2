import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createApp, Time, Transform } from "@dylanebert/shallot";
import { loadGltf } from "@dylanebert/shallot/gltf";
import { parseGlb } from "../node_modules/@dylanebert/shallot/src/extras/gltf/glb";
import { castRayClosest, emptyQueryHit } from "@dylanebert/shallot/standard/physics";
import { parsePublication } from "../tools/blender/server";
import { levelSurfaces, surfaceHeightAt } from "../src/content/level";
import { addLevelPhysics, findLandingSurface, LandingSurface, PogoWorldCollisionPlugin } from "../src/game/physics";
import { advancePlatforms, capturePlatformVisuals, confirmPlatformContact, platformSupport, resetPlatforms } from "../src/game/platforms";
import { PlatformPose } from "../src/game/platform-components";
import { findPlayerContact } from "../src/game/player-collision";
import { createGameplayProgress, advanceGameplay } from "../src/game/gameplay";
import { sweepCapsuleTriggers, PLAYER_TRIGGER_CAPSULE } from "../src/game/trigger-contact";
import { step } from "../src/game/simulation-step";
import { createSim, NEUTRAL_CONTROLS } from "../src/sim";
import { DEFAULT_TUNING } from "../src/config/gameplay";

test("actual Blender export supplies synchronized GLBs, native collision, pogo landings and gameplay behaviors", async () => {
    const blender = process.env.BLENDER_BIN;
    if (!blender) throw new Error("Set BLENDER_BIN to a Blender 4.2+ executable for this integration check");
    const directory = await mkdtemp(resolve(tmpdir(), "fpp2-blender-gameplay-"));
    try {
        const publicationPath = resolve(directory, "publication.json");
        const process = Bun.spawn([blender, "--background", "--factory-startup", "--python-exit-code", "1", "--python", resolve("tests/blender-export.py")], {
            env: { ...Bun.env, FPP2_PUBLICATION_PATH: publicationPath, FPP2_BLEND_PATH: resolve(directory, "level.blend"), FPP2_PUBLISH_URL: "" },
            stdout: "pipe", stderr: "pipe",
        });
        const [code, stdout, stderr] = await Promise.all([process.exited, new Response(process.stdout).text(), new Response(process.stderr).text()]);
        if (code !== 0) throw new Error(`Blender failed (${code}):\n${stdout}\n${stderr}`);
        const { revision, assets } = await parsePublication(JSON.parse(await readFile(publicationPath, "utf8")));
        const level = revision.level;
        const ground = level.objects.find(object => object.id === "ground")!;
        const groundGlb = assets.get(ground.visual.kind === "gltf" ? ground.visual.asset : "")!;
        const { json: groundJson } = parseGlb(groundGlb.buffer.slice(groundGlb.byteOffset, groundGlb.byteOffset + groundGlb.byteLength));
        expect(groundJson.materials.length).toBeGreaterThanOrEqual(2);
        const groundPrimitive = groundJson.meshes.flatMap(mesh => mesh.primitives)[0]!;
        expect(groundPrimitive.attributes).toHaveProperty("TEXCOORD_0");
        expect(groundPrimitive.material).toBeDefined();
        expect(groundJson.meshes.flatMap(mesh => mesh.primitives).some(primitive => primitive.material === 1)).toBe(true);
        expect(level.objects.some(object => object.visual.kind === "gltf")).toBe(true);
        const assetIds = [...assets.keys()];
        const decoded = await Promise.all([...assets].map(async ([id, bytes]) => {
            const model = await loadGltf(new URL(`http://localhost/models/${id}.glb`), async () => new Response(bytes));
            expect(model.instances.length).toBeGreaterThan(0);
            expect(model.unsupported).toEqual([]);
            expect(model.meshes.every(mesh => [...mesh.vertices].every(Number.isFinite))).toBe(true);
            return model;
        }));
        expect(decoded.length).toBeGreaterThan(1);
        expect(decoded.some(model => model.materials.length >= 2)).toBe(true);
        expect(decoded.some(model => model.meshes.some(mesh => Array.from(mesh.vertices).some((value, index) => (index % 8 === 3 || index % 8 === 7) && value > 1)))).toBe(true);
        for (const object of level.objects) {
            if (object.role !== "platform" || (!object.motion && object.collision.kind !== "slope") || object.visual.kind !== "gltf") continue;
            const model = decoded[assetIds.indexOf(object.visual.asset)]!;
            const worldPoints: number[][] = [];
            const angle = 2 * Math.atan2(object.transform.rotation[1], object.transform.rotation[3]);
            const place = (point: readonly number[]): number[] => {
                const [x, y, z] = point.map((value, axis) => value * object.transform.scale[axis]!) as [number, number, number];
                return [object.transform.position[0] + Math.cos(angle) * x + Math.sin(angle) * z,
                    object.transform.position[1] + y, object.transform.position[2] - Math.sin(angle) * x + Math.cos(angle) * z];
            };
            for (const instance of model.instances) {
                const mesh = model.meshes[instance.mesh]!, matrix = instance.matrix;
                for (let offset = 0; offset < mesh.vertices.length; offset += 8) {
                    const x = mesh.vertices[offset]!, y = mesh.vertices[offset + 1]!, z = mesh.vertices[offset + 2]!;
                    worldPoints.push(place([matrix[0]! * x + matrix[4]! * y + matrix[8]! * z + matrix[12]!,
                        matrix[1]! * x + matrix[5]! * y + matrix[9]! * z + matrix[13]!,
                        matrix[2]! * x + matrix[6]! * y + matrix[10]! * z + matrix[14]!]));
                }
            }
            const [width, height, depth] = object.collision.dimensions;
            for (const x of [-width / 2, width / 2]) for (const y of [-height / 2, height / 2]) for (const z of [-depth / 2, depth / 2]) {
                const expected = place([x, y + (object.collision.kind === "slope" ? x / width * object.collision.rise : 0), z]);
                expect(worldPoints.some(point => Math.hypot(...point.map((value, axis) => value - expected[axis]!)) < 0.0001)).toBe(true);
            }
        }
        const app = await createApp({ defaults: false, plugins: [PogoWorldCollisionPlugin] });
        try {
            const world = app.world;
            const entities = addLevelPhysics(world, level);
            for (const entity of entities) {
                if (entity.collisionEid === undefined) continue;
                const visual = world.create();
                world.add(visual, Transform, { translation: entity.object.transform.position, scale: entity.object.transform.scale });
                entity.visualEids = [visual];
                capturePlatformVisuals(world, entity);
            }
            world.step(Time.FIXED_DT);
            resetPlatforms(world, entities);
            expect([...world.query([LandingSurface])].length).toBe(levelSurfaces(level).length);
            for (const entity of entities) {
                const eid = entity.collisionEid;
                if (eid === undefined) continue;
                const surface = world.storage(LandingSurface);
                const x = surface.centerX.get(eid), z = surface.centerZ.get(eid), y = surface.topY.get(eid);
                const hit = emptyQueryHit();
                expect(castRayClosest(world, { x, y: y + 0.15, z }, { x: 0, y: -0.3, z }, hit)).toBe(true);
                expect(hit.point.y).toBeCloseTo(y, 4);
                const landing = findLandingSurface(world, { previousTip: { x, y: y + 0.1, z }, currentTip: { x, y: y - 0.1, z } });
                expect(landing?.platformId).toBe(eid);
                expect(landing?.surfaceY).toBeCloseTo(y, 4);
                const transform = world.storage(Transform);
                const visual = entity.visualEids![0]!;
                expect(transform.translation.x.get(visual) - entity.object.transform.position[0]).toBeCloseTo(x - entity.object.transform.position[0], 5);
                expect(transform.translation.z.get(visual)).toBeCloseTo(z, 5);
            }
            const staticPlatform = entities.find(entity => entity.object.role === "platform" && !entity.object.motion && !entity.object.crumble)!;
            expect(staticPlatform).toBeDefined();
            const surface = levelSurfaces(level).find(surface => surface.id === staticPlatform.id)!;
            const sim = createSim({ x: surface.centerX, y: surfaceHeightAt(surface, surface.centerX, surface.centerZ) + 1.001, z: surface.centerZ });
            sim.body.vel.y = -1;
            let landings = 0;
            for (let tick = 0; tick < 100; tick++) {
                const contact = step(sim, DEFAULT_TUNING, { ...NEUTRAL_CONTROLS, compress: true }, sweep => findLandingSurface(world, sweep), sweep => findPlayerContact(world, sweep), platformSupport(world, sim));
                if (contact?.platformId === staticPlatform.collisionEid) landings++;
            }
            expect(landings).toBeGreaterThan(0);
            const moving = entities.find(entity => entity.object.role === "platform" && entity.object.motion)!;
            expect(moving).toBeDefined();
            const movingEid = moving.collisionEid!;
            const beforeX = world.storage(PlatformPose).x.get(movingEid);
            for (let tick = 0; tick < 15; tick++) advancePlatforms(world, entities, sim, 1 / DEFAULT_TUNING.SIM_HZ);
            expect(world.storage(PlatformPose).x.get(movingEid)).not.toBe(beforeX);
            expect(world.storage(Transform).translation.x.get(moving.visualEids![0]!)).toBeCloseTo(world.storage(PlatformPose).x.get(movingEid), 4);
            const crumble = entities.find(entity => entity.object.role === "platform" && entity.object.crumble)!;
            const crumbleEid = crumble.collisionEid!;
            const pose = world.storage(PlatformPose);
            const cx = pose.x.get(crumbleEid), cz = pose.z.get(crumbleEid);
            const cy = world.storage(LandingSurface).topY.get(crumbleEid);
            confirmPlatformContact(world, findLandingSurface(world, { previousTip: { x: cx, y: cy + 0.1, z: cz }, currentTip: { x: cx, y: cy - 0.1, z: cz } }));
            const away = createSim({ x: 1000, y: 1000, z: 1000 });
            for (let tick = 0; tick < 250; tick++) advancePlatforms(world, entities, away, 1 / DEFAULT_TUNING.SIM_HZ);
            expect(pose.available.get(crumbleEid)).toBe(0);
            expect(world.storage(Transform).scale.x.get(crumble.visualEids![0]!)).toBe(0);
            const progress = createGameplayProgress(level);
            for (const role of ["checkpoint", "goal"] as const) {
                const trigger = level.objects.find(object => object.role === role)!;
                const [x, y, z] = trigger.transform.position;
                const contacts = sweepCapsuleTriggers(level, [x - 10, y, z], [x, y, z], PLAYER_TRIGGER_CAPSULE);
                expect(advanceGameplay(level, progress, [x, y, z], [contacts])).toBe(role === "checkpoint" ? "checkpoint" : "complete");
            }
        } finally { app.dispose(); }
    } finally { await rm(directory, { recursive: true, force: true }); }
}, 120000);
