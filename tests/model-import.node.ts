import { expect, test } from "bun:test";
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import type { ViteDevServer } from "vite";
import { projectLevels } from "../vite.config";

test("development model import stores a reusable GLB asset", async () => {
    const root = process.cwd();
    let middleware:
        | ((request: IncomingMessage, response: ServerResponse, next: (error?: Error) => void) => void)
        | undefined;
    const plugin = projectLevels();
    const configureServer = plugin.configureServer;
    if (!configureServer) throw new Error("Project model routes are not configured");
    const configure = typeof configureServer === "function" ? configureServer : configureServer.handler;
    configure.call(
        {},
        {
            config: { root },
            middlewares: { use: (handler: typeof middleware) => (middleware = handler) },
        } as unknown as ViteDevServer,
    );
    if (!middleware) throw new Error("Project model routes were not registered");
    const server = createHttpServer((request, response) =>
        middleware!(request, response, () => {
            response.statusCode = 404;
            response.end();
        }),
    );
    let importedPath: string | undefined;
    try {
        await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
        const address = server.address();
        if (!address || typeof address === "string") throw new Error("The model import server has no address");
        const baseUrl = `http://127.0.0.1:${address.port}`;

        const catalogResponse = await fetch(`${baseUrl}/__editor/models`);
        expect(catalogResponse.status).toBe(200);
        const catalog: unknown = await catalogResponse.json();
        if (!Array.isArray(catalog)) throw new Error("The project model list is invalid");
        expect(catalog).toContain("sample-platform");
        const duckPath = resolve(root, "public", "models", "Duck.glb");
        if (await readFile(duckPath).then(() => true, () => false)) expect(catalog).toContain("Duck");

        const invalid = await fetch(`${baseUrl}/__editor/models`, {
            method: "POST",
            headers: { "content-type": "application/octet-stream" },
            body: new Uint8Array([1, 2, 3]),
        });
        expect(invalid.status).toBe(400);
        expect((await invalid.json()).error).toBe("Expected a valid glTF 2.0 binary file");

        const source = new URL("../public/models/sample-platform.glb", import.meta.url);
        const bytes = await readFile(source);
        const response = await fetch(`${baseUrl}/__editor/models`, {
            method: "POST",
            headers: { "content-type": "application/octet-stream" },
            body: bytes,
        });
        const result: unknown = await response.json();
        expect(response.status).toBe(201);
        if (typeof result !== "object" || result === null || !("asset" in result))
            throw new Error("The model import response is invalid");
        const asset = result.asset;
        if (typeof asset !== "string") throw new Error("The imported asset ID is invalid");
        importedPath = resolve(root, "public", "models", `${asset}.glb`);

        expect(asset).toMatch(/^model-[a-f0-9-]+$/);
        expect(await readFile(importedPath)).toEqual(bytes);
        const updatedCatalog: unknown = await (await fetch(`${baseUrl}/__editor/models`)).json();
        if (!Array.isArray(updatedCatalog)) throw new Error("The updated project model list is invalid");
        expect(updatedCatalog).toContain(asset);
    } finally {
        if (importedPath) await unlink(importedPath).catch(() => {});
        await new Promise<void>((resolveClose, rejectClose) =>
            server.close((error) => error ? rejectClose(error) : resolveClose()),
        );
    }
});
