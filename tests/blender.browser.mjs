import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const baseUrl = process.env.FPP2_BROWSER_URL ?? "http://127.0.0.1:5177";
const blender = process.env.BLENDER_BIN ?? "blender";
const playwrightPath = process.env.PLAYWRIGHT_CORE_MODULE;
const chromiumArgs = process.env.CHROMIUM_ARGS ? JSON.parse(process.env.CHROMIUM_ARGS) : [];
if (!playwrightPath) throw new Error("Set PLAYWRIGHT_CORE_MODULE to a playwright-core module path");
const { chromium } = await import(pathToFileURL(resolve(playwrightPath)).href);

function run(command, args, env, timeout = 120_000) {
    return new Promise((resolveRun, rejectRun) => {
        const child = spawn(command, args, { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
        let output = "";
        const append = (chunk) => { output = `${output}${chunk}`.slice(-12_000); };
        child.stdout.on("data", append);
        child.stderr.on("data", append);
        const timer = setTimeout(() => {
            child.kill("SIGKILL");
            rejectRun(new Error(`${command} timed out\n${output}`));
        }, timeout);
        child.once("error", (error) => { clearTimeout(timer); rejectRun(error); });
        child.once("close", (code) => {
            clearTimeout(timer);
            if (code === 0) resolveRun(output);
            else rejectRun(new Error(`${command} exited with ${code}\n${output}`));
        });
    });
}

async function latest() {
    const response = await fetch(`${baseUrl}/__blender/latest`);
    if (!response.ok) throw new Error(`Could not read Blender bridge latest revision (${response.status})`);
    return response.json();
}

async function waitForRevision(page, revision, afterEvent, timeout = 45_000) {
    const deadline = Date.now() + timeout;
    let pageStatus = "";
    while (Date.now() < deadline) {
        pageStatus = await page.locator("output").textContent().catch(() => "");
        if (pageStatus?.startsWith("Blender update failed:")) throw new Error(pageStatus);
        const cycle = await page.evaluate(({ afterEvent }) => {
            const events = window.__blenderStatusEvents.slice(afterEvent);
            const loading = events.findIndex((value) => value === "Loading Blender level blender-check");
            return loading >= 0 && events.slice(loading + 1).includes("Blender: blender-check loaded");
        }, { afterEvent });
        if (cycle && (await latest())?.revision === revision) return;
        await page.waitForTimeout(200);
    }
    throw new Error(`Revision ${revision} did not load; browser status: ${pageStatus}`);
}

async function captureGameFrame(page, name, requirePlatform = false) {
    const modules = {
        rendering: "/node_modules/@dylanebert/shallot/src/core/rendering/index.ts",
        progress: "/src/game/gameplay-state.ts",
        playtest: "/src/game/playtest.ts",
        state: "/src/game/state.ts",
        physics: "/src/game/physics.ts",
        motion: "/src/platforms.ts",
    };
    let capture;
    let lastError;
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            capture = await page.evaluate(async ({ modules, requirePlatform }) => {
                const app = window.__fpp2BrowserApp;
                if (!app) throw new Error("The game app is not available");
                const rendering = await import(modules.rendering);
                const cameras = [...app.world.query([rendering.Camera])];
                const camera = cameras[0];
                if (camera === undefined) throw new Error("The game world has no camera");
                const frame = await Promise.race([
                    (async () => {
                        app.world.step(0);
                        return rendering.captureTexture(app.world, camera);
                    })(),
                    new Promise((_, reject) => setTimeout(() => reject(new Error("Timed out waiting for the camera texture")), 8000)),
                ]);
                const pixels = frame.rgba;
                const mean = [0, 1, 2].map((channel) => Math.round(pixels.reduce((sum, value, index) => sum + (index % 4 === channel ? value : 0), 0) / (frame.width * frame.height)));
                const digest = await crypto.subtle.digest("SHA-256", pixels);
                const preview = document.createElement("canvas");
                preview.width = frame.width;
                preview.height = frame.height;
                preview.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(pixels), frame.width, frame.height), 0, 0);
                const progress = await import(modules.progress);
                const playtest = await import(modules.playtest);
                const state = await import(modules.state);
                const physics = await import(modules.physics);
                const motion = await import(modules.motion);
                const game = app.world.resource(state.runtime);
                const moving = game.levelEntities.find((object) => object.id === "moving-platform");
                if (requirePlatform && (!moving || !moving.object.motion || moving.object.collision.kind === "trigger-box"))
                    throw new Error("Moving platform is missing motion or solid collision data");
                const expectedRespawnPosition = moving?.object.motion && moving.object.collision.kind !== "trigger-box"
                    ? (() => {
                        const offset = motion.motionOffset(motion.compileMotion(moving.object.motion), 0);
                        return [
                            moving.object.transform.position[0] + offset.x,
                            moving.object.transform.position[1] + offset.y + moving.object.transform.scale[1] * moving.object.collision.dimensions[1] / 2 + 1.6,
                            moving.object.transform.position[2] + offset.z,
                        ];
                    })()
                    : null;
                return {
                    camera,
                    revision: app.world.resource(playtest.playtestRevision).current?.revision,
                    respawnPosition: app.world.resource(progress.gameplayProgress).respawnPosition,
                    expectedRespawnPosition,
                    collisionWidth: moving?.collisionEid === undefined
                        ? null
                        : app.world.storage(physics.LandingSurface).width.get(moving.collisionEid),
                    width: frame.width,
                    height: frame.height,
                    mean,
                    hash: Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join(""),
                    png: preview.toDataURL("image/png").split(",")[1],
                };
            }, { modules, requirePlatform });
            break;
        } catch (error) {
            lastError = error;
            await page.waitForTimeout(100);
        }
    }
    if (!capture) throw new Error(`Could not capture the game camera after 24 seconds: ${lastError}`);
    const path = resolve(tmpdir(), `fpp2-blender-${name}.png`);
    await writeFile(path, Buffer.from(capture.png, "base64"));
    const { png: _, ...summary } = capture;
    return { ...summary, path };
}

