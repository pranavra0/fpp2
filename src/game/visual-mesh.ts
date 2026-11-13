import { DEFAULT_APPEARANCE, colorValue, type SurfaceAppearance } from "../content/appearance";
import { geometry, quad, cuboid, meshData, type Point } from "./mesh-geometry";
import { setOwnedMesh } from "./mesh-ownership";
export { flatMaterial } from "./mesh-geometry";
import { resolveSurface } from "../surfaces";
import { surfaceVisualProperties } from "./platform-visuals";
import { Meshes, type Resource, type World } from "@dylanebert/shallot";
import type { LevelObjectDefinition } from "../content/level";

export const PALETTE = {
    ink: 0x292c29, cream: 0xb7ad94, edge: 0x71634f, shadow: 0x4c493e,
    green: 0x697551, grass: 0x7a8258, red: 0xa96362, gold: 0xb89a53,
    blue: 0x6d9398, ice: 0xa0b7b8,
} as const;

// A single owned mesh keeps decoration attached through editing, motion and collapse.
export function levelVisualMesh(object: LevelObjectDefinition, appearance: SurfaceAppearance = DEFAULT_APPEARANCE.surface) {
    const palette = Object.fromEntries(Object.entries(object.appearance ?? appearance).map(([key, value]) => [key, colorValue(value)])) as Record<keyof SurfaceAppearance, number>;
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
        const top = cues.lowTraction ? PALETTE.ice : cues.rebound ? PALETTE.red : cues.grip ? PALETTE.gold : cues.directionalLaunch ? PALETTE.blue : palette.top;
        box([0,0,0],[w,h,d],[palette.side,palette.shadow,palette.shadow,palette.side,top,palette.shadow]);
        const edge = Math.min(0.07, h * 0.15);
        const inset = Math.min(0.06, w * 0.08, d * 0.08);
        box([0,h/2-edge/2,0],[w+0.012,edge,d+0.012],[palette.edge]);
        box([0,h/2+0.003,0],[w-2*inset,0.006,d-2*inset],[top]);
        if (cues.lowTraction) {
            for(let i=0;i<3;i++) box([-w*0.22+i*w*0.22,h/2+0.031,0],[0.07,0.012,d*0.55],[PALETTE.cream]);
        } else if (object.role === "platform" && object.crumble) {
            for(let i=0;i<4;i++) box([-w*.3+i*w*.2,h/2+.032,(i%2-.5)*d*.18],[w*.22,.018,.055],[PALETTE.ink]);
        } else if (cues.directionalLaunch) {
            const [dx,dz] = authored!.directionXZ!;
            const radius = Math.min(w,d)*.25;
            const point = (forward: number, side: number): Point => [dx*forward-dz*side,h/2+.04,dz*forward+dx*side];
            quad(mesh, [point(radius,0),point(-radius*.6,radius*.7),point(-radius*.25,0),point(-radius*.6,-radius*.7)], PALETTE.cream);
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
    if (meshes.length) return meshes;
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

export function setLevelVisualMesh(world: World, eid: number, object: LevelObjectDefinition, appearance: SurfaceAppearance = DEFAULT_APPEARANCE.surface): void {
    const key = JSON.stringify([object.role, object.visual, object.appearance ?? appearance, object.transform.scale, object.collision,
        "surface" in object ? object.surface : null, "crumble" in object ? object.crumble : null]);
    setOwnedMesh(world, eid, key, () => levelVisualMesh(object, appearance));
}
