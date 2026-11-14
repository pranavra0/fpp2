import { activeLevel, runtime } from "./game/state";
import { loadGltf } from "@dylanebert/shallot/gltf";
import type { ViteHotContext } from "vite/types/hot.d.ts";
import { runApp, StandardRenderingPlugin, type App } from "@dylanebert/shallot";
import { Game } from "./game";
import { parseLevelDefinition } from "./content/level";
import { playtestRevision, type PlaytestRevision } from "./game/playtest";

let app: App | undefined;
let gpuInstance: GPU | undefined;
let sharedAdapter: GPUAdapter | undefined;
let sharedDevice: GPUDevice | undefined;
let current: PlaytestRevision | undefined;
let pending: PlaytestRevision | undefined;
let applyingRevision: string | undefined;
let rebuilding = false;
let moduleDisposed = false;
const status = document.createElement("output");
status.setAttribute("aria-live", "polite");
status.style.cssText = "position:fixed;bottom:44px;left:10px;background:#222;color:#fff;font:13px system-ui;padding:6px;z-index:50";
status.hidden = true;
document.body.append(status);

async function start(revision?: PlaytestRevision): Promise<App> {
    if (!sharedDevice) {
        // Retain the native adapter and device so disposing a world cannot invalidate later revisions.
        gpuInstance = navigator.gpu;
        if (!gpuInstance) throw new Error("WebGPU is unavailable");
        const adapter = await gpuInstance.requestAdapter();
        if (!adapter) throw new Error("No WebGPU adapter is available");
        sharedAdapter = adapter;
        sharedDevice = await adapter.requestDevice({ requiredFeatures: [...(StandardRenderingPlugin.gpu?.features ?? [])] });
    }
    return runApp({
        plugins: [Game],
        device: sharedDevice,
        adapter: sharedAdapter,
        setup(world) { world.resource(playtestRevision).current = revision; },
    });
}

async function rebuild(): Promise<void> {
    if (rebuilding) return;
    rebuilding = true;
    try {
        while (pending) {
            const next = pending;
            pending = undefined;
            applyingRevision = next.revision;
            status.hidden = false;
            status.textContent = `Loading Blender level ${next.level.id}`;
            let disposed = false;
            try {
                const assets = new Set(next.level.objects.flatMap(object => object.visual.kind === "gltf" ? [object.visual.asset] : []));
                for (const item of next.level.scenery ?? []) assets.add(item.asset);
                await Promise.all([...assets].map(async asset => {
                    const scene = await loadGltf(new URL(`/models/${asset}.glb`, location.href));
                    if (!scene.instances.length || scene.animations.length || scene.skins.length || scene.lights.length || scene.unsupported.length) throw new Error(`Unsupported static asset: ${asset}`);
                }));
                if (moduleDisposed) return;
                if (sharedDevice) await sharedDevice.queue.onSubmittedWorkDone();
                if (moduleDisposed) return;
                // glTF images and kernel registrations belong to a World, so dispose the complete revision.
                app?.dispose();
                app = undefined;
                disposed = true;
                const replacement = await start(next);
                if (moduleDisposed) {
                    replacement.dispose();
                    return;
                }
                app = replacement;
                current = next;
                status.textContent = `Blender: ${next.level.id} loaded`;
                const url = new URL(location.href);
                url.searchParams.set("level", next.level.id);
                history.replaceState(null, "", url);
            } catch (error) {
                if (moduleDisposed) return;
                status.textContent = `Blender update failed: ${error instanceof Error ? error.message : String(error)}`;
                if (disposed) {
                    try {
                        const restored = await start(current);
                        if (moduleDisposed) {
                            restored.dispose();
                            return;
                        }
                        app = restored;
                    } catch (restoreError) {
                        if (moduleDisposed) return;
                        status.textContent += `; previous revision restore failed: ${restoreError instanceof Error ? restoreError.message : String(restoreError)}`;
                    }
                }
            } finally {
                if (applyingRevision === next.revision) applyingRevision = undefined;
            }
        }
    } finally { rebuilding = false; }
}

function receive(value: PlaytestRevision): void {
    if (moduleDisposed) return;
    try {
        const level = parseLevelDefinition(value.level);
        if (typeof value.revision !== "string" || !/^[a-f0-9]{64}$/.test(value.revision)) throw new Error("Invalid revision");
        if (value.revision === current?.revision || value.revision === pending?.revision || value.revision === applyingRevision) return;
        pending = { ...value, level };
        void rebuild().catch(error => { status.hidden = false; status.textContent = String(error); });
    } catch (error) { status.hidden = false; status.textContent = String(error); }
}

const hot = import.meta.hot as unknown as ViteHotContext | undefined;
if (hot) {
    hot.on("fpp2:blender", receive);
    hot.dispose(() => {
        moduleDisposed = true;
        pending = undefined;
        applyingRevision = undefined;
        app?.dispose();
        app = undefined;
        sharedDevice?.destroy();
        sharedDevice = undefined;
        sharedAdapter = undefined;
        gpuInstance = undefined;
        status.remove();
    });
}
const syncLatest = async () => {
    const latest = await fetch("/__blender/latest").then(response => response.json()).catch(() => null);
    if (!moduleDisposed && latest && latest.revision !== current?.revision && latest.revision !== pending?.revision) receive(latest);
};
if (hot) hot.on("vite:ws:connect", () => void syncLatest());
rebuilding = true;
let initialApp: App;
try {
    initialApp = await start();
} catch (error) {
    sharedDevice?.destroy();
    sharedDevice = undefined;
    status.hidden = false;
    status.textContent = `Game startup failed: ${error instanceof Error ? error.message : String(error)}`;
    throw error;
}
if (moduleDisposed) {
    initialApp.dispose();
    initialApp.world.gpuIfAvailable?.device.destroy();
} else {
    app = initialApp;
    current = { level: activeLevel(initialApp.world.resource(runtime)), revision: "initial" };
}
rebuilding = false;
if (pending) void rebuild();
if (hot) await syncLatest();
