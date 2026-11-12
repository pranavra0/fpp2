import {
    MeshInstance,
    MeshMaterial,
    type World,
} from "@dylanebert/shallot";
import type { MaterialHandle } from "@dylanebert/shallot/standard/rendering";
import type { LevelMaterial } from "../content/level";
import type { LevelEntity } from "./physics";

export function addLevelRendering(
    world: World,
    objects: readonly LevelEntity[],
    materials: Record<LevelMaterial, MaterialHandle>,
): void {
    for (const { eid, object } of objects) {
        if (object.visual.kind !== "box")
            throw new Error(`Unsupported visual kind "${object.visual.kind}" for level object "${object.id}"`);
        world.add(eid, MeshInstance);
        world.add(eid, MeshMaterial, materials[object.visual.material]);
    }
}
