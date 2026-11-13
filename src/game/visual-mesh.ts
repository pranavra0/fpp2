import { resolveSurface } from "../surfaces";
import { surfaceVisualProperties } from "./platform-visuals";
import { component, u32, Materials, Meshes, MeshInstance, StandardMaterial, type MeshHandle, type Resource, type World } from "@dylanebert/shallot";
import type { LevelObjectDefinition } from "../content/level";

export const PALETTE = {
    ink: 0x292c29, cream: 0xb7ad94, edge: 0x71634f, shadow: 0x4c493e,
    green: 0x697551, grass: 0x7a8258, red: 0xa96362, gold: 0xb89a53,
    blue: 0x6d9398, ice: 0xa0b7b8,
} as const;

type Geometry = { vertices: number[]; indices: number[]; color: number[] };
type Point = readonly [number, number, number];
export function geometry(): Geometry { return { vertices: [], indices: [], color: [] }; }
function rgba(hex: number): number[] {
    return [16, 8, 0].map(shift => {
        const value = ((hex >> shift) & 255) / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    }).concat(1);
}
function shade(hex: number, factor: number): number {
    return [16,8,0].reduce((result, shift) => result | (Math.min(255, Math.round(((hex >> shift) & 255) * factor)) << shift), 0);
}
export function quad(mesh: Geometry, points: readonly Point[], color: number): void {
    const first = mesh.vertices.length / 8;
    const c = rgba(color);
    for (const p of points) { mesh.vertices.push(...p, 0, 0, 1, 0, 0); mesh.color.push(...c); }
    mesh.indices.push(first, first + 1, first + 2, first, first + 2, first + 3);
}
export function cuboid(mesh: Geometry, center: Point, size: Point, colors: readonly number[]): void {
    const [x,y,z] = center, [w,h,d] = size.map(v => v / 2) as [number,number,number];
    const p: Point[] = [[x-w,y-h,z-d],[x+w,y-h,z-d],[x+w,y+h,z-d],[x-w,y+h,z-d],
        [x-w,y-h,z+d],[x+w,y-h,z+d],[x+w,y+h,z+d],[x-w,y+h,z+d]];
    const faces = [[4,5,6,7],[1,0,3,2],[0,4,7,3],[5,1,2,6],[3,7,6,2],[0,1,5,4]];
    faces.forEach((face,i) => quad(mesh, face.map(n => p[n]!), colors[i] ?? colors[0]!));
}
export function meshData(name: string, mesh: Geometry) {
    return { name, vertices: new Float32Array(mesh.vertices), indices: new Uint32Array(mesh.indices), color: new Float32Array(mesh.color) };
}
export const flatMaterial = {
    create: (world: World) => world.resource(Materials).add(StandardMaterial({ unlit: true, doubleSided: true }), { cullMode: "none" }),
};

