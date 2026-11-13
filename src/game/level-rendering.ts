import { resolveSurface } from "../surfaces";
import {
    MeshInstance,
    MeshMaterial,
    Transform,
    type Resource,
    type World,
} from "@dylanebert/shallot";
import type { MaterialHandle } from "@dylanebert/shallot/standard/rendering";
import { loadGltfScene, spawnGltfScene, type Gltf } from "@dylanebert/shallot/gltf";
import type {
    LevelAssetId,
    LevelDefinition,
    LevelMaterial,
    LevelObjectDefinition,
    Vec3Tuple,
} from "../content/level";
import type { LevelEntity } from "./physics";

export const LEVEL_ASSET_URLS: Partial<Record<LevelAssetId, string>> = {
    "sample-platform": "/models/sample-platform.glb",
};

type LevelAssetCache = {
    handles: Map<LevelAssetId, Gltf>;
    loads: Map<LevelAssetId, Promise<Gltf>>;
};

export const levelAssetCache: Resource<LevelAssetCache> = {
    create: () => ({ handles: new Map(), loads: new Map() }),
};

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function validateStaticModel(gltf: Gltf): void {
    if (gltf.primitives.length === 0) throw new Error("expected at least one mesh primitive");
    if (gltf.lights.length !== 0) throw new Error("expected no lights");
    if (gltf.animations.length !== 0) throw new Error("expected no animations");
    if (gltf.skins.length !== 0) throw new Error("expected no skins");
    if (gltf.primitives.some((primitive) => primitive.skin >= 0))
        throw new Error("expected static mesh primitives");
    if (gltf.primitives.some((primitive) => primitive.morphReach))
        throw new Error("expected primitives without morph targets");
    const unsupported = gltf.unsupported.filter((feature) => feature !== "camera");
    if (unsupported.length > 0)
        throw new Error(`contains unsupported glTF features: ${unsupported.join(", ")}`);
}

function validateSamplePlatform(gltf: Gltf): void {
    if (gltf.primitives.length !== 1)
        throw new Error(`expected one primitive, received ${gltf.primitives.length}`);
    const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    if (gltf.primitives[0]!.matrix.some((value, index) => value !== identity[index]))
        throw new Error("expected an identity primitive transform");
}

function assetPath(asset: LevelAssetId): string {
    return LEVEL_ASSET_URLS[asset] ?? `/models/${asset}.glb`;
}

export async function loadLevelAsset(world: World, asset: LevelAssetId): Promise<Gltf> {
    const cache = world.resource(levelAssetCache);
    const existing = cache.handles.get(asset);
    if (existing) return existing;
    const inFlight = cache.loads.get(asset);
    if (inFlight) return inFlight;

    const path = assetPath(asset);
    const baseUrl = typeof document === "undefined" ? "http://localhost/" : document.baseURI;
    const url = new URL(path, baseUrl);
    const loading = loadGltfScene(world, url).then((gltf) => {
        validateStaticModel(gltf);
        if (asset === "sample-platform") validateSamplePlatform(gltf);
        cache.handles.set(asset, gltf);
        return gltf;
    }).catch((error: unknown) => {
        throw new Error(
            `Failed to load glTF asset "${asset}" from ${path}: ${errorMessage(error)}`,
            { cause: error },
        );
    }).finally(() => {
        cache.loads.delete(asset);
    });
    cache.loads.set(asset, loading);
    return loading;
}

export async function loadModelFile(world: World, file: Blob): Promise<Gltf> {
    const url = URL.createObjectURL(file);
    try {
        const gltf = await loadGltfScene(world, url);
        validateStaticModel(gltf);
        return gltf;
    } finally {
        URL.revokeObjectURL(url);
    }
}

export function cacheLevelAsset(world: World, asset: LevelAssetId, gltf: Gltf): void {
    if (gltf.world !== world) throw new Error(`glTF asset "${asset}" belongs to another world`);
    world.resource(levelAssetCache).handles.set(asset, gltf);
}

export function modelLocalHalfExtents(world: World, asset: LevelAssetId): Vec3Tuple {
    const gltf = world.resource(levelAssetCache).handles.get(asset);
    if (!gltf) throw new Error(`glTF asset "${asset}" has not been loaded`);
    return [
        Math.max(Math.abs(gltf.bounds.min[0]), Math.abs(gltf.bounds.max[0])),
        Math.max(Math.abs(gltf.bounds.min[1]), Math.abs(gltf.bounds.max[1])),
        Math.max(Math.abs(gltf.bounds.min[2]), Math.abs(gltf.bounds.max[2])),
    ];
}

export async function loadLevelAssets(world: World, level: LevelDefinition): Promise<void> {
    const assets = new Set<LevelAssetId>();
    for (const object of level.objects) {
        if (object.visual.kind === "gltf") assets.add(object.visual.asset);
    }
    await Promise.all([...assets].map((asset) => loadLevelAsset(world, asset)));
}

