import { activeLevel, runtime } from "./game/state";
import { loadGltf } from "@dylanebert/shallot/gltf";
import type { ViteHotContext } from "vite/types/hot.d.ts";
import { runApp, type App } from "@dylanebert/shallot";
import { Game } from "./game";
import { parseLevelDefinition } from "./content/level";
import { playtestRevision, type PlaytestRevision } from "./game/playtest";

let app: App | undefined;
let current: PlaytestRevision | undefined;
let pending: PlaytestRevision | undefined;
let rebuilding = false;
const status = document.createElement("output");
status.setAttribute("aria-live", "polite");
status.style.cssText = "position:fixed;bottom:44px;left:10px;background:#222;color:#fff;font:13px system-ui;padding:6px;z-index:50";
status.hidden = true;
document.body.append(status);

async function start(revision?: PlaytestRevision): Promise<App> {
    return runApp({ plugins: [Game], setup(world) { world.resource(playtestRevision).current = revision; } });
}

async function rebuild(): Promise<void> {
    if (rebuilding) return;
    rebuilding = true;
    try {
        while (pending) {
            const next = pending;
            pending = undefined;
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
                // glTF images and kernel registrations belong to a World, so dispose the complete revision.
                app?.dispose();
                app = undefined;
                disposed = true;
                app = await start(next);
                current = next;
                status.textContent = `Blender: ${next.level.id} loaded`;
                const url = new URL(location.href);
                url.searchParams.set("level", next.level.id);
                history.replaceState(null, "", url);
            } catch (error) {
                status.textContent = `Blender update failed: ${error instanceof Error ? error.message : String(error)}`;
                if (disposed) app = await start(current);
            }
        }
    } finally { rebuilding = false; }
}

function receive(value: PlaytestRevision): void {
    try {
        const level = parseLevelDefinition(value.level);
        if (typeof value.revision !== "string") throw new Error("Missing revision");
        pending = { ...value, level };
        void rebuild().catch(error => { status.hidden = false; status.textContent = String(error); });
    } catch (error) { status.hidden = false; status.textContent = String(error); }
}

const hot = import.meta.hot as unknown as ViteHotContext | undefined;
if (hot) hot.on("fpp2:blender", receive);
rebuilding = true;
app = await start();
current = { level: activeLevel(app.world.resource(runtime)), revision: "initial" };
rebuilding = false;
if (pending) void rebuild();
if (hot) {
    hot.dispose(() => { app?.dispose(); status.remove(); });
    const syncLatest = async () => {
        const latest = await fetch("/__blender/latest").then(response => response.json()).catch(() => null);
        if (latest && latest.revision !== current?.revision && latest.revision !== pending?.revision) receive(latest);
    };
    hot.on("vite:ws:connect", () => void syncLatest());
    await syncLatest();
}