// A single owned mesh keeps decoration attached through editing, motion and collapse.
export function levelVisualMesh(object: LevelObjectDefinition) {
    const mesh = geometry();
    const trigger = object.collision.kind === "trigger-box";
    const dimensions = object.collision.dimensions;
    const [w,h,d] = object.transform.scale.map((v,i) => v * dimensions[i]!) as [number,number,number];
    const box = (p: Point, s: Point, colors: readonly number[]) => cuboid(mesh, p, s, colors);
    if (trigger) {
        const color = object.role === "goal" ? PALETTE.gold : PALETTE.blue;
        const post = Math.min(0.16, w * 0.1);
        for (const side of [-1,1]) {
            box([side*(w-post)/2,0,0],[post,h,post],[PALETTE.ink]);
            box([side*(w-post)/2,0,post/2+0.006],[post*0.5,h,0.012],[PALETTE.shadow]);
        }
        box([0,h/2-0.15,0],[w,0.3,0.09],[color]);
        for (let i=0;i<5;i++) box([-w/2+w*(i+0.5)/5,h/2-0.14,0.055],[w/18,0.07,0.02],[PALETTE.shadow]);
        box([0,-h/2+0.025,0],[w,0.05,d],[color]);
    } else {
        const authored = "surface" in object ? object.surface : undefined;
        const cues = surfaceVisualProperties(resolveSurface(authored, 0));
        const top = cues.lowTraction ? PALETTE.ice : cues.rebound ? PALETTE.red : cues.grip ? PALETTE.gold : cues.directionalLaunch ? PALETTE.blue : object.visual.kind === "box" && object.visual.material === "ground" ? PALETTE.grass : PALETTE.green;
        box([0,0,0],[w,h,d],[PALETTE.edge,PALETTE.edge,PALETTE.shadow,PALETTE.edge,top,PALETTE.shadow]);
        const edge = Math.min(0.10, h * 0.2);
        const inset = Math.min(0.06, w * 0.08, d * 0.08);
        for (const y of [h/2-edge/2, -h/2+edge/2]) {
            box([0,y,0],[w+0.025,edge,d+0.025],[PALETTE.shadow]);
        }
        box([0,h/2+0.012,0],[w-2*inset,0.025,d-2*inset],[top]);
        // World-sized patches preserve texture scale when the editor resizes a surface.
        const columns = Math.min(32, Math.max(1, Math.ceil(w / .45)));
        const rows = Math.min(32, Math.max(1, Math.ceil(d / .45)));
        const cellW = (w-2*inset)/columns, cellD = (d-2*inset)/rows;
        for(let x=0;x<columns;x++) for(let z=0;z<rows;z++) {
            const noise = ((x*73856093) ^ (z*19349663)) >>> 0;
            if(noise % 4 === 0) continue;
            const cx = -w/2+inset+(x+.5)*cellW, cz = -d/2+inset+(z+.5)*cellD;
            const color = shade(top, noise % 3 === 0 ? .86 : 1.06);
            quad(mesh, [[cx-cellW*.501,h/2+.028,cz-cellD*.501],[cx+cellW*.501,h/2+.028,cz-cellD*.501],
                [cx+cellW*.501,h/2+.028,cz+cellD*.501],[cx-cellW*.501,h/2+.028,cz+cellD*.501]], color);
        }
        for(let i=0;i<columns;i++) {
            const x=-w/2+(i+.5)*w/columns;
            const height = h*(.18+(i*7%5)*.06);
            box([x,-h*.08,d/2+.008],[w/columns*.7,height,.016],[i%3 ? PALETTE.shadow : PALETTE.edge]);
            box([x,h*.1,-d/2-.008],[w/columns*.6,height,.016],[PALETTE.shadow]);
        }
        if (cues.lowTraction) {
            for(let i=0;i<3;i++) box([-w*0.22+i*w*0.22,h/2+0.031,0],[0.07,0.012,d*0.55],[PALETTE.cream]);
        } else if (object.role === "platform" && object.crumble) {
            for(let i=0;i<4;i++) box([-w*.3+i*w*.2,h/2+.032,(i%2-.5)*d*.18],[w*.22,.018,.055],[PALETTE.ink]);
        } else if (cues.directionalLaunch) {
            const [dx,dz] = authored!.directionXZ!;
            const radius = Math.min(w,d)*.25;
            const point = (forward: number, side: number): Point => [dx*forward-dz*side,h/2+.04,dz*forward+dx*side];
            quad(mesh, [point(radius,0),point(-radius*.6,radius*.7),point(-radius*.25,0),point(-radius*.6,-radius*.7)], PALETTE.cream);
        } else if (w > 2 && d > 2) {
            for (const side of [-1,1]) for (let i=0;i<3;i++) box([side*(w/2-.35),h/2+.03,-d*.25+i*d*.25],[.12,.018,.35],[PALETTE.cream]);
        }
    }
    if (!trigger && object.collision.kind !== "slope" && !(object.role === "platform" && (object.motion || object.crumble)) && w > 5 && d > 5) {
        for (const side of [-1,1]) {
            const x = side * (w/2 - 0.45), z = -d/2 + 0.45, y = h/2;
            for(let i=0;i<3;i++) {
                const dx = (i-1)*0.25, height = i === 1 ? 0.85 : 0.55;
                quad(mesh, [[x,y,z],[x+dx-.16,y+height*.6,z],[x+dx,y+height,z],[x+dx+.16,y+height*.6,z]], i === 1 ? PALETTE.ink : PALETTE.green);
            }
        }
    }
    // Slopes use the same surface cross-section while retaining their exact authored top plane.
    for(let i=0;i<mesh.vertices.length;i+=8) {
        if(object.collision.kind === "slope") mesh.vertices[i+1]! += mesh.vertices[i]! / w * object.collision.rise * object.transform.scale[1];
        mesh.vertices[i]! /= trigger ? w : object.transform.scale[0];
        mesh.vertices[i+1]! /= trigger ? h : object.transform.scale[1];
        mesh.vertices[i+2]! /= trigger ? d : object.transform.scale[2];
    }
    return meshData(object.id, mesh);
}