const work = await mkdtemp(resolve(tmpdir(), "fpp2-blender-browser-"));
const blendPath = resolve(work, "fixture.blend");
const publicationPath = resolve(work, "publication.json");
const editPath = resolve(work, "edit-and-save.py");
const editScript = `
import importlib.util
import os
import bpy
root = ${JSON.stringify(root)}
spec = importlib.util.spec_from_file_location("fpp2_addon", os.path.join(root, "tools", "blender", "fpp2.py"))
addon = importlib.util.module_from_spec(spec)
spec.loader.exec_module(addon)
scene = bpy.context.scene
scene["fpp2_url"] = os.environ["FPP2_PUBLISH_URL"]
scene["fpp2_publish_on_save"] = True
visual = bpy.data.objects["moving visual"]
visual.scale.x *= 1.25
visual.data.materials[0].diffuse_color = (0.9, 0.15, 0.1, 1.0)
platform = bpy.data.objects["moving platform"]
platform.scale.x *= 1.25
scenery = bpy.data.objects["large tree"]
bpy.data.objects.remove(scenery, do_unlink=True)
addon.register()
bpy.ops.wm.save_as_mainfile(filepath=bpy.data.filepath)
assert scene.get("fpp2_last_status") == "Published successfully", scene.get("fpp2_last_status")
print("FPP2 second save published")
`;

