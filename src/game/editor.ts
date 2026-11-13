import { resetPlatforms } from "./platforms";
import { parseAuthoredSurface, resolveSurface, SURFACE_PROFILES, type SurfaceOverrides, type SurfaceResponse } from "../surfaces";
import {
    Camera,
    Devices,
    lookAtRotation,
    Materials,
    Meshes,
    MeshInstance,
    MeshMaterial,
    Outline,
    StandardMaterial,
    StandardRenderer,
    Transform,
    mountOverlay,
    releasePointerLock,
    requirePointerLock,
    setInputEnabled,
    type World,
} from "@dylanebert/shallot";
import { viewportToWorld } from "@dylanebert/shallot/rendering";
import { castRayClosest, emptyQueryHit } from "@dylanebert/shallot/standard/physics";
import type { MaterialHandle } from "@dylanebert/shallot/standard/rendering";
import {
    loadLevel,
    overlappingLevelSurfaces,
    parseLevelDefinition,
    type LevelAssetId,
    type LevelDefinition,
    type LevelMaterial,
    type LevelObjectDefinition,
    type QuaternionTuple,
    type Vec3Tuple,
} from "../content/level";
import { activeLevel, runtime } from "./state";
import {
    addLevelObjectPhysics,
    destroyLevelEntities,
    updateLevelEntity,
    surfaceDiagnostics,
    type LevelEntity,
} from "./physics";
import {
    addLevelRendering,
    cacheLevelAsset,
    loadLevelAsset,
    loadModelFile,
    modelLocalHalfExtents,
    updateLevelRendering,
} from "./level-rendering";
import { editorState, isEditing, type CameraSettings, type EditorDrag, type EditorState, type TransformAxis } from "./editor-state";
import type { Vec3 } from "../vec";
import { resetGameplayToSpawn } from "./gameplay-system";

const HISTORY_LIMIT = 50;
const DRAG_DISTANCE = 100;
const MIN_OBJECT_SIZE = 0.1;
const SNAP_STEPS = [0, 0.25, 0.5, 1] as const;
const MOVE_AXES = ["x", "y", "z"] as const;
const HIT = emptyQueryHit();

type Axis = Exclude<TransformAxis, "free">;

export function moveAxisLength(screenSize: number, halfExtent: number): number {
    return Math.max(screenSize, halfExtent + screenSize * 0.4);
}

export function moveAxisHalfExtents(
    scale: Vec3Tuple,
    rotation: QuaternionTuple,
    localHalfExtents: Vec3Tuple = [0.5, 0.5, 0.5],
): Vec3Tuple {
    const cosine = Math.abs(1 - 2 * rotation[1] * rotation[1]);
    const sine = Math.abs(2 * rotation[1] * rotation[3]);
    const halfX = scale[0] * localHalfExtents[0];
    const halfY = scale[1] * localHalfExtents[1];
    const halfZ = scale[2] * localHalfExtents[2];
    return [
        cosine * halfX + sine * halfZ,
        halfY,
        sine * halfX + cosine * halfZ,
    ];
}

function axisVector(axis: Axis): Vec3 {
    if (axis === "x") return { x: 1, y: 0, z: 0 };
    if (axis === "y") return { x: 0, y: 1, z: 0 };
    return { x: 0, y: 0, z: 1 };
}

function axisRotation(axis: Axis): readonly [number, number, number, number] {
    const half = Math.SQRT1_2;
    if (axis === "x") return [0, 0, -half, half];
    if (axis === "z") return [half, 0, 0, half];
    return [0, 0, 0, 1];
}

function arrowMeshData(): { vertices: Float32Array; indices: Uint32Array } {
    const vertices: number[] = [];
    const indices: number[] = [];
    const tip: Vec3 = { x: 0, y: 0.5, z: 0 };
    const center: Vec3 = { x: 0, y: -0.5, z: 0 };
    const base = Array.from({ length: 6 }, (_, index): Vec3 => {
        const angle = (index * Math.PI * 2) / 6;
        return { x: Math.cos(angle) * 0.5, y: -0.5, z: Math.sin(angle) * 0.5 };
    });

    function triangle(a: Vec3, b: Vec3, c: Vec3): void {
        const ab = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
        const ac = { x: c.x - a.x, y: c.y - a.y, z: c.z - a.z };
        const normal = {
            x: ab.y * ac.z - ab.z * ac.y,
            y: ab.z * ac.x - ab.x * ac.z,
            z: ab.x * ac.y - ab.y * ac.x,
        };
        const length = Math.hypot(normal.x, normal.y, normal.z);
        const offset = vertices.length / 8;
        for (const point of [a, b, c])
            vertices.push(
                point.x,
                point.y,
                point.z,
                0,
                normal.x / length,
                normal.y / length,
                normal.z / length,
                0,
            );
        indices.push(offset, offset + 1, offset + 2);
    }

    for (let index = 0; index < base.length; index++) {
        const current = base[index]!;
        const next = base[(index + 1) % base.length]!;
        triangle(current, tip, next);
        triangle(center, current, next);
    }
    return { vertices: new Float32Array(vertices), indices: new Uint32Array(indices) };
}

function cloneLevel(level: LevelDefinition): LevelDefinition {
    return structuredClone(level);
}

function point(position: Vec3Tuple): Vec3 {
    return { x: position[0], y: position[1], z: position[2] };
}

function displayedScale(object: LevelObjectDefinition): Vec3Tuple {
    if (object.collision.kind !== "trigger-box") return object.transform.scale;
    return [
        object.transform.scale[0] * object.collision.dimensions[0],
        object.transform.scale[1] * object.collision.dimensions[1],
        object.transform.scale[2] * object.collision.dimensions[2],
    ];
}

function authoredScale(object: LevelObjectDefinition, displayed: Vec3Tuple): Vec3Tuple {
    if (object.collision.kind !== "trigger-box") return displayed;
    return [
        displayed[0] / object.collision.dimensions[0],
        displayed[1] / object.collision.dimensions[1],
        displayed[2] / object.collision.dimensions[2],
    ];
}

function sameLevel(a: LevelDefinition, b: LevelDefinition): boolean {
    return JSON.stringify(a) === JSON.stringify(b);
}

function dirty(editor: EditorState, level: LevelDefinition): boolean {
    return editor.saved === undefined || !sameLevel(editor.saved, level);
}

function setStatus(editor: EditorState, message: string): void {
    editor.status = message;
    editor.refreshUi = true;
}

function objectFor(level: LevelDefinition, id: string): LevelObjectDefinition | undefined {
    return level.objects.find((object) => object.id === id);
}

function entityFor(levelEntities: readonly LevelEntity[], id: string): LevelEntity | undefined {
    return levelEntities.find((entity) => entity.id === id);
}

function sameEntityKinds(left: LevelObjectDefinition, right: LevelObjectDefinition): boolean {
    if (
        left.role !== right.role ||
        left.collision.kind !== right.collision.kind ||
        left.visual.kind !== right.visual.kind
    )
        return false;
    if (left.visual.kind === "box" && right.visual.kind === "box")
        return left.visual.material === right.visual.material;
    if (left.visual.kind === "gltf" && right.visual.kind === "gltf")
        return left.visual.asset === right.visual.asset;
    return false;
}

function selectedObject(world: World): LevelObjectDefinition | undefined {
    const id = world.resource(editorState).selectedId;
    return id === null || id === "spawn" ? undefined : objectFor(activeLevel(world.resource(runtime)), id);
}

function saveHistory(editor: EditorState, level: LevelDefinition): void {
    editor.undo.push(cloneLevel(level));
    if (editor.undo.length > HISTORY_LIMIT) editor.undo.shift();
    editor.redo.length = 0;
}

function syncLevel(world: World, level: LevelDefinition, refresh = true): void {
    const state = world.resource(runtime);
    const editor = world.resource(editorState);
    const nextById = new Map(level.objects.map((object) => [object.id, object]));
    const oldById = new Map(state.levelEntities.map((entity) => [entity.id, entity]));

    for (const entity of state.levelEntities) {
        if (nextById.has(entity.id)) continue;
        for (const visualEid of entity.visualEids ?? []) {
            if (world.has(visualEid, Outline)) world.remove(visualEid, Outline);
        }
        destroyLevelEntities(world, [entity]);
    }

    const nextEntities = level.objects.map((object) => {
        const existing = oldById.get(object.id);
        if (existing && sameEntityKinds(existing.object, object)) {
            if (existing.object !== object) {
                updateLevelEntity(world, existing, object);
                updateLevelRendering(world, existing, object, editor.materials!.goal);
            }
            return existing;
        }
        if (existing) {
            for (const visualEid of existing.visualEids ?? []) {
                if (world.has(visualEid, Outline)) world.remove(visualEid, Outline);
            }
            destroyLevelEntities(world, [existing]);
        }
        const added = addLevelObjectPhysics(world, object);
        const materials = editor.materials;
        if (!materials) throw new Error("Editor level materials are unavailable");
        addLevelRendering(world, [added], materials);
        return added;
    });

    state.level = level;
    state.levelEntities = nextEntities;
    if (editor.selectedId !== null && editor.selectedId !== "spawn" && !objectFor(level, editor.selectedId))
        editor.selectedId = null;
    syncSpawnMarker(world, level.spawnPosition);
    updateFailureMarker(world, level.failureBoundaryY);
    updateSelectionOutline(world);
    if (refresh) editor.refreshUi = true;
}

function replaceLevel(world: World, level: LevelDefinition): void {
    syncLevel(world, level);
}

function updateSpawnMarker(world: World, spawn: Vec3Tuple): void {
    const eid = world.resource(editorState).spawnMarker;
    if (!eid) return;
    world.storage(Transform).translation.set(eid, spawn[0], spawn[1] + 0.55, spawn[2]);
}

function syncSpawnMarker(world: World, spawn: Vec3Tuple): void {
    updateSpawnMarker(world, spawn);
}

function updateFailureMarker(world: World, failureBoundaryY: number): void {
    const eid = world.resource(editorState).failureMarker;
    if (!eid) return;
    world.storage(Transform).translation.set(eid, 0, failureBoundaryY, 0);
}

