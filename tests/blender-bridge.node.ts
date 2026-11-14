import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import type { ViteDevServer } from "vite";
import { blenderBridge } from "../tools/blender/server";

function sha256(bytes: Uint8Array): string {
    return createHash("sha256").update(bytes).digest("hex");
}

type TestGlbJson = {
    asset: { generator?: string };
    extensionsUsed?: string[];
    meshes: { primitives: { attributes: Record<string, number> }[] }[];
    accessors: { bufferView?: number }[];
};

function rewriteGlb(glb: Uint8Array, update: (json: TestGlbJson) => void): Buffer {
    const source = Buffer.from(glb);
    const jsonLength = source.readUInt32LE(12);
    const json = JSON.parse(source.subarray(20, 20 + jsonLength).toString("utf8")) as TestGlbJson;
    update(json);
    const jsonBytes = Buffer.from(JSON.stringify(json));
    const paddedJson = Buffer.concat([jsonBytes, Buffer.alloc((4 - (jsonBytes.length % 4)) % 4, 0x20)]);
    const oldJsonEnd = 20 + jsonLength;
    const binHeader = source.subarray(oldJsonEnd, oldJsonEnd + 8);
    const bin = source.subarray(oldJsonEnd + 8);
    const result = Buffer.alloc(12 + 8 + paddedJson.length + binHeader.length + bin.length);
    result.writeUInt32LE(0x46546c67, 0);
    result.writeUInt32LE(2, 4);
    result.writeUInt32LE(result.length, 8);
    result.writeUInt32LE(paddedJson.length, 12);
    result.writeUInt32LE(0x4e4f534a, 16);
    paddedJson.copy(result, 20);
    binHeader.copy(result, 20 + paddedJson.length);
    bin.copy(result, 28 + paddedJson.length);
    result.writeUInt32LE(bin.length, 20 + paddedJson.length);
    return result;
}

function withGenerator(glb: Uint8Array, generator: string): Buffer {
    return rewriteGlb(glb, json => { json.asset.generator = generator; });
}

function level(asset: string) {
    const transform = { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] } as const;
    const surface = (id: string, role: "ground" | "platform") => ({
        id, role, transform, visual: { kind: "gltf", asset }, collision: { kind: "box", dimensions: [1, 1, 1] },
    });
    const trigger = (id: string, role: "goal" | "checkpoint") => ({
        id, role, transform, visual: { kind: "gltf", asset }, collision: { kind: "trigger-box", dimensions: [1, 1, 1] },
    });
    return {
        id: "blender-bridge-check",
        spawnPosition: [0, 2, 0],
        failureBoundaryY: -8,
        objects: [surface("ground", "ground"), surface("platform", "platform"), trigger("goal", "goal"), trigger("checkpoint", "checkpoint")],
        scenery: [{ id: "tree", asset, transform }],
    };
}

async function startBridge(root: string) {
    let middleware:
        | ((request: IncomingMessage, response: ServerResponse, next: (error?: Error) => void) => void)
        | undefined;
    const events: unknown[] = [];
    const plugin = blenderBridge();
    const configureServer = plugin.configureServer;
    if (!configureServer) throw new Error("Blender bridge is not configured");
    const configure = typeof configureServer === "function" ? configureServer : configureServer.handler;
    configure.call({}, {
        config: { root },
        middlewares: { use: (handler: typeof middleware) => (middleware = handler) },
        ws: { send: (event: unknown) => events.push(event) },
    } as unknown as ViteDevServer);
    if (!middleware) throw new Error("Blender publication route was not registered");
    const server = createHttpServer((request, response) => middleware!(request, response, () => {
        response.statusCode = 404;
        response.end();
    }));
    await new Promise<void>(resolveListen => server.listen(0, "127.0.0.1", resolveListen));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("The Blender bridge has no address");
    return {
        baseUrl: `http://127.0.0.1:${address.port}`,
        events,
        close: () => new Promise<void>((resolveClose, rejectClose) => server.close(error => error ? rejectClose(error) : resolveClose())),
    };
}

async function publish(baseUrl: string, document: unknown): Promise<Response> {
    return fetch(`${baseUrl}/__blender/publish`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(document),
    });
}

