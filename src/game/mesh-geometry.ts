import { Materials, StandardMaterial, type World } from "@dylanebert/shallot";
export type Geometry = { vertices: number[]; indices: number[]; color: number[] };
export type Point = readonly [number, number, number];
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