function removeOutline(world: World, id: string | null): void {
    if (id === null) return;
    const editor = world.resource(editorState);
    const eids = id === "spawn"
        ? [editor.spawnMarker]
        : entityFor(world.resource(runtime).levelEntities, id)?.visualEids ?? [];
    for (const eid of eids) {
        if (eid && world.has(eid, Outline)) world.remove(eid, Outline);
    }
}

function updateSelectionOutline(world: World): void {
    const editor = world.resource(editorState);
    const id = editor.selectedId;
    if (id === null) return;
    const eids = id === "spawn"
        ? [editor.spawnMarker]
        : entityFor(world.resource(runtime).levelEntities, id)?.visualEids ?? [];
    for (const eid of eids) {
        if (world.has(eid, Outline)) {
            world.storage(Outline).color.set(eid, editor.outlineColor);
            world.storage(Outline).width.set(eid, 5);
            world.storage(Outline).occlude.set(eid, 1);
        } else world.add(eid, Outline, { color: editor.outlineColor, width: 5, occlude: 1 });
    }
}

function moveHandlePosition(world: World): Vec3 | undefined {
    const editor = world.resource(editorState);
    if (editor.selectedId === "spawn") {
        const spawn = activeLevel(world.resource(runtime)).spawnPosition;
        return { x: spawn[0], y: spawn[1] + 0.55, z: spawn[2] };
    }
    const object = selectedObject(world);
    return object ? point(object.transform.position) : undefined;
}

function hideMoveAxisHandles(world: World, editor: EditorState): void {
    const transform = world.storage(Transform);
    for (const eid of [...editor.moveAxisShafts, ...editor.moveAxisHeads]) {
        if (eid) transform.scale.set(eid, 0, 0, 0);
    }
    editor.moveAxisSize = 0;
    editor.moveAxisLengths = [0, 0, 0];
}

function updateMoveAxisHandles(world: World, editor: EditorState): void {
    if (!isEditing(editor) || editor.transformMode !== "move") {
        hideMoveAxisHandles(world, editor);
        return;
    }
    const pivot = moveHandlePosition(world);
    if (!pivot || !editor.moveAxisArrowMesh) {
        hideMoveAxisHandles(world, editor);
        return;
    }

    const cameraPosition = editor.cameraPosition;
    const distance = Math.hypot(
        cameraPosition.x - pivot.x,
        cameraPosition.y - pivot.y,
        cameraPosition.z - pivot.z,
    );
    const canvasHeight = Math.max(1, document.querySelector("canvas")?.clientHeight ?? window.innerHeight);
    const visibleHeight = 2 * distance * Math.tan((editor.editorCameraSettings.fov * Math.PI) / 360);
    const size = Math.max(0.45, Math.min(3, (visibleHeight * 85) / canvasHeight));
    editor.moveAxisSize = size;
    const object = editor.selectedId === "spawn" ? undefined : selectedObject(world);
    const modelHalfExtents = object?.visual.kind === "gltf"
        ? modelLocalHalfExtents(world, object.visual.asset)
        : undefined;
    const halfExtents = object
        ? moveAxisHalfExtents(displayedScale(object), object.transform.rotation, modelHalfExtents)
        : editor.selectedId === "spawn"
          ? [0.14, 0.55, 0.14]
          : [0, 0, 0];
    editor.moveAxisLengths = halfExtents.map((extent) => moveAxisLength(size, extent!)) as [
        number,
        number,
        number,
    ];
    const transform = world.storage(Transform);

    for (let index = 0; index < MOVE_AXES.length; index++) {
        const axisName = MOVE_AXES[index]!;
        const axis = axisVector(axisName);
        const rotation = axisRotation(axisName);
        const length = editor.moveAxisLengths[index]!;
        const headLength = size * 0.28;
        const shaftLength = Math.max(size * 0.72, length - headLength * 0.65);
        const shaft = editor.moveAxisShafts[index]!;
        const head = editor.moveAxisHeads[index]!;
        transform.translation.set(
            shaft,
            pivot.x + axis.x * shaftLength * 0.5,
            pivot.y + axis.y * shaftLength * 0.5,
            pivot.z + axis.z * shaftLength * 0.5,
        );
        transform.rotation.set(shaft, ...rotation);
        transform.scale.set(shaft, size * 0.025, shaftLength, size * 0.025);
        transform.translation.set(
            head,
            pivot.x + axis.x * (length - headLength * 0.5),
            pivot.y + axis.y * (length - headLength * 0.5),
            pivot.z + axis.z * (length - headLength * 0.5),
        );
        transform.rotation.set(head, ...rotation);
        transform.scale.set(head, size * 0.16, headLength, size * 0.16);
    }
}

function closestRayAxis(
    ray: { origin: readonly [number, number, number]; dir: readonly [number, number, number] },
    origin: Vec3,
    axis: Vec3,
): { axisParameter: number; distance: number } | undefined {
    const dx = ray.dir[0];
    const dy = ray.dir[1];
    const dz = ray.dir[2];
    const wx = ray.origin[0] - origin.x;
    const wy = ray.origin[1] - origin.y;
    const wz = ray.origin[2] - origin.z;
    const directionDotAxis = dx * axis.x + dy * axis.y + dz * axis.z;
    const directionDotOffset = dx * wx + dy * wy + dz * wz;
    const axisDotOffset = axis.x * wx + axis.y * wy + axis.z * wz;
    const denominator = dx * dx + dy * dy + dz * dz - directionDotAxis * directionDotAxis;
    if (denominator < 1e-6) return undefined;
    const rayParameter =
        (directionDotAxis * axisDotOffset - directionDotOffset) / denominator;
    if (rayParameter < 0) return undefined;
    const axisParameter = axisDotOffset + directionDotAxis * rayParameter;
    const rayX = ray.origin[0] + dx * rayParameter;
    const rayY = ray.origin[1] + dy * rayParameter;
    const rayZ = ray.origin[2] + dz * rayParameter;
    const axisX = origin.x + axis.x * axisParameter;
    const axisY = origin.y + axis.y * axisParameter;
    const axisZ = origin.z + axis.z * axisParameter;
    return {
        axisParameter,
        distance: Math.hypot(rayX - axisX, rayY - axisY, rayZ - axisZ),
    };
}

function pickMoveAxisHandle(world: World, x: number, y: number): Axis | undefined {
    const editor = world.resource(editorState);
    const pivot = moveHandlePosition(world);
    const ray = rayAt(world, x, y);
    if (!pivot || !ray || editor.moveAxisSize <= 0 || editor.transformMode !== "move")
        return undefined;
    const pickRadius = editor.moveAxisSize * 0.1;
    let selected: Axis | undefined;
    let closestDistance = Number.POSITIVE_INFINITY;
    for (const axisName of MOVE_AXES) {
        const index = MOVE_AXES.indexOf(axisName);
        const hit = closestRayAxis(ray, pivot, axisVector(axisName));
        if (
            !hit ||
            hit.axisParameter < editor.moveAxisSize * 0.16 ||
            hit.axisParameter > editor.moveAxisLengths[index]! + editor.moveAxisSize * 0.04 ||
            hit.distance > pickRadius ||
            hit.distance >= closestDistance
        )
            continue;
        selected = axisName;
        closestDistance = hit.distance;
    }
    return selected;
}

function select(world: World, id: string | null): void {
    const editor = world.resource(editorState);
    removeOutline(world, editor.selectedId);
    editor.selectedId = id;
    updateSelectionOutline(world);
    editor.refreshUi = true;
    refreshMountedUi(world);
}

function cameraSettings(world: World, eid: number): CameraSettings {
    const camera = world.storage(Camera);
    return {
        mode: camera.mode.get(eid),
        fov: camera.fov.get(eid),
        near: camera.near.get(eid),
        far: camera.far.get(eid),
        size: camera.size.get(eid),
        clearColor: camera.clearColor.get(eid),
        antialias: camera.antialias.get(eid),
        order: camera.order.get(eid),
    };
}

function hideGameplayVisuals(world: World): void {
    const state = world.resource(runtime);
    const transform = world.storage(Transform);
    for (const eid of [state.body, state.pole, state.tip]) transform.scale.set(eid, 0, 0, 0);
    transform.translation.set(state.validLandingMarker, 0, -10000, 0);
    transform.translation.set(state.uncertainLandingMarker, 0, -10000, 0);
}

function setMode(world: World, mode: "edit" | "play"): void {
    const editor = world.resource(editorState);
    const game = world.resource(runtime);
    if (editor.mode === mode) return;
    setInputEnabled(world, false);
    setInputEnabled(world, true);
    if (mode === "edit") {
        editor.gameCameraSettings = cameraSettings(world, game.camera);
        editor.mode = "edit";
        resetPlatforms(world, game.levelEntities, true);
        world.remove(game.camera, Camera);
        world.add(editor.camera, Camera, editor.editorCameraSettings);
        requirePointerLock(world, false);
        releasePointerLock(world);
        hideGameplayVisuals(world);
        world.storage(Transform).scale.set(editor.spawnMarker, 0.28, 1.1, 0.28);
        world.storage(Transform).scale.set(editor.failureMarker, 28, 0.035, 24);
        updateSelectionOutline(world);
        setStatus(editor, "");
        refreshMountedUi(world);
        return;
    }

    if (editor.dragging) finishDrag(world);
    removeOutline(world, editor.selectedId);
    editor.editorCameraSettings = cameraSettings(world, editor.camera);
    editor.mode = "play";
    world.remove(editor.camera, Camera);
    world.add(game.camera, Camera, editor.gameCameraSettings ?? editor.editorCameraSettings);
    resetGameplayToSpawn(world);
    world.storage(Transform).scale.set(editor.spawnMarker, 0, 0, 0);
    world.storage(Transform).scale.set(editor.failureMarker, 0, 0, 0);
    requirePointerLock(world, true);
    setStatus(editor, "");
    refreshMountedUi(world);
}

function setObject(world: World, id: string, object: LevelObjectDefinition): void {
    const level = activeLevel(world.resource(runtime));
    const next: LevelDefinition = {
        ...level,
        objects: level.objects.map((entry) => entry.id === id ? object : entry),
    };
    syncLevel(world, next, false);
}

