import { Camera, Resolution, MeshInstance, MeshMaterial, Transform, type Resource, type World } from "@dylanebert/shallot";
import { DEFAULT_APPEARANCE, colorValue, type SceneryPlacement } from "../content/appearance";
import type { LevelDefinition } from "../content/level";
import { geometry, meshData, flatMaterial, quad, cuboid, type Geometry, type Point } from "./mesh-geometry";
import { setOwnedMesh } from "./mesh-ownership";

const scenery: Resource<Map<string, number>> = { create: () => new Map() };

function polygon(mesh: Geometry, points: readonly Point[], color: number): void {
    for (let i = 1; i < points.length - 1; i++) quad(mesh, [points[0]!, points[i]!, points[i + 1]!, points[i + 1]!], color);
}
export function sceneryMesh(item: SceneryPlacement) {
    const mesh = geometry();
    const light = colorValue(item.color), dark = colorValue(item.shade);
    if (item.shape === "plane") {
        quad(mesh, [[-.5,0,-.5],[.5,0,-.5],[.5,0,.5],[-.5,0,.5]], light);
    } else if (item.shape === "ridge") {
        polygon(mesh, [[-.5,0,0],[-.5,.3,0],[-.35,.48,0],[-.2,.42,0],[.02,1,0],[.2,.66,0],[.33,.72,0],[.5,.25,0],[.5,0,0]], light);
        polygon(mesh, [[.02,1,.001],[.2,.66,.001],[.33,.72,.001],[.5,.25,.001],[.5,0,.001],[-.14,0,.001]], dark);
    } else if (item.shape === "rock") {
        polygon(mesh, [[-.5,0,.2],[-.4,.7,.1],[0,1,-.1],[.4,.75,0],[.5,0,.2]], light);
        polygon(mesh, [[0,1,-.1],[.4,.75,0],[.5,0,.2],[.05,0,.3]], dark);
    } else {
        cuboid(mesh, [0,.27,0], [.035,.54,.035], [dark]);
        // The folded crown has one light face and one shadow face, with no random detail.
        const crown: Point[] = [[-.48,.42,0],[-.36,.72,0],[-.15,.82,0],[-.06,1,0],[.24,.88,0],[.46,.59,0],[.34,.37,0],[-.12,.32,0]];
        polygon(mesh, crown, light);
        polygon(mesh, [[-.06,1,.005],[.24,.88,.005],[.46,.59,.005],[.34,.37,.005],[-.12,.32,.005],[.08,.61,.005]], dark);
    }
    return meshData(item.id, mesh);
}

export function updateScenery(world: World, level: LevelDefinition): void {
    const appearance = level.appearance ?? DEFAULT_APPEARANCE;
    const entities = world.resource(scenery);
    const ids = new Set(appearance.scenery.map(item => item.id));
    for (const [id, eid] of entities) if (!ids.has(id)) { world.destroy(eid); entities.delete(id); }
    for (const item of appearance.scenery) {
        let eid = entities.get(item.id);
        if (eid === undefined) {
            eid = world.create();
            world.add(eid, Transform);
            world.add(eid, MeshInstance);
            world.add(eid, MeshMaterial, world.resource(flatMaterial));
            entities.set(item.id, eid);
        }
        world.add(eid, Transform, { translation: item.position, scale: item.scale, rotation: [0, Math.sin(item.yaw / 2), 0, Math.cos(item.yaw / 2)] });
        setOwnedMesh(world, eid, JSON.stringify([item.shape, item.color, item.shade]), () => sceneryMesh(item));
    }
    for (const eid of world.query([Camera])) {
        world.storage(Camera).clearColor.set(eid, colorValue(appearance.sky));
        world.storage(Camera).antialias.set(eid, 0);
        world.add(eid, Resolution, { height: appearance.resolution });
    }
}