test("Blender bridge publishes all GLB roles and scenery before committing the level", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "fpp2-blender-bridge-"));
    const source = new Uint8Array(await readFile(new URL("../public/models/sample-platform.glb", import.meta.url)));
    const bytes = withGenerator(source, "bridge-check-one");
    const asset = `blender-${sha256(bytes)}`;
    const bridge = await startBridge(root);
    try {
        const publication = { level: level(asset), assets: { [asset]: Buffer.from(bytes).toString("base64") }, testFrom: "platform" };
        const response = await publish(bridge.baseUrl, publication);
        expect(response.status).toBe(200);
        const result = await response.json() as { id: string; revision: string };
        expect(result.id).toBe("blender-bridge-check");
        expect(result.revision).toMatch(/^[a-f0-9]{64}$/);

        const manifestBytes = await readFile(resolve(root, "public/levels/blender-bridge-check.json"));
        const manifest = JSON.parse(manifestBytes.toString("utf8"));
        expect(manifest).toEqual(publication.level);
        const storedAsset = await readFile(resolve(root, "public/models", `${asset}.glb`));
        expect(storedAsset).toEqual(bytes);
        expect(sha256(storedAsset)).toBe(asset.slice("blender-".length));
        const assetResponse = await fetch(`${bridge.baseUrl}/models/${asset}.glb`);
        expect(assetResponse.status).toBe(200);
        expect(assetResponse.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
        expect(new Uint8Array(await assetResponse.arrayBuffer())).toEqual(bytes);

        const latest = await (await fetch(`${bridge.baseUrl}/__blender/latest`)).json() as { revision: string; level: unknown; testFrom: string };
        expect(latest).toEqual({ revision: result.revision, level: publication.level, testFrom: "platform" });
        expect(bridge.events).toHaveLength(1);
        expect(bridge.events[0]).toEqual({ type: "custom", event: "fpp2:blender", data: latest });
    } finally {
        await bridge.close();
        await rm(root, { recursive: true, force: true });
    }
});

test("Blender bridge publishes immutable asset versions and rejects invalid revisions without overwriting", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "fpp2-blender-bridge-"));
    const source = new Uint8Array(await readFile(new URL("../public/models/sample-platform.glb", import.meta.url)));
    const firstBytes = withGenerator(source, "bridge-check-one");
    const firstAsset = `blender-${sha256(firstBytes)}`;
    const bridge = await startBridge(root);
    try {
        const firstLevel = level(firstAsset);
        const firstResponse = await publish(bridge.baseUrl, { level: firstLevel, assets: { [firstAsset]: Buffer.from(firstBytes).toString("base64") } });
        expect(firstResponse.status).toBe(200);
        const firstResult = await firstResponse.json() as { revision: string };
        const firstManifest = await readFile(resolve(root, "public/levels/blender-bridge-check.json"));

        const secondBytes = withGenerator(source, "bridge-check-two");
        const secondAsset = `blender-${sha256(secondBytes)}`;
        const secondLevel = level(secondAsset);
        const secondResponse = await publish(bridge.baseUrl, { level: secondLevel, assets: { [secondAsset]: Buffer.from(secondBytes).toString("base64") } });
        expect(secondResponse.status).toBe(200);
        const secondResult = await secondResponse.json() as { revision: string };
        expect(secondResult.revision).not.toBe(firstResult.revision);
        expect(await readFile(resolve(root, "public/models", `${firstAsset}.glb`))).toEqual(firstBytes);
        expect(await readFile(resolve(root, "public/models", `${secondAsset}.glb`))).toEqual(secondBytes);
        const secondManifest = await readFile(resolve(root, "public/levels/blender-bridge-check.json"));
        expect(JSON.parse(secondManifest.toString("utf8"))).toEqual(secondLevel);

        const invalid = await publish(bridge.baseUrl, {
            level: level(secondAsset),
            assets: { [secondAsset]: Buffer.from(secondBytes).toString("base64") },
            testFrom: "goal",
        });
        expect(invalid.status).toBe(400);
        expect((await invalid.json() as { error: string }).error).toContain("Test platform");
        expect(await readFile(resolve(root, "public/levels/blender-bridge-check.json"))).toEqual(secondManifest);
        expect(await readFile(resolve(root, "public/models", `${secondAsset}.glb`))).toEqual(secondBytes);
        expect((await (await fetch(`${bridge.baseUrl}/__blender/latest`)).json() as { revision: string }).revision).toBe(secondResult.revision);
        expect(bridge.events).toHaveLength(2);

        const denied = await fetch(`${bridge.baseUrl}/__blender/publish`, {
            method: "POST", headers: { origin: "http://localhost", "content-type": "application/json" }, body: "{}",
        });
        expect(denied.status).toBe(403);
        expect(await readFile(resolve(root, "public/levels/blender-bridge-check.json"))).toEqual(secondManifest);
        expect(firstManifest.equals(secondManifest)).toBe(false);
    } finally {
        await bridge.close();
        await rm(root, { recursive: true, force: true });
    }
});