function changedLevel(world: World, next: LevelDefinition, before: LevelDefinition): void {
    if (sameLevel(before, next)) return;
    const editor = world.resource(editorState);
    saveHistory(editor, before);
    setStatus(editor, "");
    syncLevel(world, next);
}

function undo(world: World): void {
    const editor = world.resource(editorState);
    const level = activeLevel(world.resource(runtime));
    const previous = editor.undo.pop();
    if (!previous) return;
    editor.redo.push(cloneLevel(level));
    syncLevel(world, previous);
    setStatus(editor, "");
    refreshMountedUi(world);
}

function redo(world: World): void {
    const editor = world.resource(editorState);
    const level = activeLevel(world.resource(runtime));
    const next = editor.redo.pop();
    if (!next) return;
    editor.undo.push(cloneLevel(level));
    syncLevel(world, next);
    setStatus(editor, "");
    refreshMountedUi(world);
}

function cameraForward(editor: EditorState): Vec3 {
    const cosine = Math.cos(editor.cameraPitch);
    return {
        x: -Math.sin(editor.cameraYaw) * cosine,
        y: -Math.sin(editor.cameraPitch),
        z: -Math.cos(editor.cameraYaw) * cosine,
    };
}

function rayAt(world: World, x: number, y: number) {
    const editor = world.resource(editorState);
    return viewportToWorld(world, editor.camera, x, y);
}

function raySphereDistance(
    origin: readonly [number, number, number],
    direction: readonly [number, number, number],
    center: Vec3,
    radius: number,
): number | undefined {
    const ox = origin[0] - center.x;
    const oy = origin[1] - center.y;
    const oz = origin[2] - center.z;
    const projection = ox * direction[0] + oy * direction[1] + oz * direction[2];
    const discriminant = projection * projection - (ox * ox + oy * oy + oz * oz - radius * radius);
    if (discriminant < 0) return undefined;
    const near = -projection - Math.sqrt(discriminant);
    const far = -projection + Math.sqrt(discriminant);
    if (near >= 0) return near;
    return far >= 0 ? far : undefined;
}

function rayTriggerDistance(
    origin: readonly [number, number, number],
    direction: readonly [number, number, number],
    object: LevelObjectDefinition,
): number | undefined {
    if (object.collision.kind !== "trigger-box") return undefined;
    const rotationY = 2 * Math.atan2(object.transform.rotation[1], object.transform.rotation[3]);
    const cosine = Math.cos(rotationY);
    const sine = Math.sin(rotationY);
    const dx = origin[0] - object.transform.position[0];
    const dz = origin[2] - object.transform.position[2];
    const localOrigin = [
        cosine * dx - sine * dz,
        origin[1] - object.transform.position[1],
        sine * dx + cosine * dz,
    ];
    const localDirection = [
        cosine * direction[0] - sine * direction[2],
        direction[1],
        sine * direction[0] + cosine * direction[2],
    ];
    const half = object.transform.scale.map(
        (scale, axis) => scale * object.collision.dimensions[axis]! * 0.5,
    );
    let enter = 0;
    let exit = DRAG_DISTANCE;
    for (let axis = 0; axis < 3; axis++) {
        const delta = localDirection[axis]!;
        if (Math.abs(delta) < 1e-8) {
            if (localOrigin[axis]! < -half[axis]! || localOrigin[axis]! > half[axis]!)
                return undefined;
            continue;
        }
        const first = (-half[axis]! - localOrigin[axis]!) / delta;
        const second = (half[axis]! - localOrigin[axis]!) / delta;
        enter = Math.max(enter, Math.min(first, second));
        exit = Math.min(exit, Math.max(first, second));
        if (enter > exit) return undefined;
    }
    return exit >= 0 && enter <= DRAG_DISTANCE ? Math.max(0, enter) : undefined;
}

function pick(world: World, x: number, y: number): string | null {
    const editor = world.resource(editorState);
    const game = world.resource(runtime);
    const ray = rayAt(world, x, y);
    if (!ray) return null;
    const direction = { x: ray.dir[0], y: ray.dir[1], z: ray.dir[2] };
    const spawn = activeLevel(game).spawnPosition;
    const spawnDistance = raySphereDistance(
        ray.origin,
        ray.dir,
        { x: spawn[0], y: spawn[1] + 0.55, z: spawn[2] },
        0.7,
    );
    const hasSurface = castRayClosest(
        world,
        { x: ray.origin[0], y: ray.origin[1], z: ray.origin[2] },
        { x: direction.x * DRAG_DISTANCE, y: direction.y * DRAG_DISTANCE, z: direction.z * DRAG_DISTANCE },
        HIT,
    );
    let selectedId: string | null = null;
    let selectedDistance = Number.POSITIVE_INFINITY;
    if (spawnDistance !== undefined) {
        selectedId = "spawn";
        selectedDistance = spawnDistance;
    }
    if (hasSurface) {
        const surfaceId = game.levelEntities.find((entity) => entity.collisionEid === HIT.body)?.id;
        if (surfaceId !== undefined) {
            selectedId = surfaceId;
            selectedDistance = HIT.fraction * DRAG_DISTANCE;
        }
    }
    for (const object of activeLevel(game).objects) {
        const distance = rayTriggerDistance(ray.origin, ray.dir, object);
        if (distance !== undefined && distance < selectedDistance) {
            selectedId = object.id;
            selectedDistance = distance;
        }
    }
    return selectedId;
}

function intersectPlane(
    ray: { origin: readonly [number, number, number]; dir: readonly [number, number, number] },
    position: Vec3,
    normal: Vec3,
): Vec3 | undefined {
    const denominator = ray.dir[0] * normal.x + ray.dir[1] * normal.y + ray.dir[2] * normal.z;
    if (Math.abs(denominator) < 1e-5) return undefined;
    const distance = (
        (position.x - ray.origin[0]) * normal.x +
        (position.y - ray.origin[1]) * normal.y +
        (position.z - ray.origin[2]) * normal.z
    ) / denominator;
    if (distance < 0) return undefined;
    return {
        x: ray.origin[0] + ray.dir[0] * distance,
        y: ray.origin[1] + ray.dir[1] * distance,
        z: ray.origin[2] + ray.dir[2] * distance,
    };
}

function snapValue(value: number, step: number): number {
    return step > 0 ? Math.round(value / step) * step : value;
}

function constrained(delta: Vec3, axis: TransformAxis): Vec3 {
    if (axis === "x") return { x: delta.x, y: 0, z: 0 };
    if (axis === "y") return { x: 0, y: delta.y, z: 0 };
    if (axis === "z") return { x: 0, y: 0, z: delta.z };
    return delta;
}

function beginDrag(world: World, id: string, x: number, y: number): void {
    const editor = world.resource(editorState);
    const level = activeLevel(world.resource(runtime));
    const ray = rayAt(world, x, y);
    if (!ray) return;
    const object = objectFor(level, id);
    if (id !== "spawn" && !object) return;
    if (id === "spawn" && editor.transformMode === "resize") return;
    const position = id === "spawn" ? point(level.spawnPosition) : point(object!.transform.position);
    const planeNormal = cameraForward(editor);
    const startPoint = intersectPlane(ray, position, planeNormal);
    if (!startPoint) return;
    const objectScale = object ? point(displayedScale(object)) : { x: 1, y: 1, z: 1 };
    editor.dragging = {
        objectId: id,
        mode: editor.transformMode,
        axis: editor.transformAxis,
        startPoint,
        planeNormal,
        objectPosition: position,
        objectScale,
        before: cloneLevel(level),
        changed: false,
        axisHandle: false,
        axisStart: undefined,
        axisOrigin: position,
    };
}

function beginAxisDrag(world: World, axis: Axis, x: number, y: number): void {
    const editor = world.resource(editorState);
    const id = editor.selectedId;
    if (!id) return;
    const level = activeLevel(world.resource(runtime));
    const object = id === "spawn" ? undefined : objectFor(level, id);
    if (id !== "spawn" && !object) return;
    const ray = rayAt(world, x, y);
    const axisOrigin = moveHandlePosition(world);
    if (!ray || !axisOrigin) return;
    const closest = closestRayAxis(ray, axisOrigin, axisVector(axis));
    if (!closest) return;
    const objectPosition = id === "spawn" ? point(level.spawnPosition) : point(object!.transform.position);
    editor.dragging = {
        objectId: id,
        mode: "move",
        axis,
        startPoint: objectPosition,
        planeNormal: cameraForward(editor),
        objectPosition,
        objectScale: object ? point(displayedScale(object)) : { x: 1, y: 1, z: 1 },
        before: cloneLevel(level),
        changed: false,
        axisHandle: true,
        axisStart: closest.axisParameter,
        axisOrigin,
    };
}

