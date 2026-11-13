import { mountSlopeProperty } from "./editor-properties";
import { editorState } from "./editor-state";
import type { World } from "@dylanebert/shallot";
import { overlappingLevelSurfaces, type LevelDefinition, type LevelObjectDefinition } from "../content/level";
import { resolveSurface, SURFACE_PROFILES, type SurfaceOverrides, type SurfaceResponse } from "../surfaces";

export interface InspectorActions {
    level(): LevelDefinition;
    change(next: LevelDefinition): void;
    setProperty(property: "position" | "scale", axis: 0 | 1 | 2, value: number): void;
    setSurface(value: unknown): void;
    setPlatformBehavior(key: "motion" | "crumble", value: unknown): void;
    setError(message: string): void;
    refresh(): void;
}

const MIN_OBJECT_SIZE = 0.1;

function objectFor(level: LevelDefinition, id: string): LevelObjectDefinition | undefined {
    return level.objects.find((object) => object.id === id);
}

function displayedScale(object: LevelObjectDefinition): readonly number[] {
    if (object.collision.kind !== "trigger-box") return object.transform.scale;
    return [object.transform.scale[0] * object.collision.dimensions[0], object.transform.scale[1] * object.collision.dimensions[1], object.transform.scale[2] * object.collision.dimensions[2]];
}

function numericField(
    actions: InspectorActions,
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
        actions.setProperty(property, axis, parsed);
        actions.refresh();
    });
    field.append(input);
    return field;
}

function platformBehaviorFields(actions: InspectorActions, panel: HTMLElement, object: Extract<LevelObjectDefinition, { role: "platform" }>): void {
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
    motion.addEventListener("change", () => actions.setPlatformBehavior("motion", motion.value === "off" ? undefined : {
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
            try { actions.setPlatformBehavior("motion", { ...config, path: JSON.parse(path.value) }); }
            catch { actions.setError("Path offsets must be a JSON array of [x, y, z] points"); actions.refresh(); }
        });
        field("Path offsets (m, JSON; first point [0,0,0])", path);
        numberField("Traversal duration (s)", "duration", config.duration, value => actions.setPlatformBehavior("motion", { ...config, duration: value }));
        numberField("Cycle phase (0 to less than 1)", "phase", config.phase, value => actions.setPlatformBehavior("motion", { ...config, phase: value }));
    }
    const crumble = document.createElement("select");
    crumble.dataset.platformCrumble = "";
    crumble.append(new Option("Permanent platform", "off"), new Option("Crumble after landing", "on"));
    crumble.value = object.crumble ? "on" : "off";
    crumble.addEventListener("change", () => actions.setPlatformBehavior("crumble", crumble.value === "off" ? undefined : { delay: 0.5 }));
    field("Lifetime", crumble);
    if (object.crumble) {
        const config = object.crumble;
        numberField("Collapse delay (s)", "delay", config.delay, value => actions.setPlatformBehavior("crumble", { ...config, delay: value }));
        numberField("Return delay (s, blank for no return)", "returnDelay", config.returnDelay, value => actions.setPlatformBehavior("crumble", value === undefined ? { delay: config.delay } : { ...config, returnDelay: value }));
    }
}


export function renderEditorInspector(world: World, root: HTMLElement, actions: InspectorActions): void {
    const editor = world.resource(editorState);
    const level = actions.level();
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
            numericField(actions, "X", "position", 0, level.spawnPosition[0]),
            numericField(actions, "Y", "position", 1, level.spawnPosition[1]),
            numericField(actions, "Z", "position", 2, level.spawnPosition[2]),
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
        platformBehaviorFields(actions, panel, object);
        mountSlopeProperty(panel, object, collision => {
            const level = actions.level();
            try { actions.change({ ...level, objects: level.objects.map(entry => entry.id === object.id ? { ...object, collision } : entry) }); }
            catch (error) { actions.setError(error instanceof Error ? error.message : String(error)); }
            actions.refresh();
        });
        const label = document.createElement("label");
        label.textContent = "Collision";
        const select = document.createElement("select");
        select.dataset.collisionMode = "";
        select.append(new Option("Solid", "solid"), new Option("One-way (land from above)", "one-way"));
        select.value = object.collision.mode ?? "solid";
        select.addEventListener("change", () => {
            const level = actions.level();
            const mode = select.value as "solid" | "one-way";
            actions.change({ ...level, objects: level.objects.map(entry => entry.id === object.id
                ? { ...object, collision: { ...object.collision, mode } } : entry) });
            actions.refresh();
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
        select.addEventListener("change", () => actions.setSurface({ profile: select.value as keyof typeof SURFACE_PROFILES,
            ...(object.surface?.directionXZ ? { directionXZ: object.surface.directionXZ } : {}),
            ...(object.surface?.overrides ? { overrides: object.surface.overrides } : {}),
            ...(select.value === "directional" && !object.surface?.directionXZ ? { directionXZ: [1, 0] as const } : {}) }));
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
            { key: "directionalSpeed" as const, label: "Directional speed (m/s)" },
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
            actions.setSurface({ ...authored, overrides });
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
                actions.setSurface({ ...authored, ...(key === "directionalSpeed" && value !== null && Number(value) > 0 && !authored.directionXZ ? { directionXZ: [1, 0] as const } : {}), overrides });
            });
            field.append(input);
            panel.append(field);
        }
        const reset = document.createElement("button");
        reset.textContent = "Reset surface values";
        reset.disabled = authored.overrides === undefined;
        reset.addEventListener("click", () => {
            const { overrides, ...presetSurface } = authored;
            actions.setSurface(presetSurface);
        });
        panel.append(reset);
        if (response.directionalSpeed > 0) {
            const direction = object.surface?.directionXZ ?? [1, 0];
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
                    actions.setSurface({ ...authored, directionXZ: next });
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
        numericField(actions, "X", "position", 0, object.transform.position[0]),
        numericField(actions, "Y", "position", 1, object.transform.position[1]),
        numericField(actions, "Z", "position", 2, object.transform.position[2]),
    );
    position.append(positionFields);
    panel.append(position);
    const size = document.createElement("div");
    size.className = "editor-property-group";
    size.innerHTML = "<span class=editor-title>Size</span>";
    const sizeFields = document.createElement("div");
    sizeFields.className = "editor-fields";
    sizeFields.append(
        numericField(actions, "Width", "scale", 0, displayedScale(object)[0]),
        numericField(actions, "Height", "scale", 1, displayedScale(object)[1]),
        numericField(actions, "Depth", "scale", 2, displayedScale(object)[2]),
    );
    size.append(sizeFields);
    panel.append(size);
}