test("concurrent Blender publications leave a manifest whose versioned assets are complete", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "fpp2-blender-bridge-"));
    const source = new Uint8Array(await readFile(new URL("../public/models/sample-platform.glb", import.meta.url)));
    const firstBytes = withGenerator(source, "concurrent-one");
    const secondBytes = withGenerator(source, "concurrent-two");
    const firstAsset = `blender-${sha256(firstBytes)}`;
    const secondAsset = `blender-${sha256(secondBytes)}`;
    const bridge = await startBridge(root);
    try {
        const responses = await Promise.all([
            publish(bridge.baseUrl, { level: level(firstAsset), assets: { [firstAsset]: Buffer.from(firstBytes).toString("base64") } }),
            publish(bridge.baseUrl, { level: level(secondAsset), assets: { [secondAsset]: Buffer.from(secondBytes).toString("base64") } }),
        ]);
        expect(responses.map(response => response.status)).toEqual([200, 200]);
        const results = await Promise.all(responses.map(response => response.json() as Promise<{ revision: string }>));
        const latest = await (await fetch(`${bridge.baseUrl}/__blender/latest`)).json() as { revision: string; level: ReturnType<typeof level> };
        expect(results.map(result => result.revision)).toContain(latest.revision);
        const committedLevel = JSON.parse(await readFile(resolve(root, "public/levels/blender-bridge-check.json"), "utf8"));
        expect(committedLevel).toEqual(latest.level);
        const selectedAsset = latest.level.objects[1]!.visual.kind === "gltf" ? latest.level.objects[1]!.visual.asset : "";
        expect([firstAsset, secondAsset]).toContain(selectedAsset);
        expect(await readFile(resolve(root, "public/models", `${firstAsset}.glb`))).toEqual(firstBytes);
        expect(await readFile(resolve(root, "public/models", `${secondAsset}.glb`))).toEqual(secondBytes);
        expect(bridge.events).toHaveLength(2);
    } finally {
        await bridge.close();
        await rm(root, { recursive: true, force: true });
    }
});


test("unsupported and corrupt GLBs are rejected before changing the committed revision", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "fpp2-blender-bridge-"));
    const source = new Uint8Array(await readFile(new URL("../public/models/sample-platform.glb", import.meta.url)));
    const validBytes = withGenerator(source, "validation-baseline");
    const validAsset = `blender-${sha256(validBytes)}`;
    const bridge = await startBridge(root);
    try {
        const first = await publish(bridge.baseUrl, { level: level(validAsset), assets: { [validAsset]: Buffer.from(validBytes).toString("base64") } });
        expect(first.status).toBe(200);
        const firstResult = await first.json() as { revision: string };
        const manifestPath = resolve(root, "public/levels/blender-bridge-check.json");
        const modelDirectory = resolve(root, "public/models");
        const manifestBefore = await readFile(manifestPath);

        const unsupportedBytes = rewriteGlb(source, json => {
            json.extensionsUsed = [...(json.extensionsUsed ?? []), "EXT_unhandled_fixture"];
        });
        const unsupportedAsset = `blender-${sha256(unsupportedBytes)}`;
        const unsupported = await publish(bridge.baseUrl, {
            level: level(unsupportedAsset),
            assets: { [unsupportedAsset]: Buffer.from(unsupportedBytes).toString("base64") },
        });
        expect(unsupported.status).toBe(400);
        expect((await unsupported.json() as { error: string }).error).toContain("Unsupported");
        expect(await readFile(manifestPath)).toEqual(manifestBefore);
        expect(await readFile(resolve(modelDirectory, `${unsupportedAsset}.glb`)).then(() => true, () => false)).toBe(false);

        const corruptBytes = rewriteGlb(source, json => {
            const position = json.meshes[0]!.primitives[0]!.attributes.POSITION!;
            json.accessors[position]!.bufferView = 100000;
        });
        const corruptAsset = `blender-${sha256(corruptBytes)}`;
        const corrupt = await publish(bridge.baseUrl, {
            level: level(corruptAsset),
            assets: { [corruptAsset]: Buffer.from(corruptBytes).toString("base64") },
        });
        expect(corrupt.status).toBe(400);
        expect(await readFile(manifestPath)).toEqual(manifestBefore);
        expect(await readFile(resolve(modelDirectory, `${corruptAsset}.glb`)).then(() => true, () => false)).toBe(false);
        expect((await (await fetch(`${bridge.baseUrl}/__blender/latest`)).json() as { revision: string }).revision).toBe(firstResult.revision);
        expect(bridge.events).toHaveLength(1);
    } finally {
        await bridge.close();
        await rm(root, { recursive: true, force: true });
    }
});
