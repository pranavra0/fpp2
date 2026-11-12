import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { loadGltf } from "@dylanebert/shallot/gltf";

test("sample-platform GLB contains one static textured primitive with identity placement", async () => {
    const path = new URL("../public/models/sample-platform.glb", import.meta.url);
    const scene = await loadGltf(path, async () => new Response(await readFile(path)));

    expect(scene.instances).toHaveLength(1);
    expect(scene.meshes).toHaveLength(1);
    expect(scene.materials).toHaveLength(1);
    expect(scene.animations).toHaveLength(0);
    expect(scene.skins).toHaveLength(0);
    expect(scene.lights).toHaveLength(0);
    expect(scene.unsupported).toHaveLength(0);
    expect(scene.instances[0]!.skin).toBe(-1);
    expect(Array.from(scene.instances[0]!.matrix)).toEqual([
        1, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 1, 0,
        0, 0, 0, 1,
    ]);

    const mesh = scene.meshes[0]!;
    expect(mesh.morphTargets).toBeUndefined();
    expect(mesh.vertices.length).toBeGreaterThan(0);
    const uv0 = mesh.vertices.filter((_, index) => index % 8 === 3 || index % 8 === 7);
    expect(uv0.some((value) => value !== 0)).toBe(true);
    const bounds = [
        [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY],
        [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY],
        [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY],
    ];
    for (let index = 0; index < mesh.vertices.length; index += 8) {
        for (let axis = 0; axis < 3; axis++) {
            const value = mesh.vertices[index + axis]!;
            bounds[axis]![0] = Math.min(bounds[axis]![0]!, value);
            bounds[axis]![1] = Math.max(bounds[axis]![1]!, value);
        }
    }
    for (const [minimum, maximum] of bounds) expect(maximum - minimum).toBeCloseTo(1, 2);

    expect(scene.materials[0]!.texture).toBeDefined();
    expect(scene.materials[0]!.metallic).toBeCloseTo(0.18, 2);
    expect(scene.materials[0]!.roughness).toBeCloseTo(0.68, 2);
    expect(scene.textures).toHaveLength(1);
    expect(scene.images).toHaveLength(1);
    expect(scene.images[0]!.mimeType).toBe("image/png");
    expect(scene.images[0]!.bytes!.length).toBeGreaterThan(0);
});
