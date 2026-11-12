import {
    Camera,
    Devices,
    lookAtRotation,
    Materials,
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
import { loadLevel, parseLevelDefinition, type LevelDefinition, type LevelObjectDefinition, type Vec3Tuple } from "../content/level";
import { activeLevel, resetPlayerToSpawn, runtime } from "./state";
import {
    addLevelObjectPhysics,
    destroyLevelEntities,
    updateLevelEntity,
    type LevelEntity,
} from "./physics";
import { addLevelRendering } from "./level-rendering";
import { editorState, isEditing, type CameraSettings, type EditorDrag, type EditorState, type TransformAxis } from "./editor-state";
import { updateLandingMarker, writePose } from "./presentation";
import type { Vec3 } from "../vec";

const HISTORY_LIMIT = 50;
const DRAG_DISTANCE = 100;
const MIN_OBJECT_SIZE = 0.1;
const SNAP_STEPS = [0, 0.25, 0.5, 1] as const;
const HIT = emptyQueryHit();

function cloneLevel(level: LevelDefinition): LevelDefinition {
    return structuredClone(level);
}

function point(position: Vec3Tuple): Vec3 {
    return { x: position[0], y: position[1], z: position[2] };
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
        if (world.has(entity.eid, Outline)) world.remove(entity.eid, Outline);
        destroyLevelEntities(world, [entity]);
    }

    const nextEntities = level.objects.map((object) => {
        const existing = oldById.get(object.id);
        if (existing) {
            if (existing.object !== object) updateLevelEntity(world, existing, object);
            return existing;
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

function removeOutline(world: World, id: string | null): void {
    if (id === null) return;
    const editor = world.resource(editorState);
    const eid = id === "spawn"
        ? editor.spawnMarker
        : entityFor(world.resource(runtime).levelEntities, id)?.eid;
    if (eid && world.has(eid, Outline)) world.remove(eid, Outline);
}

function updateSelectionOutline(world: World): void {
    const editor = world.resource(editorState);
    const id = editor.selectedId;
    if (id === null) return;
    const eid = id === "spawn"
        ? editor.spawnMarker
        : entityFor(world.resource(runtime).levelEntities, id)?.eid;
    if (!eid) return;
    if (world.has(eid, Outline)) {
        world.storage(Outline).color.set(eid, editor.outlineColor);
        world.storage(Outline).width.set(eid, 5);
        world.storage(Outline).occlude.set(eid, 1);
    } else world.add(eid, Outline, { color: editor.outlineColor, width: 5, occlude: 1 });
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
        world.remove(game.camera, Camera);
        world.add(editor.camera, Camera, editor.editorCameraSettings);
        requirePointerLock(world, false);
        releasePointerLock(world);
        hideGameplayVisuals(world);
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
    resetPlayerToSpawn(game);
    writePose(world, game);
    updateLandingMarker(world, game);
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
    const surfaceDistance = hasSurface ? HIT.fraction * DRAG_DISTANCE : Number.POSITIVE_INFINITY;
    if (spawnDistance !== undefined && spawnDistance < surfaceDistance) return "spawn";
    if (!hasSurface) return null;
    return game.levelEntities.find((entity) => entity.eid === HIT.body)?.id ?? null;
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
    const objectScale = object ? point(object.transform.scale) : { x: 1, y: 1, z: 1 };
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
    };
}

function applyDrag(world: World, x: number, y: number): void {
    const editor = world.resource(editorState);
    const drag = editor.dragging;
    if (!drag) return;
    const ray = rayAt(world, x, y);
    if (!ray) return;
    const current = intersectPlane(ray, drag.objectPosition, drag.planeNormal);
    if (!current) return;
    const level = activeLevel(world.resource(runtime));
    const raw = constrained(
        {
            x: current.x - drag.startPoint.x,
            y: current.y - drag.startPoint.y,
            z: current.z - drag.startPoint.z,
        },
        drag.axis,
    );
    const delta = {
        x: snapValue(raw.x, editor.snap),
        y: snapValue(raw.y, editor.snap),
        z: snapValue(raw.z, editor.snap),
    };

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
    const scale: Vec3Tuple = [
        Math.max(MIN_OBJECT_SIZE, drag.objectScale.x + sizeDelta.x),
        Math.max(MIN_OBJECT_SIZE, drag.objectScale.y + sizeDelta.y),
        Math.max(MIN_OBJECT_SIZE, drag.objectScale.z + sizeDelta.z),
    ];
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
    const values = [...object.transform[property]] as [number, number, number];
    values[axis] = value;
    const nextObject: LevelObjectDefinition = {
        ...object,
        transform: { ...object.transform, [property]: values },
    };
    const next: LevelDefinition = {
        ...level,
        objects: level.objects.map((entry) => entry.id === object.id ? nextObject : entry),
    };
    changedLevel(world, next, before);
}

function nextObjectId(level: LevelDefinition, base = "platform"): string {
    const ids = new Set(level.objects.map((object) => object.id));
    let index = 1;
    while (ids.has(`${base}-${index}`)) index++;
    return `${base}-${index}`;
}

function addPlatform(world: World, duplicateId?: string): void {
    const editor = world.resource(editorState);
    const level = activeLevel(world.resource(runtime));
    const source = duplicateId ? objectFor(level, duplicateId) : undefined;
    if (duplicateId && (!source || source.role !== "platform")) return;
    const id = nextObjectId(level);
    const target = source ?? level.objects.find((object) => object.role === "platform");
    const position: Vec3Tuple = target
        ? [target.transform.position[0] + 1, target.transform.position[1] + (source ? 0 : 2), target.transform.position[2]]
        : [level.spawnPosition[0] + 2, level.spawnPosition[1] + 2, level.spawnPosition[2]];
    const platform: LevelObjectDefinition = source
        ? {
              ...structuredClone(source),
              id,
              transform: {
                  ...source.transform,
                  position,
              },
          }
        : {
              id,
              role: "platform",
              transform: { position, rotation: [0, 0, 0, 1], scale: [3, 0.4, 3] },
              visual: { kind: "box", material: "platform" },
              collision: { kind: "box", dimensions: [1, 1, 1] },
          };
    const before = cloneLevel(level);
    const next = { ...level, objects: [...level.objects, platform] };
    changedLevel(world, next, before);
    select(world, id);
    setStatus(editor, "");
    refreshMountedUi(world);
}

function duplicateSelected(world: World): void {
    const editor = world.resource(editorState);
    if (editor.selectedId) addPlatform(world, editor.selectedId);
}

function deleteSelected(world: World): void {
    const editor = world.resource(editorState);
    const level = activeLevel(world.resource(runtime));
    const object = editor.selectedId ? objectFor(level, editor.selectedId) : undefined;
    if (!object || object.role !== "platform") return;
    const before = cloneLevel(level);
    const next = { ...level, objects: level.objects.filter((entry) => entry.id !== object.id) };
    removeOutline(world, editor.selectedId);
    editor.selectedId = null;
    changedLevel(world, next, before);
    setStatus(editor, "");
    refreshMountedUi(world);
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
        formatVersion: 1,
        id: normalizedId,
        spawnPosition: [0, 2, 0],
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
    if (keys.pressed.has("KeyP")) addPlatform(world);
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

const EDITOR_STYLE = `
#fpp2-editor{position:fixed;z-index:20;top:8px;left:8px;width:min(300px,calc(100vw - 16px));max-height:calc(100vh - 16px);overflow:auto;color:#ddd;background:#161616f2;border:1px solid #555;font:12px/1.35 system-ui,sans-serif;pointer-events:none}
#fpp2-editor *{box-sizing:border-box}#fpp2-editor .editor-header,#fpp2-editor .editor-content{padding:8px;pointer-events:auto}
#fpp2-editor .editor-header{display:flex;align-items:center;gap:8px;border-bottom:1px solid #444}
#fpp2-editor .editor-level{color:#aaa;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}
#fpp2-editor .editor-content{display:grid;gap:8px}#fpp2-editor[data-mode=play] .editor-content{display:none}
#fpp2-editor .editor-section{display:grid;grid-template-columns:minmax(0,1fr);gap:5px;padding-top:7px;border-top:1px solid #444}
#fpp2-editor .editor-section:first-child{padding-top:0;border-top:0}
#fpp2-editor .editor-title{grid-column:1/-1;color:#aaa}
#fpp2-editor .editor-row{display:flex;gap:5px;align-items:center}#fpp2-editor .editor-row>label{flex:1;min-width:0}
#fpp2-editor label{display:grid;gap:2px;color:#bbb}#fpp2-editor .editor-fields{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:5px}
#fpp2-editor input,#fpp2-editor select{width:100%;min-width:0;height:27px;border:1px solid #555;background:#202020;color:#eee;padding:3px 5px;font:inherit}
#fpp2-editor button{min-height:27px;border:1px solid #666;background:#292929;color:#eee;padding:3px 7px;font:inherit;cursor:pointer}
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

function renderProperties(world: World, root: HTMLElement): void {
    const editor = world.resource(editorState);
    const level = activeLevel(world.resource(runtime));
    const panel = root.querySelector<HTMLElement>("[data-properties]");
    if (!panel) throw new Error("Editor properties panel is missing");
    const active = document.activeElement;
    if (active instanceof HTMLInputElement && active.dataset.property) return;
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
        numericField(world, "Width", "scale", 0, object.transform.scale[0]),
        numericField(world, "Height", "scale", 1, object.transform.scale[1]),
        numericField(world, "Depth", "scale", 2, object.transform.scale[2]),
    );
    size.append(sizeFields);
    panel.append(size);
}

function refreshUi(world: World, root: HTMLElement): void {
    const editor = world.resource(editorState);
    const level = activeLevel(world.resource(runtime));
    root.dataset.mode = editor.mode;
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
    root.querySelector<HTMLSelectElement>("[data-snap]")!.value = String(editor.snap);
    root.querySelector<HTMLInputElement>("[data-speed]")!.value = String(editor.cameraSpeed);
    button(root, "undo").disabled = editor.undo.length === 0;
    button(root, "redo").disabled = editor.redo.length === 0;
    const selected = selectedObject(world);
    const platformSelected = selected?.role === "platform";
    button(root, "duplicate").disabled = !platformSelected;
    button(root, "delete").disabled = !platformSelected;
    button(root, "create").disabled = editor.mode !== "edit";
    button(root, "new").disabled = editor.mode !== "edit";
    button(root, "save").disabled = editor.mode !== "edit" || !dirty(editor, level);
    for (const control of root.querySelectorAll<HTMLInputElement | HTMLSelectElement>(".editor-content input,.editor-content select"))
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
        <section class="editor-section" data-panel="level">
          <span class="editor-title">Level</span>
          <div class="editor-row"><select aria-label="Level" data-level-select></select><button data-action="load">Load</button></div>
          <div class="editor-row"><input aria-label="New level ID" data-new-id placeholder="New ID"><button data-action="new">New</button><button data-action="save">Save</button></div>
        </section>
        <section class="editor-section" data-panel="objects">
          <span class="editor-title">Objects</span>
          <div class="editor-actions"><button data-action="create">Add platform</button><button data-action="duplicate">Duplicate</button><button data-action="delete">Delete</button></div>
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
    button(root, "toggle").addEventListener("click", () => {
        const editor = world.resource(editorState);
        setMode(world, isEditing(editor) ? "play" : "edit");
    });
    button(root, "create").addEventListener("click", () => addPlatform(world));
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
    materials: Record<"ground" | "platform", MaterialHandle>,
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
        scale: [0.28, 1.1, 0.28],
    });
    world.add(editor.spawnMarker, MeshInstance);
    world.add(editor.spawnMarker, MeshMaterial, spawnMarkerMaterial);
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
    });
    void refreshLevelIds(editor);
    refreshUi(world, root);
    if (new URLSearchParams(window.location.search).get("editor") === "1") {
        editor.mode = "play";
        setMode(world, "edit");
        updateSelectionOutline(world);
    }
}
