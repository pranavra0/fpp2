import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import { loadGltf, parseGlb } from "@dylanebert/shallot/gltf";
import { parseLevelDefinition } from "../../src/content/level";
import type { PlaytestRevision } from "../../src/game/playtest";

const MAX_BYTES = 96 * 1024 * 1024;
function digest(bytes: Uint8Array | string): string { return createHash("sha256").update(bytes).digest("hex"); }

export async function parsePublication(value: unknown): Promise<{ revision: PlaytestRevision; assets: Map<string, Buffer> }> {
    if (typeof value !== "object" || value === null) throw new Error("Expected a publication");
    const input = value as Record<string, unknown>;
    if (Object.keys(input).some(key => !["level", "assets", "testFrom"].includes(key))) throw new Error("Unexpected publication field");
    const level = parseLevelDefinition(input.level);
    if (typeof input.assets !== "object" || input.assets === null || Array.isArray(input.assets)) throw new Error("Expected GLB assets");
    const assets = new Map<string, Buffer>();
    for (const [id, encoded] of Object.entries(input.assets)) {
        if (typeof encoded !== "string" || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) throw new Error(`Invalid asset encoding: ${id}`);
        const bytes = Buffer.from(encoded, "base64");
        if (id !== `blender-${digest(bytes)}`) throw new Error(`Asset content hash mismatch: ${id}`);
        if (bytes.length < 20 || bytes.readUInt32LE(8) !== bytes.length) throw new Error(`Invalid GLB length: ${id}`);
        const { json, bin } = parseGlb(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
        if (json.buffers?.length !== 1 || json.buffers[0]?.uri || json.images?.some(image => image.uri || image.bufferView === undefined)) throw new Error("Blender GLBs must embed all buffers and images");
        if (json.asset?.version !== "2.0" || !bin || bin.byteLength < json.buffers[0]!.byteLength || bin.byteLength - json.buffers[0]!.byteLength > 3 || !json.meshes?.length || json.animations?.length || json.skins?.length || json.extensions?.KHR_lights_punctual || json.meshes.some(mesh => mesh.primitives.some(primitive => primitive.targets?.length))) throw new Error("Expected static GLB geometry without animation, skins, or lights");
        const readAsset = (async () => new Response(bytes)) as unknown as typeof fetch;
        const scene = await loadGltf("http://localhost/blender-asset.glb", readAsset);
        if (!scene.instances.length || scene.animations.length || scene.skins.length || scene.lights.length || scene.unsupported.length || scene.meshes.some(mesh => [...mesh.vertices].some(value => !Number.isFinite(value)))) throw new Error(`Unsupported or invalid static GLB geometry: ${id}`);
        assets.set(id, bytes);
    }
    const used = new Set(level.objects.flatMap(object => object.visual.kind === "gltf" ? [object.visual.asset] : []));
    for (const item of level.scenery ?? []) used.add(item.asset);
    for (const asset of used) if (!assets.has(asset)) throw new Error(`Publication is missing asset ${asset}`);
    for (const asset of assets.keys()) if (!used.has(asset)) throw new Error(`Unreferenced asset ${asset}`);
    if (input.testFrom !== undefined && (typeof input.testFrom !== "string" || !level.objects.some(object => object.id === input.testFrom && object.collision.kind !== "trigger-box"))) throw new Error("Test platform must name a ground or platform object");
    const revision = digest(JSON.stringify([level, input.testFrom ?? null]));
    return { revision: { level, revision, ...(typeof input.testFrom === "string" ? { testFrom: input.testFrom } : {}) }, assets };
}

async function body(request: IncomingMessage): Promise<unknown> {
    const chunks: Buffer[] = [];
    let length = 0;
    for await (const chunk of request) {
        const bytes = Buffer.from(chunk);
        length += bytes.length;
        if (length > MAX_BYTES) throw new Error("Publication exceeds 96 MB");
        chunks.push(bytes);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
function reply(response: ServerResponse, status: number, value: unknown): void {
    response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
    response.end(JSON.stringify(value));
}
async function atomicWrite(path: string, data: string | Buffer): Promise<void> {
    const temporary = `${path}.${randomUUID()}.tmp`;
    try { await writeFile(temporary, data, { flag: "wx" }); await rename(temporary, path); }
    finally { await unlink(temporary).catch(() => {}); }
}

export function blenderBridge(): Plugin {
    let latest: PlaytestRevision | null = null;
    const generatedFiles = new Set<string>();
    let queue = Promise.resolve();
    return {
        name: "fpp2-blender",
        apply: "serve",
        handleHotUpdate(context) {
            if (generatedFiles.has(context.file) || /\/models\/blender-[a-f0-9]+\.glb/.test(context.file)) return [];
        },
        configureServer(server) {
            const levels = resolve(server.config.root, "public/levels");
            const models = resolve(server.config.root, "public/models");
            server.middlewares.use((request, response, next) => {
                const path = new URL(request.url ?? "/", "http://localhost").pathname;
                const model = /^\/models\/(blender-[a-f0-9]{64})\.glb$/.exec(path);
                if (model && request.method === "GET") {
                    void readFile(resolve(models, `${model[1]}.glb`)).then(bytes => {
                        response.writeHead(200, { "content-type": "model/gltf-binary", "cache-control": "public, max-age=31536000, immutable" });
                        response.end(bytes);
                    }, () => reply(response, 404, { error: "Blender asset is missing" }));
                    return;
                }
                if (path === "/__blender/latest" && request.method === "GET") { reply(response, 200, latest); return; }
                if (path !== "/__blender/publish" || request.method !== "POST") { next(); return; }
                if (request.headers.origin) { reply(response, 403, { error: "Use the local Blender publisher" }); return; }
                const operation = async () => {
                    try {
                        const publication = await parsePublication(await body(request));
                        await mkdir(levels, { recursive: true });
                        await mkdir(models, { recursive: true });
                        for (const [id, bytes] of publication.assets) {
                            const target = resolve(models, `${id}.glb`);
                            generatedFiles.add(target);
                            try {
                                const existing = await readFile(target);
                                if (digest(existing) === digest(bytes)) continue;
                            } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
                            await atomicWrite(target, bytes);
                        }
                        const target = resolve(levels, `${publication.revision.level.id}.json`);
                        generatedFiles.add(target);
                        // The manifest commits last, so a client can never observe a partial asset revision.
                        await atomicWrite(target, JSON.stringify(publication.revision.level, null, 2) + "\n");
                        latest = publication.revision;
                        server.ws.send({ type: "custom", event: "fpp2:blender", data: latest });
                        reply(response, 200, { id: latest.level.id, revision: latest.revision });
                    } catch (error) { reply(response, 400, { error: error instanceof Error ? error.message : String(error) }); }
                };
                queue = queue.then(operation, operation);
            });
        },
    };
}
