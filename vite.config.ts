import { randomUUID } from "node:crypto";
import { lstat, link, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { shallot } from "@dylanebert/shallot/vite";
import type { Plugin } from "vite";
import { parseLevelDefinition } from "./src/content/level.ts";

const MAX_LEVEL_BYTES = 256 * 1024;

function projectLevels(): Plugin {
    return {
        name: "fpp2-project-levels",
        apply: "serve",
        configureServer(server) {
            const levelDirectory = resolve(server.config.root, "public", "levels");
            server.middlewares.use(async (request, response, next) => {
                const url = new URL(request.url ?? "/", "http://localhost");
                if (url.pathname === "/__editor/levels" && request.method === "GET") {
                    try {
                        const files = await readdir(levelDirectory, { withFileTypes: true });
                        const ids = files
                            .filter((entry) => entry.isFile() && /^[a-z0-9][a-z0-9-]*\.json$/.test(entry.name))
                            .map((entry) => entry.name.slice(0, -5))
                            .sort();
                        sendJson(response, 200, ids);
                    } catch (error) {
                        sendJson(response, 500, { error: errorMessage(error) });
                    }
                    return;
                }

                const match = /^\/__editor\/levels\/([^/]+)$/.exec(url.pathname);
                if (!match || request.method !== "PUT") {
                    next();
                    return;
                }
                let id: string;
                try {
                    id = decodeURIComponent(match[1]!);
                } catch {
                    sendJson(response, 400, { error: "Invalid level id" });
                    return;
                }
                if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) {
                    sendJson(response, 400, { error: "Invalid level id" });
                    return;
                }
                if (!request.headers["content-type"]?.includes("application/json")) {
                    sendJson(response, 415, { error: "Expected application/json" });
                    return;
                }

                try {
                    const body = await readBody(request);
                    const level = parseLevelDefinition(JSON.parse(body));
                    if (level.id !== id) {
                        sendJson(response, 400, { error: `Level id must match the target file "${id}"` });
                        return;
                    }
                    const target = resolve(levelDirectory, `${id}.json`);
                    if (resolve(target, "..") !== levelDirectory) {
                        sendJson(response, 400, { error: "Invalid level path" });
                        return;
                    }
                    const operation = request.headers["x-level-operation"];
                    let exists = false;
                    try {
                        const file = await lstat(target);
                        if (!file.isFile()) {
                            sendJson(response, 400, { error: "Level target must be a regular file" });
                            return;
                        }
                        exists = true;
                    } catch (error) {
                        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
                    }
                    if (operation === "create" && exists) {
                        sendJson(response, 409, { error: `Level "${id}" already exists` });
                        return;
                    }
                    if (operation === "overwrite" && !exists) {
                        sendJson(response, 404, { error: `Level "${id}" does not exist` });
                        return;
                    }
                    if (operation !== "create" && operation !== "overwrite") {
                        sendJson(response, 400, { error: "A create or overwrite action is required" });
                        return;
                    }

                    const temporary = resolve(levelDirectory, `.${id}.${randomUUID()}.tmp`);
                    await writeFile(temporary, `${JSON.stringify(level, null, 2)}\n`, { flag: "wx" });
                    try {
                        if (operation === "create") {
                            await link(temporary, target);
                            await unlink(temporary);
                        } else await rename(temporary, target);
                    } catch (error) {
                        await unlink(temporary).catch(() => {});
                        if ((error as NodeJS.ErrnoException).code === "EEXIST") {
                            sendJson(response, 409, { error: `Level "${id}" already exists` });
                            return;
                        }
                        throw error;
                    }
                    sendJson(response, 200, { id, path: `public/levels/${id}.json` });
                } catch (error) {
                    const status = error instanceof Error && error.name === "BodyLimitError" ? 413 : 400;
                    sendJson(response, status, { error: errorMessage(error) });
                }
            });
        },
    };
}

async function readBody(request: import("node:http").IncomingMessage): Promise<string> {
    const chunks: Buffer[] = [];
    let length = 0;
    for await (const chunk of request) {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        length += bytes.byteLength;
        if (length > MAX_LEVEL_BYTES) {
            const error = new Error("Level JSON exceeds 256 KB");
            error.name = "BodyLimitError";
            throw error;
        }
        chunks.push(bytes);
    }
    return Buffer.concat(chunks).toString("utf8");
}

function sendJson(response: import("node:http").ServerResponse, status: number, value: unknown): void {
    response.statusCode = status;
    response.setHeader("content-type", "application/json; charset=utf-8");
    response.end(JSON.stringify(value));
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export default {
    plugins: [shallot(), projectLevels()],
};