const CHARACTER = [
    "      ######      ",
    "     #hhhhhh#     ",
    "    #hhhhhhhh#    ",
    "    #hccccchh#    ",
    "    #ccccccch#    ",
    "    #c##cc##c#    ",
    "    #cccccccc#    ",
    "     #ccsscc#     ",
    "     #cc##cc#     ",
    "   ###ccrrcc###   ",
    "  #ttt##rr##ttt#  ",
    " #ttttt#rr#ttttt# ",
    " #ctttt#rr#ttttc# ",
    " #c#ttt#rr#ttt#c# ",
    "  ##ttt#rr#ttt##  ",
    "   #ttt#rr#ttt#   ",
    "   ####    ####   ",
    "   #pp#    #pp#   ",
    "   #pp#    #pp#   ",
    "  #####    #####  ",
];
export const characterMeshes: Resource<number[]> = { create: () => [] };
export function createCharacterMeshes(world: World): number[] {
    const meshes = world.resource(characterMeshes);
    for(const expression of [0,1,2]) {
        const mesh = geometry();
        CHARACTER.forEach((row,y) => [...row].forEach((pixel,x) => {
            if(pixel === " ") return;
            let color: number = pixel === "#" ? PALETTE.ink : pixel === "c" ? 0xbc9c79 : pixel === "h" ? 0x494236 : pixel === "t" ? 0x626c63 : pixel === "p" ? 0x484c4b : pixel === "s" ? 0x957858 : PALETTE.red;
            if(expression === 1 && y === 6 && (x === 6 || x === 11)) color = PALETTE.ink;
            if(expression === 2 && y === 5 && (x === 6 || x === 11)) color = 0xd2c7b2;
            const left=(x-9)/18, top=(10-y)/18;
            quad(mesh, [[left,top,0],[left,top-1/18,0],[left+1/18,top-1/18,0],[left+1/18,top,0]],color);
        }));
        meshes.push(world.resource(Meshes).add(meshData(`player-${expression}`,mesh)));
    }
    return meshes;
}

export function landingRingMesh() {
    const mesh = geometry();
    for(let i=0;i<24;i++) {
        const a=i*Math.PI/12, b=(i+1)*Math.PI/12;
        quad(mesh, [[Math.cos(a)*.5,0,Math.sin(a)*.5],[Math.cos(a)*.38,0,Math.sin(a)*.38],
            [Math.cos(b)*.38,0,Math.sin(b)*.38],[Math.cos(b)*.5,0,Math.sin(b)*.5]],0xffffff);
    }
    return meshData("landing-ring",mesh);
}

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

export function setLevelVisualMesh(world: World, eid: number, object: LevelObjectDefinition): void {
    const keys = world.resource(generatedMeshOwnership);
    const key = JSON.stringify([object.role, object.visual, object.transform.scale, object.collision,
        "surface" in object ? object.surface : null, "crumble" in object ? object.crumble : null]);
    if (keys.get(eid) === key) return;
    if (world.has(eid, GeneratedLevelMesh)) world.remove(eid, GeneratedLevelMesh);
    const mesh = world.resource(Meshes).add(levelVisualMesh(object));
    world.add(eid, GeneratedLevelMesh, { handle: mesh });
    world.storage(MeshInstance).mesh.set(eid, mesh);
    keys.set(eid, key);
}

export function tongueMesh() {
    const mesh = geometry();
    cuboid(mesh,[0,0,0],[1.5,1,1],[PALETTE.red]);
    cuboid(mesh,[0,0,.51],[.18,.94,.025],[0x77454c]);
    for(let i=0;i<6;i++) {
        cuboid(mesh,[-.48,-.4+i*.15,.51],[.16,.045,.025],[0xbc7d78]);
        cuboid(mesh,[.4,-.34+i*.15,.51],[.12,.035,.025],[0x8d5056]);
    }
    return meshData("player-tongue",mesh);
}
