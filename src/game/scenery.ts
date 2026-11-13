import { Meshes, MeshInstance, MeshMaterial, Transform, type MeshHandle, type Resource, type World } from "@dylanebert/shallot";
import type { LevelDefinition } from "../content/level";
import { geometry, meshData, flatMaterial, quad } from "./visual-mesh";

const scenery: Resource<{ entity?: number; mesh?: MeshHandle; key: string }> = { create: () => ({ key: "" }) };

export function updateScenery(world: World, level: LevelDefinition): void {
    const state = world.resource(scenery);
    const bounds = level.objects.map(object => {
        const [x,,z] = object.transform.position;
        const radius = Math.hypot(object.transform.scale[0]*object.collision.dimensions[0], object.transform.scale[2]*object.collision.dimensions[2])/2;
        const path = object.role === "platform" ? object.motion?.path ?? [[0,0,0]] : [[0,0,0]];
        return { left: x-radius+Math.min(...path.map(p=>p[0]!)), right: x+radius+Math.max(...path.map(p=>p[0]!)),
            back: z-radius+Math.min(...path.map(p=>p[2]!)), front: z+radius+Math.max(...path.map(p=>p[2]!)) };
    });
    const left = Math.min(...bounds.map(p => p.left)) - 24;
    const right = Math.max(...bounds.map(p => p.right)) + 24;
    const back = Math.min(...bounds.map(p => p.back)) - 24;
    const front = Math.max(...bounds.map(p => p.front)) + 24;
    const floor = level.failureBoundaryY - 2;
    const key = [left,right,back,front,floor].join();
    if(state.key === key) return;
    state.key = key;
    const mesh = geometry();
    quad(mesh, [[left-150,floor,back-100],[right+150,floor,back-100],[right+150,floor,front+100],[left-150,floor,front+100]], 0x818d85);
    for(let layer=0;layer<3;layer++) {
        const z=back-18+layer*7, base=floor-1;
        const colors=[0x929b89,0x7d8977,0x687a6e];
        for(let i=0;i<12;i++) {
            const x=left-60+i*18;
            const height=7+Math.sin(i*1.7+layer)*4+layer*2;
            quad(mesh, [[x,base,z],[x+18,base,z],[x+18,height+Math.sin((i+1)*1.7+layer)*3,z],[x,height,z]],colors[layer]!);
        }
    }
    // Peripheral silhouettes remain beyond playable surfaces and cannot be mistaken for landing pads.
    for (const side of [left,right]) for(let z=back+8;z<front;z+=12) {
        const height=7+Math.sin(z*1.3)*2, x=side+Math.sin(z)*3;
        quad(mesh, [[x-.14,floor,z],[x+.14,floor,z],[x+.14,height,z],[x-.14,height,z]],0x494f43);
        for(let tier=0;tier<3;tier++) {
            const y=height-tier*2, width=2.6+tier*.5;
            quad(mesh, [[x-width,y-3,z],[x+width,y-3,z],[x+.2,y+1,z],[x-.2,y+1,z]],side === left ? 0x5a6c54 : 0x65745c);
        }
    }
    const handle=world.resource(Meshes).add(meshData("level-scenery",mesh));
    if(state.entity === undefined) {
        state.entity=world.create();
        world.add(state.entity,Transform);
        world.add(state.entity,MeshInstance);
        world.add(state.entity,MeshMaterial,world.resource(flatMaterial));
    }
    world.storage(MeshInstance).mesh.set(state.entity,handle);
    if(state.mesh !== undefined) world.resource(Meshes).remove(state.mesh);
    state.mesh=handle;
}
