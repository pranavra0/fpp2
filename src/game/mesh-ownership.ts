import { component, u32, Meshes, MeshInstance, type MeshHandle, type Resource, type World } from "@dylanebert/shallot";
import type { meshData } from "./mesh-geometry";
const GeneratedLevelMesh = component("GeneratedLevelMesh", { handle: u32 });
const generatedMeshOwnership: Resource<Map<number,string>> = {
    create(world) {
        const keys = new Map<number,string>();
        const stop = world.observeMembership(GeneratedLevelMesh, (eid, present) => {
            if (present) return;
            world.resource(Meshes).remove(world.storage(GeneratedLevelMesh).handle.get(eid) as MeshHandle);
            keys.delete(eid);
        });
        world.onDispose(stop);
        return keys;
    },
};

export function setOwnedMesh(world: World, eid: number, key: string, build: () => ReturnType<typeof meshData>): void {
    const keys = world.resource(generatedMeshOwnership);
    if (keys.get(eid) === key) return;
    const mesh = world.resource(Meshes).add(build());
    if (world.has(eid, GeneratedLevelMesh)) world.remove(eid, GeneratedLevelMesh);
    world.add(eid, GeneratedLevelMesh, { handle: mesh });
    world.storage(MeshInstance).mesh.set(eid, mesh);
    keys.set(eid, key);
}