function applyDrag(world: World, x: number, y: number): void {
    const editor = world.resource(editorState);
    const drag = editor.dragging;
    if (!drag) return;
    const ray = rayAt(world, x, y);
    if (!ray) return;
    const level = activeLevel(world.resource(runtime));
    let delta: Vec3;
    if (drag.axisHandle) {
        if (drag.axis === "free" || drag.axisStart === undefined)
            throw new Error("Axis drag is missing its constrained axis or start parameter");
        const closest = closestRayAxis(ray, drag.axisOrigin, axisVector(drag.axis));
        if (!closest) return;
        const amount = snapValue(closest.axisParameter - drag.axisStart, editor.snap);
        const axis = axisVector(drag.axis);
        delta = { x: axis.x * amount, y: axis.y * amount, z: axis.z * amount };
    } else {
        const current = intersectPlane(ray, drag.objectPosition, drag.planeNormal);
        if (!current) return;
        const raw = constrained(
            {
                x: current.x - drag.startPoint.x,
                y: current.y - drag.startPoint.y,
                z: current.z - drag.startPoint.z,
            },
            drag.axis,
        );
        delta = {
            x: snapValue(raw.x, editor.snap),
            y: snapValue(raw.y, editor.snap),
            z: snapValue(raw.z, editor.snap),
        };
    }

    if (drag.objectId === "spawn") {
        const spawn: Vec3Tuple = [
            drag.objectPosition.x + delta.x,
            drag.objectPosition.y + delta.y,
            drag.objectPosition.z + delta.z,
        ];
        if (spawn.some((value, index) => value !== level.spawnPosition[index])) {
            syncLevel(world, { ...level, spawnPosition: spawn }, false);
            drag.changed = true;
        }
        return;
    }

    const object = objectFor(level, drag.objectId);
    if (!object) return;
    if (drag.mode === "move") {
        const position: Vec3Tuple = [
            drag.objectPosition.x + delta.x,
            drag.objectPosition.y + delta.y,
            drag.objectPosition.z + delta.z,
        ];
        if (position.some((value, index) => value !== object.transform.position[index])) {
            setObject(world, object.id, { ...object, transform: { ...object.transform, position } });
            drag.changed = true;
        }
        return;
    }

    const cosine = Math.cos(2 * Math.atan2(object.transform.rotation[1], object.transform.rotation[3]));
    const sine = Math.sin(2 * Math.atan2(object.transform.rotation[1], object.transform.rotation[3]));
    const localDelta = {
        x: cosine * delta.x + sine * delta.z,
        y: delta.y,
        z: -sine * delta.x + cosine * delta.z,
    };
    const sizeDelta = constrained(localDelta, drag.axis);
    const displayed: Vec3Tuple = [
        Math.max(MIN_OBJECT_SIZE, drag.objectScale.x + sizeDelta.x),
        Math.max(MIN_OBJECT_SIZE, drag.objectScale.y + sizeDelta.y),
        Math.max(MIN_OBJECT_SIZE, drag.objectScale.z + sizeDelta.z),
    ];
    const scale = authoredScale(object, displayed);
    if (scale.some((value, index) => value !== object.transform.scale[index])) {
        setObject(world, object.id, { ...object, transform: { ...object.transform, scale } });
        drag.changed = true;
    }
}

function finishDrag(world: World): void {
    const editor = world.resource(editorState);
    const drag = editor.dragging;
    if (!drag) return;
    if (drag.changed && !sameLevel(activeLevel(world.resource(runtime)), drag.before)) {
        saveHistory(editor, drag.before);
        setStatus(editor, "");
        refreshMountedUi(world);
    }
    editor.dragging = null;
}

function setProperty(world: World, property: "position" | "scale", axis: 0 | 1 | 2, value: number): void {
    const editor = world.resource(editorState);
    const level = activeLevel(world.resource(runtime));
    if (!Number.isFinite(value) || (property === "scale" && value <= 0)) {
        setStatus(editor, "Invalid value");
        return;
    }
    const before = cloneLevel(level);
    if (editor.selectedId === "spawn") {
        if (property !== "position") return;
        const spawn = [...level.spawnPosition] as [number, number, number];
        spawn[axis] = value;
        changedLevel(world, { ...level, spawnPosition: spawn }, before);
        return;
    }
    const object = selectedObject(world);
    if (!object) return;
    const values = (property === "scale" ? [...displayedScale(object)] : [...object.transform.position]) as [number, number, number];
    values[axis] = value;
    const nextValues = property === "scale"
        ? authoredScale(object, values)
        : values;
    const nextObject: LevelObjectDefinition = {
        ...object,
        transform: { ...object.transform, [property]: nextValues },
    };
    const next: LevelDefinition = {
        ...level,
        objects: level.objects.map((entry) => entry.id === object.id ? nextObject : entry),
    };
    changedLevel(world, next, before);
}

function nextObjectId(level: LevelDefinition, base: string): string {
    const ids = new Set(level.objects.map((object) => object.id));
    let index = 1;
    while (ids.has(`${base}-${index}`)) index++;
    return `${base}-${index}`;
}

function addObject(
    world: World,
    role: LevelMaterial,
    duplicateId?: string,
    modelAsset?: LevelAssetId,
): void {
    const editor = world.resource(editorState);
    const level = activeLevel(world.resource(runtime));
    const source = duplicateId ? objectFor(level, duplicateId) : undefined;
    if (duplicateId && (!source || source.role !== role || role === "goal")) return;
    if (role === "goal" && level.objects.some((object) => object.role === "goal")) {
        setStatus(editor, "This level already has a goal");
        refreshMountedUi(world);
        return;
    }
    const id = nextObjectId(level, role);
    const target = source ?? level.objects.find((object) => object.role === role) ??
        level.objects.find((object) => object.role === "platform");
    const position: Vec3Tuple = target
        ? [target.transform.position[0] + 2, target.transform.position[1] + (source ? 0 : 1.5), target.transform.position[2]]
        : [level.spawnPosition[0] + 2, level.spawnPosition[1], level.spawnPosition[2]];
    const object: LevelObjectDefinition = source
        ? {
              ...structuredClone(source),
              id,
              transform: {
                  ...source.transform,
                  position,
              },
          }
        : role === "ground"
          ? {
                id,
                role,
                transform: {
                    position,
                    rotation: [0, 0, 0, 1],
                    scale: [28, 1, 24],
                },
                visual: { kind: "box", material: "ground" },
                collision: { kind: "box", dimensions: [1, 1, 1] },
            }
          : role === "platform" && modelAsset
            ? {
                  id,
                  role,
                  transform: {
                      position,
                      rotation: [0, 0, 0, 1],
                      scale: [3, 0.4, 3],
                  },
                  visual: { kind: "gltf", asset: modelAsset },
                  collision: { kind: "box", dimensions: [1, 1, 1] },
              }
            : role === "platform"
              ? {
                    id,
                    role,
                    transform: {
                        position,
                        rotation: [0, 0, 0, 1],
                        scale: [3, 0.4, 3],
                    },
                    visual: { kind: "box", material: "platform" },
                  collision: { kind: "box", dimensions: [1, 1, 1] },
              }
            : role === "goal"
              ? {
                    id,
                    role,
                    transform: {
                        position,
                        rotation: [0, 0, 0, 1],
                        scale: [1.8, 2.4, 1.8],
                    },
                    visual: { kind: "box", material: "goal" },
                    collision: { kind: "trigger-box", dimensions: [1, 1, 1] },
                }
          : {
                id,
                role: "checkpoint",
                transform: {
                    position,
                    rotation: [0, 0, 0, 1],
                    scale: [1.2, 1.8, 1.2],
                },
                visual: { kind: "box", material: "checkpoint" },
                collision: { kind: "trigger-box", dimensions: [1, 1, 1] },
            };
    const before = cloneLevel(level);
    const next = { ...level, objects: [...level.objects, object] };
    changedLevel(world, next, before);
    select(world, id);
    setStatus(editor, "");
    refreshMountedUi(world);
}

function duplicateSelected(world: World): void {
    const editor = world.resource(editorState);
    const object = editor.selectedId
        ? objectFor(activeLevel(world.resource(runtime)), editor.selectedId)
        : undefined;
    if (object && (object.role === "platform" || object.role === "checkpoint"))
        addObject(world, object.role, editor.selectedId ?? undefined);
}

function deleteSelected(world: World): void {
    const editor = world.resource(editorState);
    const level = activeLevel(world.resource(runtime));
    const object = editor.selectedId ? objectFor(level, editor.selectedId) : undefined;
    if (!object || object.role === "ground") return;
    const before = cloneLevel(level);
    const next = { ...level, objects: level.objects.filter((entry) => entry.id !== object.id) };
    removeOutline(world, editor.selectedId);
    editor.selectedId = null;
    changedLevel(world, next, before);
    setStatus(editor, "");
    refreshMountedUi(world);
}

function setFailureBoundary(world: World, value: number): void {
    const editor = world.resource(editorState);
    const level = activeLevel(world.resource(runtime));
    const checkpointBelowBoundary = level.objects.some(
        (object) => object.role === "checkpoint" && object.transform.position[1] <= value,
    );
    if (!Number.isFinite(value) || value >= level.spawnPosition[1] || checkpointBelowBoundary) {
        setStatus(editor, "Failure boundary must be below the spawn and checkpoint positions");
        refreshMountedUi(world);
        return;
    }
    changedLevel(world, { ...level, failureBoundaryY: value }, cloneLevel(level));
}

function focusSelection(world: World): void {
    const editor = world.resource(editorState);
    const level = activeLevel(world.resource(runtime));
    const id = editor.selectedId;
    const object = id === "spawn" ? undefined : id ? objectFor(level, id) : undefined;
    const target = object
        ? point(object.transform.position)
        : id === "spawn" ? point(level.spawnPosition) : undefined;
    if (!target) return;
    const direction = cameraForward(editor);
    const distance = 8;
    editor.cameraPosition = {
        x: target.x - direction.x * distance,
        y: target.y - direction.y * distance,
        z: target.z - direction.z * distance,
    };
}

async function refreshLevelIds(editor: EditorState): Promise<void> {
    try {
        const response = await fetch("/__editor/levels");
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const value: unknown = await response.json();
        if (!Array.isArray(value) || !value.every((id) => typeof id === "string"))
            throw new Error("The level list response is invalid");
        editor.levelIds = value;
        editor.refreshUi = true;
    } catch (error) {
        setStatus(editor, `Could not read project levels: ${error instanceof Error ? error.message : String(error)}`);
    }
}

async function refreshModelIds(editor: EditorState): Promise<void> {
    try {
        const response = await fetch("/__editor/models");
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const value: unknown = await response.json();
        if (
            !Array.isArray(value) ||
            !value.every((id) => typeof id === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(id))
        )
            throw new Error("The model list response is invalid");
        editor.modelIds = value;
        editor.refreshUi = true;
    } catch (error) {
        setStatus(editor, `Could not read project models: ${error instanceof Error ? error.message : String(error)}`);
    }
}

function confirmDiscard(editor: EditorState, level: LevelDefinition): boolean {
    return !dirty(editor, level) || window.confirm(`Discard unsaved changes to "${level.id}"?`);
}

async function loadProjectLevel(world: World, id: string): Promise<void> {
    const editor = world.resource(editorState);
    const current = activeLevel(world.resource(runtime));
    if (!confirmDiscard(editor, current)) return;
    try {
        const level = await loadLevel(id);
        select(world, null);
        replaceLevel(world, level);
        resetGameplayToSpawn(world);
        editor.undo.length = 0;
        editor.redo.length = 0;
        editor.saved = cloneLevel(level);
        setStatus(editor, "");
        await refreshLevelIds(editor);
        refreshMountedUi(world);
    } catch (error) {
        setStatus(editor, error instanceof Error ? error.message : String(error));
        refreshMountedUi(world);
    }
}