function visualScale(object: LevelObjectDefinition): readonly [number, number, number] {
    if (object.collision.kind !== "trigger-box") return object.transform.scale;
    return [
        object.transform.scale[0] * object.collision.dimensions[0],
        object.transform.scale[1] * object.collision.dimensions[1],
        object.transform.scale[2] * object.collision.dimensions[2],
    ];
}

function addBoxVisual(
    world: World,
    object: LevelObjectDefinition,
    material: MaterialHandle,
): number {
    const eid = world.create();
    world.add(eid, Transform, {
        translation: object.transform.position,
        rotation: object.transform.rotation,
        scale: visualScale(object),
    });
    world.add(eid, MeshInstance);
    world.add(eid, MeshMaterial, material);
    return eid;
}

function updateSurfaceIndicators(world: World, entity: LevelEntity, object: LevelObjectDefinition, material: MaterialHandle): void {
    for (const eid of entity.indicatorEids ?? []) world.destroy(eid);
    entity.indicatorEids = [];
    if (!("surface" in object) || !object.surface || object.surface.profile === "default") return;
    const { position, scale } = object.transform;
    const topY = position[1] + scale[1] * object.collision.dimensions[1] / 2 + 0.025;
    const rotationY = 2 * Math.atan2(object.transform.rotation[1], object.transform.rotation[3]);
    const response = resolveSurface(object.surface, rotationY);
    const size = Math.min(1, scale[0] * object.collision.dimensions[0] * 0.3, scale[2] * object.collision.dimensions[2] * 0.3);
    const bar = (x: number, z: number, length: number, angle: number) => {
        const eid = world.create();
        world.add(eid, Transform, { translation: [position[0] + x, topY, position[2] + z],
            scale: [length, 0.035, size * 0.09], rotation: [0, Math.sin(angle / 2), 0, Math.cos(angle / 2)] });
        world.add(eid, MeshInstance);
        world.add(eid, MeshMaterial, material);
        entity.indicatorEids!.push(eid);
    };
    if (object.surface.profile === "directional") {
        const angle = Math.atan2(-response.directionZ, response.directionX);
        bar(0, 0, size, angle);
        const headX = response.directionX * size * 0.35;
        const headZ = response.directionZ * size * 0.35;
        for (const sign of [-1, 1]) {
            const wingAngle = angle + sign * Math.PI / 4;
            bar(headX - Math.cos(wingAngle) * size * 0.18, headZ + Math.sin(wingAngle) * size * 0.18, size * 0.5, wingAngle);
        }
    } else if (object.surface.profile === "ice") {
        for (const offset of [-0.2, 0.2]) bar(0, offset * size, size, Math.PI / 4);
    } else if (object.surface.profile === "grip") {
        for (const offset of [-0.3, 0, 0.3]) bar(0, offset * size, size, 0);
    } else {
        bar(0, 0, size, Math.PI / 4);
        bar(0, 0, size, -Math.PI / 4);
    }
}

export function addLevelRendering(
    world: World,
    objects: readonly LevelEntity[],
    materials: Record<LevelMaterial, MaterialHandle>,
): void {
    const cache = world.resource(levelAssetCache);
    for (const entity of objects) {
        const { object } = entity;
        updateSurfaceIndicators(world, entity, object, materials.goal);
        if (object.visual.kind === "box") {
            entity.visualEids = [addBoxVisual(world, object, materials[object.visual.material])];
            continue;
        }
        const gltf = cache.handles.get(object.visual.asset);
        if (!gltf)
            throw new Error(
                `glTF asset "${object.visual.asset}" was not loaded from ${assetPath(object.visual.asset)}`,
            );
        const placement = spawnGltfScene(world, gltf, {
            translation: object.transform.position,
            rotation: object.transform.rotation,
            scale: object.transform.scale,
        });
        if (placement.entities.length === 0 || placement.lightEntities.length !== 0)
            throw new Error(`glTF asset "${object.visual.asset}" does not match its static placement contract`);
        entity.visualEids = placement.entities;
    }
}

export function updateLevelRendering(
    world: World,
    entity: LevelEntity,
    object: LevelObjectDefinition,
    indicatorMaterial: MaterialHandle,
): void {
    updateSurfaceIndicators(world, entity, object, indicatorMaterial);
    if (object.visual.kind !== "gltf") return;
    const gltf = world.resource(levelAssetCache).handles.get(object.visual.asset);
    if (!gltf)
        throw new Error(
            `glTF asset "${object.visual.asset}" was not loaded from ${assetPath(object.visual.asset)}`,
        );
    const placement = spawnGltfScene(world, gltf, {
        translation: object.transform.position,
        rotation: object.transform.rotation,
        scale: object.transform.scale,
    });
    if (placement.entities.length === 0 || placement.lightEntities.length !== 0)
        throw new Error(`glTF asset "${object.visual.asset}" does not match its static placement contract`);
    for (const eid of entity.visualEids ?? []) world.destroy(eid);
    entity.visualEids = placement.entities;
}
