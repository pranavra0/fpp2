import { type Resource } from "@dylanebert/shallot";
import type { MaterialHandle } from "@dylanebert/shallot/standard/rendering";
import type { LevelDefinition } from "../content/level";
import type { Vec3 } from "../vec";

export type EditorMode = "play" | "edit";
export type TransformMode = "move" | "resize";
export type TransformAxis = "free" | "x" | "y" | "z";

export type EditorDrag = {
    objectId: string;
    mode: TransformMode;
    axis: TransformAxis;
    startPoint: Vec3;
    planeNormal: Vec3;
    objectPosition: Vec3;
    objectScale: Vec3;
    before: LevelDefinition;
    changed: boolean;
};

export type CameraSettings = {
    mode: number;
    fov: number;
    near: number;
    far: number;
    size: number;
    clearColor: number;
    antialias: number;
    order: number;
};

export type EditorState = {
    available: boolean;
    mode: EditorMode;
    camera: number;
    gameCameraSettings: CameraSettings | undefined;
    editorCameraSettings: CameraSettings;
    cameraPosition: Vec3;
    cameraYaw: number;
    cameraPitch: number;
    cameraSpeed: number;
    selectedId: string | null;
    transformMode: TransformMode;
    transformAxis: TransformAxis;
    snap: number;
    dragging: EditorDrag | null;
    spawnMarker: number;
    materials: Record<"ground" | "platform", MaterialHandle> | undefined;
    outlineColor: number;
    undo: LevelDefinition[];
    redo: LevelDefinition[];
    saved: LevelDefinition | undefined;
    levelIds: string[];
    status: string;
    refreshUi: boolean;
    previousPointerX: number;
    previousPointerY: number;
};

export const editorState: Resource<EditorState> = {
    create: () => ({
        available: false,
        mode: "play",
        camera: 0,
        gameCameraSettings: undefined,
        editorCameraSettings: {
            mode: 0,
            fov: 55,
            near: 0.1,
            far: 300,
            size: 5,
            clearColor: 0x101827,
            antialias: 1,
            order: 0,
        },
        cameraPosition: { x: 0, y: 8, z: 12 },
        cameraYaw: 0,
        cameraPitch: 0.45,
        cameraSpeed: 8,
        selectedId: null,
        transformMode: "move",
        transformAxis: "free",
        snap: 0.5,
        dragging: null,
        spawnMarker: 0,
        materials: undefined,
        outlineColor: 0xffed7c,
        undo: [],
        redo: [],
        saved: undefined,
        levelIds: [],
        status: "",
        refreshUi: true,
        previousPointerX: 0,
        previousPointerY: 0,
    }),
};

export function isEditing(state: EditorState): boolean {
    return state.available && state.mode === "edit";
}
