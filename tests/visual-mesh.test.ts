import { expect, test } from "bun:test";
import { landingRingMesh, levelVisualMesh } from "../src/game/visual-mesh";
import { parseLevelDefinition } from "../src/content/level";
import first from "../public/levels/first-level.json";

const level = parseLevelDefinition(first);
test("generated geometry has valid indexed color streams for every opening-course object", () => {
    for(const object of level.objects) {
        const mesh = levelVisualMesh(object);
        const vertices = mesh.vertices.length / 8;
        expect(mesh.color.length).toBe(vertices * 4);
        expect([...mesh.vertices].every(Number.isFinite)).toBe(true);
        expect([...mesh.indices].every(index => index < vertices)).toBe(true);
        expect([...mesh.color].every(value => value >= 0 && value <= 1)).toBe(true);
    }
});

test("thin and narrow platforms do not produce inverted decorative top faces", () => {
    const platform = level.objects.find(object => object.role === "platform")!;
    const mesh = levelVisualMesh({ ...platform, transform: { ...platform.transform, scale: [.1,.1,.1] } });
    expect([...mesh.vertices].every(Number.isFinite)).toBe(true);
    // The fourth cuboid is the top inset; its front edge must keep positive width.
    const first = 3 * 24 * 8;
    expect(mesh.vertices[first + 8]! - mesh.vertices[first]!).toBeGreaterThan(0);
});

test("generated slope core matches collision vertices after scaling", () => {
    const platform = level.objects.find(object => object.role === "platform")!;
    const object = { ...platform, transform: { ...platform.transform, scale: [8,2,4] as const }, collision: { kind: "slope" as const, dimensions: [1,1,1] as const, rise: .6 } };
    const mesh = levelVisualMesh(object);
    // The first cuboid is the collision cross-section; all subsequent geometry is decoration.
    for(let offset=0;offset<24*8;offset+=8) {
        const x=mesh.vertices[offset]!, y=mesh.vertices[offset+1]!, z=mesh.vertices[offset+2]!;
        expect(Math.abs(x)).toBeCloseTo(.5);
        expect(Math.abs(z)).toBeCloseTo(.5);
        expect(Math.abs(y-x*.6)).toBeCloseTo(.5);
    }
});


test("landing ring faces upward for the marker's back-face culling material", () => {
    const mesh = landingRingMesh();
    for(let i=0;i<mesh.indices.length;i+=3) {
        const [a,b,c]=[0,1,2].map(j=>mesh.indices[i+j]! * 8);
        const ux=mesh.vertices[b!]!-mesh.vertices[a!]!, uz=mesh.vertices[b!+2]!-mesh.vertices[a!+2]!;
        const vx=mesh.vertices[c!]!-mesh.vertices[a!]!, vz=mesh.vertices[c!+2]!-mesh.vertices[a!+2]!;
        expect(uz*vx-ux*vz).toBeGreaterThan(0);
    }
});

test("directional marking follows authored direction even on an overridden default surface", () => {
    const platform=level.objects.find(object=>object.role === "platform")!;
    const mesh=levelVisualMesh({...platform,transform:{...platform.transform,scale:[4,.6,4]},
        surface:{profile:"default",directionXZ:[0,-1],overrides:{directionalSpeed:4}}});
    const tip=mesh.vertices.length-4*8;
    expect(mesh.vertices[tip]).toBeCloseTo(0);
    expect(mesh.vertices[tip+2]).toBeCloseTo(-.25);
});
