import { playtestRevision } from "./playtest";
import { LandingSurface } from "./physics";
import { resetGameplayWorld } from "./gameplay-system";
import { gameplayProgress } from "./gameplay-state";
import { updateScenery } from "./scenery";
import { createCharacterMeshes, landingRingMesh, tongueMesh, flatMaterial } from "./visual-mesh";
import {
    Camera,
    DirectionalLight,
    GlobalAmbientLight,
    Listener,
    lookAtRotation,
    Materials,
    Meshes,
    MeshInstance,
    MeshMaterial,
    requirePointerLock,
    releasePointerLock,
    StandardMaterial,
    StandardRenderer,
    Transform,
    type World,
} from "@dylanebert/shallot";
import type { MaterialHandle } from "@dylanebert/shallot/standard/rendering";
import { campaignLevelForStart, campaignSession, readCampaignSession, persistBrowserCampaignSession, PersistCampaignCompletion } from "./campaign-progress";
import { initializeGameAudio } from "./audio";
import { CAMERA_TUNING } from "../config/camera";
import { loadLevel } from "../content/level";
import { addLevelPhysics } from "./physics";
import { addLevelRendering, addSceneryModels, loadLevelAsset, loadLevelAssets } from "./level-rendering";
import { predictLanding } from "./presentation";
import { cameraPosition } from "./camera";
import { activeLevel, resetPlayerToSpawn, runtime } from "./state";
import { initializeGameplay } from "./gameplay-system";
import { initializeGameplayHud } from "./hud";

function box(
    world: World,
    material: MaterialHandle,
    translation: readonly [number, number, number],
    scale: readonly [number, number, number],
): number {
    const eid = world.create();
    world.add(eid, Transform, { translation, scale });
    world.add(eid, MeshInstance);
    world.add(eid, MeshMaterial, material);
    return eid;
}

