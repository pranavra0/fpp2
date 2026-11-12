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
} from "../content/level";
import type { LevelEntity } from "./physics";

export const LEVEL_ASSET_URLS: Record<LevelAssetId, string> = {
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

function validateSamplePlatform(gltf: Gltf): void {
    if (gltf.primitives.length !== 1)
        throw new Error(`expected one primitive, received ${gltf.primitives.length}`);
    if (gltf.lights.length !== 0) throw new Error("expected no lights");
    if (gltf.animations.length !== 0) throw new Error("expected no animations");
    if (gltf.skins.length !== 0) throw new Error("expected no skins");
    if (gltf.primitives[0]!.skin >= 0) throw new Error("expected a static primitive");
    if (gltf.primitives[0]!.morphReach) throw new Error("expected a primitive without morph targets");
    const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    if (gltf.primitives[0]!.matrix.some((value, index) => value !== identity[index]))
        throw new Error("expected an identity primitive transform");
}

export async function loadLevelAsset(world: World, asset: LevelAssetId): Promise<Gltf> {
    const cache = world.resource(levelAssetCache);
    const existing = cache.handles.get(asset);
    if (existing) return existing;
    const inFlight = cache.loads.get(asset);
    if (inFlight) return inFlight;

    const path = LEVEL_ASSET_URLS[asset];
    const baseUrl = typeof document === "undefined" ? "http://localhost/" : document.baseURI;
    const url = new URL(path, baseUrl);
    const loading = loadGltfScene(world, url).then((gltf) => {
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

export function addLevelRendering(
    world: World,
    objects: readonly LevelEntity[],
    materials: Record<LevelMaterial, MaterialHandle>,
): void {
    const cache = world.resource(levelAssetCache);
    for (const entity of objects) {
        const { object } = entity;
        if (object.visual.kind === "box") {
            entity.visualEid = addBoxVisual(world, object, materials[object.visual.material]);
            continue;
        }
        const gltf = cache.handles.get(object.visual.asset);
        if (!gltf)
            throw new Error(
                `glTF asset "${object.visual.asset}" was not loaded from ${LEVEL_ASSET_URLS[object.visual.asset]}`,
            );
        const placement = spawnGltfScene(world, gltf, {
            translation: object.transform.position,
            rotation: object.transform.rotation,
            scale: object.transform.scale,
        });
        if (placement.entities.length !== 1 || placement.lightEntities.length !== 0)
            throw new Error(`glTF asset "${object.visual.asset}" does not match its static placement contract`);
        entity.visualEid = placement.entities[0]!;
    }
}