function createLevel(world: World, id: string): void {
    const editor = world.resource(editorState);
    const current = activeLevel(world.resource(runtime));
    const normalizedId = id.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]*$/.test(normalizedId)) {
        setStatus(editor, "Level id must use lowercase letters, numbers, and hyphens");
        refreshMountedUi(world);
        return;
    }
    if (editor.levelIds.includes(normalizedId)) {
        setStatus(editor, `Level "${normalizedId}" already exists`);
        refreshMountedUi(world);
        return;
    }
    if (!confirmDiscard(editor, current)) return;
    const level: LevelDefinition = {
        id: normalizedId,
        spawnPosition: [0, 2, 0],
        failureBoundaryY: -8,
        objects: [
            {
                id: "ground",
                role: "ground",
                transform: { position: [0, -0.5, 0], rotation: [0, 0, 0, 1], scale: [28, 1, 24] },
                visual: { kind: "box", material: "ground" },
                collision: { kind: "box", dimensions: [1, 1, 1] },
            },
        ],
    };
    select(world, null);
    replaceLevel(world, level);
    editor.undo.length = 0;
    editor.redo.length = 0;
    editor.saved = undefined;
    setStatus(editor, "");
    refreshMountedUi(world);
}

async function saveProjectLevel(world: World): Promise<void> {
    const editor = world.resource(editorState);
    let level: LevelDefinition;
    try {
        level = parseLevelDefinition(cloneLevel(activeLevel(world.resource(runtime))));
    } catch (error) {
        setStatus(editor, `Invalid level: ${error instanceof Error ? error.message : String(error)}`);
        return;
    }
    const exists = editor.levelIds.includes(level.id);
    if (exists && !window.confirm(`Overwrite public/levels/${level.id}.json?`)) return;
    try {
        const response = await fetch(`/__editor/levels/${encodeURIComponent(level.id)}`, {
            method: "PUT",
            headers: {
                "content-type": "application/json",
                "x-level-operation": exists ? "overwrite" : "create",
            },
            body: JSON.stringify(level, null, 2),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(typeof result.error === "string" ? result.error : `HTTP ${response.status}`);
        editor.saved = cloneLevel(level);
        if (!editor.levelIds.includes(level.id)) editor.levelIds.push(level.id);
        setStatus(editor, "");
        refreshMountedUi(world);
    } catch (error) {
        setStatus(editor, `Save failed: ${error instanceof Error ? error.message : String(error)}`);
        refreshMountedUi(world);
    }
}

async function importModelFile(world: World, file: File): Promise<void> {
    const editor = world.resource(editorState);
    if (!file.name.toLowerCase().endsWith(".glb")) {
        setStatus(editor, "Choose a .glb file");
        refreshMountedUi(world);
        return;
    }
    if (file.size === 0 || file.size > 64 * 1024 * 1024) {
        setStatus(editor, "Model file must be between 1 byte and 64 MB");
        refreshMountedUi(world);
        return;
    }

    setStatus(editor, `Importing ${file.name}`);
    refreshMountedUi(world);
    try {
        const gltf = await loadModelFile(world, file);
        const response = await fetch("/__editor/models", {
            method: "POST",
            headers: { "content-type": "application/octet-stream" },
            body: file,
        });
        const result: unknown = await response.json().catch(() => undefined);
        if (!response.ok) {
            const message =
                typeof result === "object" && result !== null && "error" in result &&
                typeof result.error === "string"
                    ? result.error
                    : `HTTP ${response.status}`;
            throw new Error(message);
        }
        const asset =
            typeof result === "object" && result !== null && "asset" in result &&
            typeof result.asset === "string"
                ? result.asset
                : undefined;
        if (!asset || !/^[a-z0-9][a-z0-9-]*$/.test(asset))
            throw new Error("The model import response is invalid");
        cacheLevelAsset(world, asset, gltf);
        addObject(world, "platform", undefined, asset);
        await refreshModelIds(editor);
        setStatus(editor, `Loaded ${file.name}`);
    } catch (error) {
        setStatus(editor, `Model import failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    refreshMountedUi(world);
}

async function addProjectModel(world: World, asset: LevelAssetId): Promise<void> {
    const editor = world.resource(editorState);
    setStatus(editor, `Loading ${asset}`);
    refreshMountedUi(world);
    try {
        await loadLevelAsset(world, asset);
        addObject(world, "platform", undefined, asset);
        setStatus(editor, `Loaded ${asset}`);
    } catch (error) {
        setStatus(editor, `Model load failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    refreshMountedUi(world);
}

function isTextEntryFocused(): boolean {
    const active = document.activeElement;
    return active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || active instanceof HTMLSelectElement;
}

function handleEditorKeys(world: World, editor: EditorState): void {
    const devices = world.resource(Devices);
    if (!devices.enabled) return;
    const keys = devices.keys;
    if (keys.pressed.has("F2")) {
        setMode(world, isEditing(editor) ? "play" : "edit");
        return;
    }
    if (!isEditing(editor) || isTextEntryFocused()) return;
    const control = keys.held.has("ControlLeft") || keys.held.has("ControlRight") || keys.held.has("MetaLeft") || keys.held.has("MetaRight");
    if (control && keys.pressed.has("KeyZ")) {
        if (keys.held.has("ShiftLeft") || keys.held.has("ShiftRight")) redo(world);
        else undo(world);
        return;
    }
    if (control && keys.pressed.has("KeyY")) {
        redo(world);
        return;
    }
    if (control && keys.pressed.has("KeyD")) {
        duplicateSelected(world);
        return;
    }
    if (keys.pressed.has("Escape")) select(world, null);
    if (keys.pressed.has("Delete") || keys.pressed.has("Backspace")) deleteSelected(world);
    if (keys.pressed.has("KeyP")) addObject(world, "platform");
    if (keys.pressed.has("KeyF")) focusSelection(world);
    if (keys.pressed.has("KeyG")) editor.transformMode = "move";
    if (keys.pressed.has("KeyR")) editor.transformMode = "resize";
    if (keys.pressed.has("Digit1")) editor.transformMode = "move";
    if (keys.pressed.has("Digit2")) editor.transformMode = "resize";
    if (keys.pressed.has("KeyX")) editor.transformAxis = "x";
    if (keys.pressed.has("KeyY")) editor.transformAxis = "y";
    if (keys.pressed.has("KeyZ")) editor.transformAxis = "z";
    if (keys.pressed.has("KeyV")) editor.transformAxis = "free";
    if (keys.pressed.size) editor.refreshUi = true;
}

function handlePointer(world: World, editor: EditorState): void {
    const pointer = world.resource(Devices).pointer;
    if (pointer.right) {
        editor.cameraYaw -= pointer.deltaX * 0.004;
        editor.cameraPitch = Math.max(-1.45, Math.min(1.45, editor.cameraPitch + pointer.deltaY * 0.004));
    }
    if (pointer.scroll !== 0) {
        const forward = cameraForward(editor);
        const distance = pointer.scroll * 0.03;
        editor.cameraPosition.x -= forward.x * distance;
        editor.cameraPosition.y -= forward.y * distance;
        editor.cameraPosition.z -= forward.z * distance;
    }
    for (const event of pointer.buttonEvents) {
        if (event.button !== "left") continue;
        if (event.pressed) {
            const axis = pickMoveAxisHandle(world, event.x, event.y);
            if (axis) {
                beginAxisDrag(world, axis, event.x, event.y);
                continue;
            }
            const id = pick(world, event.x, event.y);
            select(world, id);
            if (id !== null) beginDrag(world, id, event.x, event.y);
        } else finishDrag(world);
    }
    if (editor.dragging && pointer.left) applyDrag(world, pointer.x, pointer.y);
    else if (editor.dragging && !pointer.left) finishDrag(world);
    editor.previousPointerX = pointer.x;
    editor.previousPointerY = pointer.y;
}

function moveEditorCamera(world: World, editor: EditorState): void {
    if (!isEditing(editor)) return;
    const devices = world.resource(Devices);
    if (!devices.enabled || isTextEntryFocused()) return;
    const held = devices.keys.held;
    const rightInput = Number(held.has("KeyD")) - Number(held.has("KeyA"));
    const forwardInput = Number(held.has("KeyW")) - Number(held.has("KeyS"));
    const verticalInput = Number(held.has("Space")) - Number(held.has("KeyC"));
    const length = Math.hypot(rightInput, forwardInput, verticalInput) || 1;
    const speed = editor.cameraSpeed * (held.has("ShiftLeft") || held.has("ShiftRight") ? 3 : 1);
    const delta = (world.time.deltaTime * speed) / length;
    const cosine = Math.cos(editor.cameraYaw);
    const sine = Math.sin(editor.cameraYaw);
    editor.cameraPosition.x += (cosine * rightInput - sine * forwardInput) * delta;
    editor.cameraPosition.y += verticalInput * delta;
    editor.cameraPosition.z += (-sine * rightInput - cosine * forwardInput) * delta;
}

const EditorInput = {
    name: "FPP2EditorInput",
    group: "setup" as const,
    update(world: World): void {
        const editor = world.resource(editorState);
        if (!editor.available) return;
        handleEditorKeys(world, editor);
        if (!isEditing(editor)) return;
        handlePointer(world, editor);
        moveEditorCamera(world, editor);
    },
};

const EditorCameraPose = {
    name: "FPP2EditorCameraPose",
    group: "simulation" as const,
    update(world: World): void {
        const editor = world.resource(editorState);
        updateMoveAxisHandles(world, editor);
        if (!isEditing(editor)) return;
        const position = editor.cameraPosition;
        const forward = cameraForward(editor);
        world.storage(Transform).translation.set(editor.camera, position.x, position.y, position.z);
        world.storage(Transform).rotation.set(
            editor.camera,
            ...lookAtRotation(
                position.x,
                position.y,
                position.z,
                position.x + forward.x,
                position.y + forward.y,
                position.z + forward.z,
            ),
        );
    },
};

function initializeMoveAxisHandles(world: World, editor: EditorState): void {
    editor.moveAxisArrowMesh = world.resource(Meshes).add({
        name: "editor-move-axis-arrow",
        ...arrowMeshData(),
    });
    const colors = [
        { color: [0.95, 0.12, 0.12, 1] as const, emissive: [0.26, 0.015, 0.015] as const },
        { color: [0.18, 0.9, 0.2, 1] as const, emissive: [0.02, 0.22, 0.025] as const },
        { color: [0.16, 0.38, 1, 1] as const, emissive: [0.015, 0.055, 0.3] as const },
    ];
    const transform = world.storage(Transform);
    for (let index = 0; index < MOVE_AXES.length; index++) {
        const material = world.resource(Materials).add(
            StandardMaterial({
                baseColor: colors[index]!.color,
                emissive: colors[index]!.emissive,
                perceptualRoughness: 0.55,
            }),
        );
        const shaft = world.create();
        world.add(shaft, Transform, { scale: [0, 0, 0] });
        world.add(shaft, MeshInstance);
        world.add(shaft, MeshMaterial, material);
        editor.moveAxisShafts[index] = shaft;

        const head = world.create();
        world.add(head, Transform, { scale: [0, 0, 0] });
        world.add(head, MeshInstance, { mesh: editor.moveAxisArrowMesh });
        world.add(head, MeshMaterial, material);
        editor.moveAxisHeads[index] = head;
        transform.scale.set(shaft, 0, 0, 0);
        transform.scale.set(head, 0, 0, 0);
    }
}

const EDITOR_STYLE = `
#fpp2-editor{position:fixed;z-index:20;top:8px;left:8px;width:min(300px,calc(100vw - 16px));max-height:calc(100vh - 16px);overflow:auto;color:#ddd;background:#161616f2;font:12px/1.35 system-ui,sans-serif;pointer-events:none}
#fpp2-editor[data-mode=play]{display:none}
#fpp2-editor *{box-sizing:border-box}#fpp2-editor .editor-header,#fpp2-editor .editor-content{padding:8px;pointer-events:auto}
#fpp2-editor .editor-header{display:flex;align-items:center;gap:8px}
#fpp2-editor .editor-level{color:#aaa;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}
#fpp2-editor .editor-content{display:grid;gap:8px}#fpp2-editor[data-mode=play] .editor-content{display:none}
#fpp2-editor .editor-section{display:grid;grid-template-columns:minmax(0,1fr);gap:5px}
#fpp2-editor .editor-title{grid-column:1/-1;color:#aaa}
#fpp2-editor .editor-row{display:flex;gap:5px;align-items:center}#fpp2-editor .editor-row>label{flex:1;min-width:0}
#fpp2-editor label{display:grid;gap:2px;color:#bbb}#fpp2-editor .editor-fields{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:5px}
#fpp2-editor textarea{width:100%;min-height:64px;background:#202020;color:#eee;font:inherit}
#fpp2-editor input,#fpp2-editor select{width:100%;min-width:0;height:27px;border:0;background:#202020;color:#eee;padding:3px 5px;font:inherit}
#fpp2-editor button{min-height:27px;border:0;background:#292929;color:#eee;padding:3px 7px;font:inherit;cursor:pointer}
#fpp2-editor button:hover:not(:disabled){background:#383838}#fpp2-editor button:disabled{opacity:.45;cursor:default}
#fpp2-editor .editor-actions{display:flex;gap:5px;flex-wrap:wrap}
#fpp2-editor .editor-status{grid-column:1/-1;color:#aaa;overflow-wrap:anywhere}
#fpp2-editor .editor-error{color:#f0a0a0}#fpp2-editor .editor-object{color:#eee;overflow-wrap:anywhere}
#fpp2-editor [data-properties]{display:grid;gap:6px}
#fpp2-editor .editor-property-group{display:grid;gap:4px}
`;

function button(root: HTMLElement, action: string): HTMLButtonElement {
    const element = root.querySelector<HTMLButtonElement>(`[data-action="${action}"]`);
    if (!element) throw new Error(`Editor button "${action}" is missing`);
    return element;
}

function numericField(
    world: World,
    label: string,
    property: "position" | "scale",
    axis: 0 | 1 | 2,
    value: number,
): HTMLLabelElement {
    const field = document.createElement("label");
    field.textContent = label;
    const input = document.createElement("input");
    input.type = "number";
    input.step = "0.01";
    input.value = String(value);
    input.dataset.property = property;
    input.dataset.axis = String(axis);
    if (property === "scale") input.min = String(MIN_OBJECT_SIZE);
    input.addEventListener("change", () => {
        const parsed = Number(input.value);
        setProperty(world, property, axis, parsed);
        refreshMountedUi(world);
    });
    field.append(input);
    return field;
}

export function setSurfaceProperty(world: World, value: unknown): void {
    const object = selectedObject(world);
    if (!object || (object.role !== "ground" && object.role !== "platform")) return;
    const editor = world.resource(editorState);
    try {
        const surface = parseAuthoredSurface(value);
        const level = activeLevel(world.resource(runtime));
        changedLevel(world, { ...level, objects: level.objects.map(entry => entry.id === object.id ? { ...object, surface } : entry) }, cloneLevel(level));
        refreshMountedUi(world);
    } catch (error) {
        setStatus(editor, error instanceof Error ? error.message : String(error));
        refreshMountedUi(world);
    }
}

export function setPlatformBehavior(world: World, key: "motion" | "crumble", value: unknown): void {
    const object = selectedObject(world);
    if (object?.role !== "platform") return;
    const editor = world.resource(editorState);
    try {
        const level = activeLevel(world.resource(runtime));
        const changed = { ...object };
        delete changed[key];
        const candidate = value === undefined ? changed : { ...changed, [key]: value };
        const next = parseLevelDefinition({ ...level, objects: level.objects.map(entry => entry.id === object.id ? candidate : entry) });
        changedLevel(world, next, cloneLevel(level));
    } catch (error) {
        setStatus(editor, error instanceof Error ? error.message : String(error));
    }
    refreshMountedUi(world);
}

function platformBehaviorFields(world: World, panel: HTMLElement, object: Extract<LevelObjectDefinition, { role: "platform" }>): void {
    const field = (label: string, element: HTMLElement) => {
        const wrapper = document.createElement("label");
        wrapper.textContent = label;
        wrapper.append(element);
        panel.append(wrapper);
    };
    const motion = document.createElement("select");
    motion.dataset.platformMotion = "";
    motion.append(new Option("Stationary", "off"), new Option("Loop", "loop"), new Option("Ping-pong", "ping-pong"));
    motion.value = object.motion?.mode ?? "off";
    motion.addEventListener("change", () => setPlatformBehavior(world, "motion", motion.value === "off" ? undefined : {
        path: [[0, 0, 0], [3, 0, 0]], duration: 3, phase: 0, ...object.motion, mode: motion.value,
    }));
    field("Motion", motion);
    const numberField = (label: string, key: string, value: number | undefined, apply: (value: number | undefined) => void) => {
        const input = document.createElement("input");
        input.type = "number"; input.step = "any"; input.min = "0";
        input.dataset.platformProperty = key;
        input.value = value === undefined ? "" : String(value);
        input.addEventListener("change", () => apply(input.value.trim() === "" ? undefined : Number(input.value)));
        field(label, input);
    };
    if (object.motion) {
        const config = object.motion;
        const path = document.createElement("textarea");
        path.dataset.platformProperty = "path";
        path.value = JSON.stringify(config.path);
        path.addEventListener("change", () => {
            try { setPlatformBehavior(world, "motion", { ...config, path: JSON.parse(path.value) }); }
            catch { setStatus(world.resource(editorState), "Path offsets must be a JSON array of [x, y, z] points"); refreshMountedUi(world); }
        });
        field("Path offsets (m, JSON; first point [0,0,0])", path);
        numberField("Traversal duration (s)", "duration", config.duration, value => setPlatformBehavior(world, "motion", { ...config, duration: value }));
        numberField("Cycle phase (0 to less than 1)", "phase", config.phase, value => setPlatformBehavior(world, "motion", { ...config, phase: value }));
    }
    const crumble = document.createElement("select");
    crumble.dataset.platformCrumble = "";
    crumble.append(new Option("Permanent platform", "off"), new Option("Crumble after landing", "on"));
    crumble.value = object.crumble ? "on" : "off";
    crumble.addEventListener("change", () => setPlatformBehavior(world, "crumble", crumble.value === "off" ? undefined : { delay: 0.5 }));
    field("Lifetime", crumble);
    if (object.crumble) {
        const config = object.crumble;
        numberField("Collapse delay (s)", "delay", config.delay, value => setPlatformBehavior(world, "crumble", { ...config, delay: value }));
        numberField("Return delay (s, blank for no return)", "returnDelay", config.returnDelay, value => setPlatformBehavior(world, "crumble", value === undefined ? { delay: config.delay } : { ...config, returnDelay: value }));
    }
}

function renderProperties(world: World, root: HTMLElement): void {
    const editor = world.resource(editorState);
    const level = activeLevel(world.resource(runtime));
    const panel = root.querySelector<HTMLElement>("[data-properties]");
    if (!panel) throw new Error("Editor properties panel is missing");
    const active = document.activeElement;
    if ((active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) && (active.dataset.property || active.dataset.surfaceCoefficient || active.dataset.surfaceDirection || active.dataset.platformProperty)) return;
    panel.replaceChildren();
    if (!editor.selectedId) {
        const note = document.createElement("div");
        note.className = "editor-object";
        note.textContent = "No selection";
        panel.append(note);
        return;
    }
    const heading = document.createElement("div");
    heading.className = "editor-object";
    if (editor.selectedId === "spawn") {
        heading.textContent = "Spawn";
        panel.append(heading);
        const position = document.createElement("div");
        position.className = "editor-property-group";
        position.innerHTML = "<span class=editor-title>Position</span>";
        const fields = document.createElement("div");
        fields.className = "editor-fields";
        fields.append(
            numericField(world, "X", "position", 0, level.spawnPosition[0]),
            numericField(world, "Y", "position", 1, level.spawnPosition[1]),
            numericField(world, "Z", "position", 2, level.spawnPosition[2]),
        );
        position.append(fields);
        panel.append(position);
        return;
    }
    const object = objectFor(level, editor.selectedId);
    if (!object) return;
    heading.textContent = `${object.id} · ${object.role}`;
    panel.append(heading);
    if (object.role === "platform") {
        platformBehaviorFields(world, panel, object);
        const label = document.createElement("label");
        label.textContent = "Collision";
        const select = document.createElement("select");
        select.dataset.collisionMode = "";
        select.append(new Option("Solid", "solid"), new Option("One-way (land from above)", "one-way"));
        select.value = object.collision.mode ?? "solid";
        select.addEventListener("change", () => {
            const level = activeLevel(world.resource(runtime));
            const mode = select.value as "solid" | "one-way";
            changedLevel(world, { ...level, objects: level.objects.map(entry => entry.id === object.id
                ? { ...object, collision: { ...object.collision, mode } } : entry) }, cloneLevel(level));
            refreshMountedUi(world);
        });
        label.append(select);
        panel.append(label);
    }
    if (object.role === "ground" || object.role === "platform") {
        const overlaps = overlappingLevelSurfaces(level).filter(pair => pair.includes(object.id));
        if (overlaps.length) {
            const diagnostic = document.createElement("div");
            diagnostic.textContent = `Ambiguous equal-height surfaces: ${overlaps.map(pair => pair.join(" / ")).join(", ")}`;
            panel.append(diagnostic);
        }
        const label = document.createElement("label");
        label.textContent = "Surface profile";
        const select = document.createElement("select");
        select.dataset.surfaceProfile = "";
        for (const profile of Object.keys(SURFACE_PROFILES)) {
            const option = document.createElement("option");
            option.value = option.textContent = profile;
            select.append(option);
        }
        select.value = object.surface?.profile ?? "default";
        select.addEventListener("change", () => setSurfaceProperty(world, select.value === "directional" ? { profile: select.value, directionXZ: [1, 0] } : { profile: select.value }));
        label.append(select);
        panel.append(label);
        const authored = object.surface ?? { profile: "default" as const };
        const response = resolveSurface(authored);
        const preset: SurfaceResponse = SURFACE_PROFILES[authored.profile];
        const coefficientFields: {
            key: "bounceScale" | "restitution" | "impactSpeedLimit" | "momentumRetention" |
                "traction" | "contactDrag" | "minimumDwell" | "directionalSpeed" |
                "maximumVerticalSpeed" | "chargeScale";
            label: string;
            maximum?: number;
        }[] = [
            { key: "bounceScale", label: "Bounce strength (multiplier)" },
            { key: "restitution", label: "Impact rebound (0–1)", maximum: 1 },
            { key: "impactSpeedLimit", label: "Impact speed limit (m/s)" },
            { key: "momentumRetention", label: "Momentum retained (0–1)", maximum: 1 },
            { key: "traction", label: "Traction (0–1)", maximum: 1 },
            { key: "contactDrag", label: "Contact drag (1/s)" },
            { key: "minimumDwell", label: "Minimum contact time (s)", maximum: 0.3 },
            ...(authored.profile === "directional" ? [{ key: "directionalSpeed" as const, label: "Directional speed (m/s)" }] : []),
            { key: "maximumVerticalSpeed", label: "Vertical speed limit (m/s, blank for none)" },
            { key: "chargeScale", label: "Charge multiplier (0–1)", maximum: 1 },
        ];
        const holdLabel = document.createElement("label");
        holdLabel.textContent = "Hold mode";
        const holdSelect = document.createElement("select");
        for (const mode of ["bounded", "until-release"] as const) holdSelect.add(new Option(mode, mode));
        holdSelect.value = response.holdMode;
        holdSelect.addEventListener("change", () => {
            const overrides: SurfaceOverrides = { ...authored.overrides };
            if (holdSelect.value === preset.holdMode) delete overrides.holdMode;
            else overrides.holdMode = holdSelect.value as "bounded" | "until-release";
            setSurfaceProperty(world, { ...authored, overrides });
        });
        holdLabel.append(holdSelect);
        panel.append(holdLabel);
        for (const { key, label, maximum } of coefficientFields) {
            const field = document.createElement("label");
            field.textContent = label;
            const input = document.createElement("input");
            input.type = "number";
            input.step = "any";
            input.min = "0";
            if (maximum !== undefined) input.max = String(maximum);
            input.value = response[key] === undefined ? "" : String(response[key]);
            input.dataset.surfaceCoefficient = key;
            input.addEventListener("change", () => {
                const overrides: SurfaceOverrides = { ...authored.overrides };
                const value = input.value.trim() === "" ? (key === "maximumVerticalSpeed" ? null : NaN) : Number(input.value);
                if (value === preset[key] || (value === null && preset[key] === undefined)) delete overrides[key];
                else if (key === "maximumVerticalSpeed") overrides.maximumVerticalSpeed = value;
                else overrides[key] = value as number;
                setSurfaceProperty(world, { ...authored, overrides });
            });
            field.append(input);
            panel.append(field);
        }
        const reset = document.createElement("button");
        reset.textContent = "Reset surface values";
        reset.disabled = authored.overrides === undefined;
        reset.addEventListener("click", () => {
            const { overrides, ...presetSurface } = authored;
            setSurfaceProperty(world, presetSurface);
        });
        panel.append(reset);
        if (object.surface?.profile === "directional") {
            const direction = object.surface.directionXZ;
            for (const [axis, name] of ["X", "Z"].entries()) {
                const field = document.createElement("label");
                field.textContent = `Local direction ${name}`;
                const input = document.createElement("input");
                input.type = "number";
                input.step = "0.1";
                input.value = String(direction[axis]);
                input.dataset.surfaceDirection = name;
                input.addEventListener("change", () => {
                    const next = [...direction];
                    next[axis] = Number(input.value);
                    setSurfaceProperty(world, { ...authored, directionXZ: next });
                });
                field.append(input);
                panel.append(field);
            }
        }
    }
    const position = document.createElement("div");
    position.className = "editor-property-group";
    position.innerHTML = "<span class=editor-title>Position</span>";
    const positionFields = document.createElement("div");
    positionFields.className = "editor-fields";
    positionFields.append(
        numericField(world, "X", "position", 0, object.transform.position[0]),
        numericField(world, "Y", "position", 1, object.transform.position[1]),
        numericField(world, "Z", "position", 2, object.transform.position[2]),
    );
    position.append(positionFields);
    panel.append(position);
    const size = document.createElement("div");
    size.className = "editor-property-group";
    size.innerHTML = "<span class=editor-title>Size</span>";
    const sizeFields = document.createElement("div");
    sizeFields.className = "editor-fields";
    sizeFields.append(
        numericField(world, "Width", "scale", 0, displayedScale(object)[0]),
        numericField(world, "Height", "scale", 1, displayedScale(object)[1]),
        numericField(world, "Depth", "scale", 2, displayedScale(object)[2]),
    );
    size.append(sizeFields);
    panel.append(size);
}

function refreshUi(world: World, root: HTMLElement): void {
    const editor = world.resource(editorState);
    const level = activeLevel(world.resource(runtime));
    root.dataset.mode = editor.mode;
    const sim = world.resource(runtime).sim;
    root.querySelector<HTMLElement>("[data-debug]")!.textContent =
        `${sim.pogo.state} | tick ${sim.tick} | speed ${Math.hypot(sim.body.vel.x, sim.body.vel.y, sim.body.vel.z).toFixed(2)} m/s | pole ${sim.pole.length.toFixed(2)} m | surface ${world.resource(surfaceDiagnostics).acceptedProfile ?? "none"}${sim.pogo.pendingLaunch ? " | release pending" : ""}`;
    root.querySelector<HTMLElement>("[data-mode-label]")!.textContent = editor.mode === "edit" ? "Edit" : "Play";
    button(root, "toggle").textContent = editor.mode === "edit" ? "Play" : "Edit";
    root.querySelector<HTMLElement>("[data-level-name]")!.textContent = level.id;
    const status = root.querySelector<HTMLElement>("[data-status]")!;
    status.textContent = editor.status || (dirty(editor, level) ? "Unsaved" : "Saved");
    status.classList.toggle("editor-error", editor.status !== "");
    const levelSelect = root.querySelector<HTMLSelectElement>("[data-level-select]")!;
    const selectedLevel = levelSelect.value;
    levelSelect.replaceChildren(new Option("Choose level", ""));
    for (const id of editor.levelIds) levelSelect.add(new Option(id, id));
    levelSelect.value = editor.levelIds.includes(selectedLevel) ? selectedLevel : level.id;
    root.querySelector<HTMLSelectElement>("[data-tool]")!.value = editor.transformMode;
    root.querySelector<HTMLSelectElement>("[data-axis]")!.value = editor.transformAxis;
    const modelSelect = root.querySelector<HTMLSelectElement>("[data-model-select]")!;
    const selectedModel = modelSelect.value;
    modelSelect.replaceChildren(new Option("Select model", ""));
    for (const asset of editor.modelIds) modelSelect.add(new Option(asset, asset));
    modelSelect.value = editor.modelIds.includes(selectedModel) ? selectedModel : "";
    root.querySelector<HTMLSelectElement>("[data-snap]")!.value = String(editor.snap);
    root.querySelector<HTMLInputElement>("[data-speed]")!.value = String(editor.cameraSpeed);
    root.querySelector<HTMLInputElement>("[data-failure-boundary]")!.value = String(level.failureBoundaryY);
    button(root, "undo").disabled = editor.undo.length === 0;
    button(root, "redo").disabled = editor.redo.length === 0;
    const selected = selectedObject(world);
    const duplicateable = selected?.role === "platform" || selected?.role === "checkpoint";
    const deletable = selected !== undefined && selected.role !== "ground";
    button(root, "duplicate").disabled = !duplicateable;
    button(root, "delete").disabled = !deletable;
    for (const action of ["create-platform", "create-model", "open-model", "refresh-models", "add-project-model", "create-goal", "create-checkpoint"])
        button(root, action).disabled = editor.mode !== "edit";
    button(root, "add-project-model").disabled = editor.mode !== "edit" || modelSelect.value === "";
    button(root, "new").disabled = editor.mode !== "edit";
    button(root, "save").disabled = editor.mode !== "edit" || !dirty(editor, level);
    for (const control of root.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(".editor-content input,.editor-content select,.editor-content textarea"))
        control.disabled = editor.mode !== "edit";
    button(root, "load").disabled = editor.mode !== "edit";
    renderProperties(world, root);
    editor.refreshUi = false;
}

function refreshMountedUi(world: World): void {
    const root = document.getElementById("fpp2-editor");
    if (root) refreshUi(world, root);
}

function mountEditorUi(world: World): HTMLElement {
    const root = document.createElement("aside");
    root.id = "fpp2-editor";
    root.innerHTML = `<style>${EDITOR_STYLE}</style>
      <header class="editor-header"><span data-mode-label></span><span class="editor-level" data-level-name></span><button data-action="toggle">Play</button></header>
      <div class="editor-content">
        <section class="editor-section" data-debug></section>
        <section class="editor-section" data-panel="level">
          <span class="editor-title">Level</span>
          <div class="editor-row"><select aria-label="Level" data-level-select></select><button data-action="load">Load</button></div>
          <div class="editor-row"><input aria-label="New level ID" data-new-id placeholder="New ID"><button data-action="new">New</button><button data-action="save">Save</button></div>
          <label>Fail below Y<input data-failure-boundary type="number" step="0.5"></label>
        </section>
        <section class="editor-section" data-panel="objects">
          <span class="editor-title">Objects</span>
          <div class="editor-actions"><button data-action="create-platform">Add platform</button><button data-action="create-model">Add sample model</button><button data-action="open-model">Open GLB</button><button data-action="create-goal">Add goal</button><button data-action="create-checkpoint">Add checkpoint</button></div>
          <div class="editor-row"><select aria-label="Project model" data-model-select></select><button data-action="refresh-models">Refresh</button></div>
          <div class="editor-actions"><button data-action="add-project-model">Add selected model</button></div>
          <div class="editor-actions"><button data-action="duplicate">Duplicate</button><button data-action="delete">Delete</button></div>
          <div class="editor-actions"><button data-action="undo">Undo</button><button data-action="redo">Redo</button></div>
        </section>
        <section class="editor-section" data-panel="transform">
          <span class="editor-title">Transform</span>
          <div class="editor-row"><label>Tool<select data-tool><option value="move">Move</option><option value="resize">Resize</option></select></label><label>Axis<select data-axis><option value="free">Free</option><option value="x">X</option><option value="y">Y</option><option value="z">Z</option></select></label></div>
          <div class="editor-row"><label>Snap<select data-snap></select></label><label>Speed<input data-speed type="number" min="0.1" step="0.5"></label></div>
        </section>
        <section class="editor-section" data-panel="properties">
          <span class="editor-title">Properties</span>
          <div data-properties></div>
        </section>
        <div class="editor-status" data-status></div>
      </div>`;
    for (const snap of SNAP_STEPS) {
        const option = new Option(snap === 0 ? "Off" : `${snap} m`, String(snap));
        root.querySelector("[data-snap]")!.append(option);
    }
    root.querySelector<HTMLSelectElement>("[data-snap]")!.value = "0.5";
    const modelFileInput = document.createElement("input");
    modelFileInput.type = "file";
    modelFileInput.accept = ".glb,model/gltf-binary";
    modelFileInput.hidden = true;
    root.append(modelFileInput);
    button(root, "toggle").addEventListener("click", () => {
        const editor = world.resource(editorState);
        setMode(world, isEditing(editor) ? "play" : "edit");
    });
    button(root, "create-platform").addEventListener("click", () => addObject(world, "platform"));
    button(root, "create-model").addEventListener("click", () =>
        addObject(world, "platform", undefined, "sample-platform"),
    );
    button(root, "open-model").addEventListener("click", () => modelFileInput.click());
    root.querySelector<HTMLSelectElement>("[data-model-select]")!.addEventListener("change", () => {
        world.resource(editorState).refreshUi = true;
    });
    button(root, "refresh-models").addEventListener("click", () => {
        const editor = world.resource(editorState);
        void refreshModelIds(editor).then(() => refreshMountedUi(world));
    });
    button(root, "add-project-model").addEventListener("click", () => {
        const asset = root.querySelector<HTMLSelectElement>("[data-model-select]")!.value;
        if (asset) void addProjectModel(world, asset);
    });
    modelFileInput.addEventListener("change", () => {
        const file = modelFileInput.files?.[0];
        modelFileInput.value = "";
        if (file) void importModelFile(world, file);
    });
    button(root, "create-goal").addEventListener("click", () => addObject(world, "goal"));
    button(root, "create-checkpoint").addEventListener("click", () => addObject(world, "checkpoint"));
    button(root, "duplicate").addEventListener("click", () => duplicateSelected(world));
    button(root, "delete").addEventListener("click", () => deleteSelected(world));
    button(root, "undo").addEventListener("click", () => undo(world));
    button(root, "redo").addEventListener("click", () => redo(world));
    button(root, "save").addEventListener("click", () => void saveProjectLevel(world));
    button(root, "load").addEventListener("click", () => {
        const id = root.querySelector<HTMLSelectElement>("[data-level-select]")!.value;
        if (id) void loadProjectLevel(world, id);
    });
    button(root, "new").addEventListener("click", () => {
        const input = root.querySelector<HTMLInputElement>("[data-new-id]")!;
        createLevel(world, input.value);
    });
    root.querySelector<HTMLSelectElement>("[data-tool]")!.addEventListener("change", (event) => {
        world.resource(editorState).transformMode = (event.currentTarget as HTMLSelectElement).value as "move" | "resize";
    });
    root.querySelector<HTMLSelectElement>("[data-axis]")!.addEventListener("change", (event) => {
        world.resource(editorState).transformAxis = (event.currentTarget as HTMLSelectElement).value as TransformAxis;
    });
    root.querySelector<HTMLSelectElement>("[data-snap]")!.addEventListener("change", (event) => {
        world.resource(editorState).snap = Number((event.currentTarget as HTMLSelectElement).value);
    });
    root.querySelector<HTMLInputElement>("[data-speed]")!.addEventListener("change", (event) => {
        const value = Number((event.currentTarget as HTMLInputElement).value);
        if (Number.isFinite(value) && value > 0) world.resource(editorState).cameraSpeed = value;
        world.resource(editorState).refreshUi = true;
    });
    root.querySelector<HTMLInputElement>("[data-failure-boundary]")!.addEventListener("change", (event) => {
        setFailureBoundary(world, Number((event.currentTarget as HTMLInputElement).value));
        refreshMountedUi(world);
    });
    const canvas = document.querySelector("canvas");
    const blurEditorControl = (event: PointerEvent): void => {
        if (event.target !== canvas) return;
        const active = document.activeElement;
        if (active instanceof HTMLElement && root.contains(active)) active.blur();
    };
    canvas?.addEventListener("pointerdown", blurEditorControl, true);
    world.onDispose(() => canvas?.removeEventListener("pointerdown", blurEditorControl, true));
    const overlay = mountOverlay(canvas, world);
    overlay.append(root);
    return root;
}

const EditorUi = {
    name: "FPP2EditorUi",
    group: "draw" as const,
    update(world: World): void {
        const editor = world.resource(editorState);
        if (!editor.available || !editor.refreshUi) return;
        const root = document.getElementById("fpp2-editor");
        if (root) refreshUi(world, root);
    },
};

export function initializeEditor(
    world: World,
    materials: Record<LevelMaterial, MaterialHandle>,
): void {
    const editor = world.resource(editorState);
    const level = activeLevel(world.resource(runtime));
    editor.available = true;
    editor.materials = materials;
    editor.saved = cloneLevel(level);
    editor.levelIds = [level.id];
    editor.camera = world.create();
    world.add(editor.camera, Transform, {
        translation: [editor.cameraPosition.x, editor.cameraPosition.y, editor.cameraPosition.z],
    });
    world.add(editor.camera, StandardRenderer);
    initializeMoveAxisHandles(world, editor);
    const spawnMarkerMaterial = world.resource(Materials).add(
        StandardMaterial({
            baseColor: [0.98, 0.72, 0.16, 1],
            emissive: [0.55, 0.23, 0.015],
            perceptualRoughness: 0.45,
        }),
    );
    editor.spawnMarker = world.create();
    world.add(editor.spawnMarker, Transform, {
        translation: [level.spawnPosition[0], level.spawnPosition[1] + 0.55, level.spawnPosition[2]],
        scale: [0, 0, 0],
    });
    world.add(editor.spawnMarker, MeshInstance);
    world.add(editor.spawnMarker, MeshMaterial, spawnMarkerMaterial);
    editor.failureMarker = world.create();
    world.add(editor.failureMarker, Transform, {
        translation: [0, level.failureBoundaryY, 0],
        scale: [0, 0, 0],
    });
    world.add(editor.failureMarker, MeshInstance);
    world.add(
        editor.failureMarker,
        MeshMaterial,
        world.resource(Materials).add(
            StandardMaterial({
                baseColor: [0.75, 0.2, 0.16, 1],
                emissive: [0.12, 0.01, 0.01],
                perceptualRoughness: 0.8,
            }),
        ),
    );
    const root = mountEditorUi(world);
    world.addSystem(EditorInput);
    world.addSystem(EditorCameraPose);
    world.addSystem(EditorUi);
    world.onDispose(() => {
        world.removeSystem(EditorInput);
        world.removeSystem(EditorCameraPose);
        world.removeSystem(EditorUi);
        root.remove();
        if (world.has(editor.spawnMarker, Outline)) world.remove(editor.spawnMarker, Outline);
        if (world.has(editor.failureMarker, Outline)) world.remove(editor.failureMarker, Outline);
    });
    void refreshLevelIds(editor);
    void refreshModelIds(editor);
    refreshUi(world, root);
    if (new URLSearchParams(window.location.search).get("editor") === "1") {
        editor.mode = "play";
        setMode(world, "edit");
        updateSelectionOutline(world);
    }
}