export async function initializeGame(world: World): Promise<void> {
    requirePointerLock(world, true);
    world.onDispose(() => releasePointerLock(world));

    const state = world.resource(runtime);
    const session = world.resource(campaignSession);
    try { Object.assign(session, readCampaignSession(window.localStorage)); }
    catch { session.persistenceFailure = "Progress could not be loaded. Progress is available for this session only."; }
    const selectedLevel = campaignLevelForStart(
        new URLSearchParams(window.location.search).get("level"),
        session.save,
        import.meta.env?.DEV === true,
    );
    const revision = world.resource(playtestRevision).current;
    state.level = revision?.level ?? await loadLevel(selectedLevel);
    if (!revision) {
        session.save.lastSelectedLevelId = selectedLevel;
        persistBrowserCampaignSession(session);
    }
    world.addSystem(PersistCampaignCompletion);
    resetPlayerToSpawn(state);
    const levelDefinition = activeLevel(state);
    await loadLevelAssets(world, levelDefinition);
    if (import.meta.env?.DEV === true) await loadLevelAsset(world, "sample-platform");

    const ambient = world.resource(GlobalAmbientLight);
    ambient.color = 0xc9d8ee;
    ambient.brightness = 340;

    const sun = world.create();
    world.add(sun, Transform, { rotation: lookAtRotation(-8, 12, 10, 0, 2, 0) });
    world.add(sun, DirectionalLight, { color: 0xfff0dc, illuminance: 5000 });

    const camera = world.create();
    const initialCameraPosition = cameraPosition(
        state.cameraFocus,
        state.cameraYaw,
        state.cameraPitch,
        state.cameraDistance,
    );
    world.add(camera, Camera, {
        fov: CAMERA_TUNING.BASE_FOV_DEG,
        far: 180,
        clearColor: 0x9ca69a,
    });
    world.add(camera, StandardRenderer);
    world.add(camera, Listener);
    world.add(camera, Transform, {
        translation: [initialCameraPosition.x, initialCameraPosition.y, initialCameraPosition.z],
        rotation: lookAtRotation(
            initialCameraPosition.x,
            initialCameraPosition.y,
            initialCameraPosition.z,
            state.cameraFocus.x,
            state.cameraFocus.y,
            state.cameraFocus.z,
        ),
    });

    const materials = world.resource(Materials);
    const groundMaterial = materials.add(
        StandardMaterial({ baseColor: [0.12, 0.16, 0.2, 1], perceptualRoughness: 0.85 }),
    );
    const platformMaterial = materials.add(
        StandardMaterial({ baseColor: [0.28, 0.39, 0.5, 1], perceptualRoughness: 0.72 }),
    );
    const goalMaterial = materials.add(
        StandardMaterial({
            baseColor: [0.1, 0.78, 0.65, 1],
            emissive: [0.02, 0.35, 0.23],
            perceptualRoughness: 0.5,
        }),
    );
    const checkpointMaterial = materials.add(
        StandardMaterial({
            baseColor: [0.18, 0.58, 0.88, 1],
            emissive: [0.025, 0.15, 0.4],
            perceptualRoughness: 0.5,
        }),
    );
    const activeCheckpointMaterial = materials.add(
        StandardMaterial({
            baseColor: [0.6, 1, 0.65, 1],
            unlit: true,
            perceptualRoughness: 0.45,
        }),
    );
    const bodyMaterial = materials.add(
        StandardMaterial({ baseColor: [0.95, 0.74, 0.24, 1], perceptualRoughness: 0.48 }),
    );
    const poleMaterial = materials.add(
        StandardMaterial({ baseColor: [0.16, 0.22, 0.24, 1], perceptualRoughness: 0.4 }),
    );
    const tipMaterial = materials.add(
        StandardMaterial({ baseColor: [0.40, 0.14, 0.15, 1], perceptualRoughness: 0.55 }),
    );

    const levelObjects = addLevelPhysics(world, levelDefinition);
    addLevelRendering(world, levelObjects, {
        ground: groundMaterial,
        platform: platformMaterial,
        goal: goalMaterial,
        checkpoint: checkpointMaterial,
    }, levelDefinition.appearance?.surface);
    state.levelEntities = levelObjects;
    updateScenery(world, levelDefinition);
    addSceneryModels(world, levelDefinition);
    state.levelMaterials = {
        ground: groundMaterial.material,
        platform: platformMaterial.material,
        goal: goalMaterial.material,
        checkpoint: checkpointMaterial.material,
    };
    state.activeCheckpointMaterial = activeCheckpointMaterial.material;

    const { x, y, z } = state.sim.body.pos;
    const body = box(world, bodyMaterial, [x, y, z], [0.65, 0.82, 0.65]);
    world.storage(MeshInstance).mesh.set(body, createCharacterMeshes(world)[0]!);
    world.add(body, MeshMaterial, world.resource(flatMaterial));
    const pole = box(world, poleMaterial, [x, y - 0.5, z], [0.14, 1, 0.14]);
    world.storage(MeshInstance).mesh.set(pole, world.resource(Meshes).add(tongueMesh()));
    world.add(pole, MeshMaterial, world.resource(flatMaterial));
    const tip = box(world, tipMaterial, [x, y - 1, z], [0.34, 0.2, 0.34]);
    const initialPrediction = predictLanding(state.sim, levelDefinition);
    const initialMarkerPosition = initialPrediction?.position ?? { x: 0, y: 0, z: 0 };
    const initialValidMarker = initialPrediction?.certain ?? false;
    const validMarkerMaterial = materials.add(
        StandardMaterial({
            baseColor: [0.1, 0.72, 0.42, 1],
            emissive: [0.03, 0.3, 0.12],
            perceptualRoughness: 0.55,
        }),
    );
    const uncertainMarkerMaterial = materials.add(
        StandardMaterial({
            baseColor: [0.92, 0.48, 0.12, 1],
            emissive: [0.38, 0.12, 0.015],
            perceptualRoughness: 0.55,
        }),
    );
    const validLandingMarker = box(
        world,
        validMarkerMaterial,
        initialValidMarker
            ? [initialMarkerPosition.x, initialMarkerPosition.y + 0.035, initialMarkerPosition.z]
            : [0, CAMERA_TUNING.HIDDEN_MARKER_Y_M, 0],
        [CAMERA_TUNING.MARKER_BASE_SIZE_M, 0.025, CAMERA_TUNING.MARKER_BASE_SIZE_M],
    );
    const uncertainLandingMarker = box(
        world,
        uncertainMarkerMaterial,
        initialPrediction !== undefined && !initialValidMarker
            ? [initialMarkerPosition.x, initialMarkerPosition.y + 0.035, initialMarkerPosition.z]
            : [0, CAMERA_TUNING.HIDDEN_MARKER_Y_M, 0],
        [CAMERA_TUNING.MARKER_BASE_SIZE_M, 0.025, CAMERA_TUNING.MARKER_BASE_SIZE_M],
    );
    const ring = world.resource(Meshes).add(landingRingMesh());
    world.storage(MeshInstance).mesh.set(validLandingMarker, ring);
    world.storage(MeshInstance).mesh.set(uncertainLandingMarker, ring);
    Object.assign(state, {
        camera,
        body,
        pole,
        tip,
        validLandingMarker,
        uncertainLandingMarker,
    });
    initializeGameAudio(world);
    initializeGameplay(world);
    if (revision?.testFrom) {
        const eid = state.levelEntities.find(item => item.id === revision.testFrom)?.collisionEid;
        if (eid === undefined) throw new Error(`Playtest platform "${revision.testFrom}" does not exist`);
        const surface = world.storage(LandingSurface);
        world.resource(gameplayProgress).respawnPosition = [surface.centerX.get(eid), surface.topY.get(eid) + 1.6, surface.centerZ.get(eid)];
        resetGameplayWorld(world);
    }

    if (import.meta.env?.DEV === true) {
        const { initializeEditor } = await import("./editor");
        initializeEditor(world, {
            ground: groundMaterial,
            platform: platformMaterial,
            goal: goalMaterial,
            checkpoint: checkpointMaterial,
        });
    }
    initializeGameplayHud(world);
}