let browser;
let published = false;
const assetIds = new Set();
try {
    const firstBefore = await latest();
    if (firstBefore !== null) throw new Error(`Expected a fresh bridge, found revision ${firstBefore.revision}`);

    browser = await chromium.launch({
        headless: true,
        executablePath: process.env.CHROMIUM_BIN ?? chromium.executablePath(),
        args: chromiumArgs,
    });
    const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
    if (process.env.FPP2_OFFSCREEN_CAPTURE === "1") {
        await page.addInitScript(() => { window.__FPP2_OFFSCREEN_CAPTURE = true; });
    } else {
        throw new Error("Set FPP2_OFFSCREEN_CAPTURE=1 to bind the game camera to a test-only offscreen texture");
    }
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.route("**/src/main.ts*", async (route) => {
        const response = await route.fetch();
        let source = await response.text();
        source = source.replace("app = initialApp;", "app = initialApp; window.__fpp2BrowserApp = initialApp;");
        source = source.replace("app = replacement;", "app = replacement; window.__fpp2BrowserApp = replacement;");
        if (!source.includes("window.__fpp2BrowserApp")) throw new Error("Could not instrument the app module for browser verification");
        await route.fulfill({ response, body: source });
    });
    await page.route("**/src/game/scene.ts*", async (route) => {
        const response = await route.fetch();
        let source = await response.text();
        const renderingPath = "/node_modules/@dylanebert/shallot/src/core/rendering/index.ts";
        source = `import { attachTexture as __fpp2AttachTexture } from ${JSON.stringify(renderingPath)};\n${source}`;
        source = source.replace(
            "world.add(camera, StandardRenderer);",
            "world.add(camera, StandardRenderer); if (window.__FPP2_OFFSCREEN_CAPTURE) __fpp2AttachTexture(world, camera, { width: 640, height: 480 });",
        );
        if (!source.includes("__fpp2AttachTexture(world, camera")) throw new Error("Could not bind a test-only offscreen camera target");
        await route.fulfill({ response, body: source });
    });
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await page.waitForFunction(() => Boolean(window.__fpp2BrowserApp) && document.querySelectorAll("canvas").length === 1 && document.body.innerText.includes("Automatic bounce"), { timeout: 30_000 });
    const browserSentinel = await page.evaluate(() => {
        window.__blenderBrowserSentinel = Object.freeze({ identity: crypto.randomUUID() });
        window.__blenderBaselineSentinel = window.__blenderBrowserSentinel;
        window.__blenderDocumentStart = performance.timeOrigin;
        window.__blenderCanvas = document.querySelector("canvas");
        window.__blenderStatusEvents = [];
        new MutationObserver(() => window.__blenderStatusEvents.push(document.querySelector("output")?.textContent ?? ""))
            .observe(document.querySelector("output"), { childList: true, characterData: true, subtree: true });
        return window.__blenderBrowserSentinel.identity;
    });
    const initialFrame = await captureGameFrame(page, "before-save");

    const blenderEnv = {
        BLENDER_BIN: blender,
        FPP2_BLEND_PATH: blendPath,
        FPP2_PUBLICATION_PATH: publicationPath,
        FPP2_PUBLISH_URL: `${baseUrl}/__blender/publish`,
    };
    await writeFile(editPath, editScript);
    const firstEvent = await page.evaluate(() => window.__blenderStatusEvents.length);
    const firstLog = await run(blender, ["--background", "--factory-startup", "--python-exit-code", "1", "--python", resolve(root, "tests/blender-export.py")], blenderEnv);
    if (!firstLog.includes("FPP2 published blender-check revision")) throw new Error(`The Blender fixture did not publish successfully:\n${firstLog}`);
    const firstPublication = JSON.parse(await readFile(publicationPath, "utf8"));
    for (const id of Object.keys(firstPublication.assets)) assetIds.add(id);
    const firstRevision = (await latest()).revision;
    published = true;
    await waitForRevision(page, firstRevision, firstEvent);
    const firstFrame = await captureGameFrame(page, "first-save", true);
    if (firstPublication.level.id !== "blender-check" || firstPublication.testFrom !== "moving-platform") {
        throw new Error("The native Blender fixture did not publish the selected moving-platform start");
    }
    const firstMoving = firstPublication.level.objects.find((object) => object.id === "moving-platform");

    const secondEvent = await page.evaluate(() => window.__blenderStatusEvents.length);
    const secondLog = await run(blender, ["--background", "--factory-startup", blendPath, "--python-exit-code", "1", "--python", editPath], blenderEnv);
    if (!secondLog.includes("FPP2 second save published")) throw new Error(`The reopened Blender file did not save successfully:\n${secondLog}`);
    const secondPublication = await latest();
    const secondRevision = secondPublication.revision;
    for (const object of secondPublication.level.objects) if (object.visual.kind === "gltf") assetIds.add(object.visual.asset);
    for (const item of secondPublication.level.scenery ?? []) assetIds.add(item.asset);
    const secondMoving = secondPublication.level.objects.find((object) => object.id === "moving-platform");
    if (secondRevision === firstRevision) throw new Error("The second Blender save did not create a new revision");
    await waitForRevision(page, secondRevision, secondEvent);
    const secondFrame = await captureGameFrame(page, "second-save", true);
    if (secondPublication.level.scenery?.length) throw new Error("The second save retained deleted scenery");
    if (secondPublication.testFrom !== "moving-platform") throw new Error("The second save lost its selected platform start");
    if (firstMoving.visual.asset === secondMoving.visual.asset) throw new Error("Visual geometry or material edits did not create a new asset version");
    if (secondMoving.transform.scale[0] <= firstMoving.transform.scale[0]) throw new Error("The second save did not update moving-platform collision scale");
    if (firstFrame.revision !== firstRevision || secondFrame.revision !== secondRevision) throw new Error("Captured frames do not match the loaded revisions");
    for (const frame of [firstFrame, secondFrame]) {
        if (frame.respawnPosition.some((value, index) => Math.abs(value - frame.expectedRespawnPosition[index]) > 1e-4))
            throw new Error(`The selected moving-platform phase start was not applied: ${frame.respawnPosition} vs ${frame.expectedRespawnPosition}`);
    }
    if (secondFrame.collisionWidth <= firstFrame.collisionWidth) throw new Error("The native moving-platform collider did not grow after the Blender save");

    const status = await page.locator("output").textContent();
    if (status !== "Blender: blender-check loaded") throw new Error(`Browser did not load revision ${secondRevision}: ${status}`);
    const browserState = await page.evaluate((sentinelIdentity) => ({
        sentinelIdentity: window.__blenderBrowserSentinel?.identity,
        stableDocument: window.__blenderDocumentStart === performance.timeOrigin,
        stableCanvas: window.__blenderCanvas === document.querySelector("canvas"),
        stableSentinel: window.__blenderBrowserSentinel === window.__blenderBaselineSentinel
            && window.__blenderBrowserSentinel?.identity === sentinelIdentity,
    }), browserSentinel);
    if (!browserState.stableDocument || !browserState.stableCanvas || !browserState.stableSentinel) throw new Error("The browser document, canvas, or sentinel changed across saves");

    const latestBeforeInvalid = await latest();
    const invalid = await fetch(`${baseUrl}/__blender/publish`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ level: {}, assets: {} }),
    });
    if (invalid.status !== 400) throw new Error(`Invalid publication returned ${invalid.status}`);
    const latestAfterInvalid = await latest();
    if (latestAfterInvalid.revision !== latestBeforeInvalid.revision) throw new Error("Invalid publication replaced the latest Blender revision");
    await page.waitForTimeout(300);
    if (await page.locator("output").textContent() !== "Blender: blender-check loaded") throw new Error("Invalid publication changed the running app status");
    if (pageErrors.length) throw new Error(`Browser errors: ${pageErrors.join("; ")}`);

    console.log(JSON.stringify({
        firstRevision,
        secondRevision,
        selectedStart: firstPublication.testFrom,
        initialFrame,
        firstFrame,
        secondFrame,
        frameChanged: firstFrame.hash !== secondFrame.hash,
        ...browserState,
        invalidStatus: invalid.status,
        invalidPreservedRevision: latestAfterInvalid.revision,
        fixtureLogs: [firstLog.slice(-1000), secondLog.slice(-1000)],
    }, null, 2));
} finally {
    await browser?.close();
    if (published) {
        await rm(resolve(root, "public/levels/blender-check.json"), { force: true });
        for (const id of assetIds) await rm(resolve(root, "public/models", `${id}.glb`), { force: true });
    }
    await rm(work, { recursive: true, force: true });
}
