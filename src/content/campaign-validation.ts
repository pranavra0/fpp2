import { CAMPAIGN_STAGES, type CampaignControl, type CampaignMechanic, type CampaignStage } from "./campaign";
import { levelSurfaceContains, levelSurfaces, overlappingLevelSurfaces, type LevelDefinition, type Vec3Tuple } from "./level";
import { DEFAULT_TUNING, PLAYER_TRIGGER_CAPSULE_HEIGHT_M } from "../config/gameplay";

function requireValid(condition: boolean, message: string): asserts condition {
    if (!condition) throw new Error(`Invalid campaign: ${message}`);
}

export function validateCampaign(stages: readonly CampaignStage[], levels: ReadonlyMap<string, LevelDefinition>, assetExists: (id: string) => boolean): string[] {
    requireValid(stages.length > 0, "empty order");
    const ids = new Set<string>(), taught = new Set<CampaignMechanic>(), controls = new Set<CampaignControl>();
    const diagnostics: string[] = [];
    for (const stage of stages) {
        requireValid(/^[a-z0-9][a-z0-9-]*$/.test(stage.id) && !ids.has(stage.id), `duplicate or invalid id ${stage.id}`);
        ids.add(stage.id);
        requireValid(stage.chapterId === undefined || /^[a-z0-9][a-z0-9-]*$/.test(stage.chapterId), `invalid chapter ${stage.chapterId}`);
        if (stage.introduces) {
            requireValid(!taught.has(stage.introduces), `repeated introduction ${stage.introduces}`);
            taught.add(stage.introduces);
        }
        for (const control of controls) requireValid(stage.enabledControls.includes(control), `disabled prior control ${control}`);
        requireValid(new Set(stage.enabledControls).size === stage.enabledControls.length, `duplicate controls ${stage.id}`);
        for (const control of stage.enabledControls) {
            requireValid(taught.has(control), `untaught control ${control}`);
            controls.add(control);
        }
        for (const skill of stage.practices ?? []) requireValid(taught.has(skill), `untaught practice ${skill}`);
        const level = levels.get(stage.id);
        requireValid(level !== undefined && level.id === stage.id, `missing or mismatched file ${stage.id}`);
        requireValid(level.objects.filter(object => object.role === "goal").length === 1, `expected one goal in ${stage.id}`);
        requireValid(!!level.sections?.length, `missing sections ${stage.id}`);
        const checkpoints = level.objects.filter(object => object.role === "checkpoint");
        requireValid(checkpoints.length === level.sections.length - 1, `unreferenced checkpoint ${stage.id}`);
        const sectionIds = new Set<string>(), checkpointIds = new Set<string>();
        for (const [index, section] of level.sections.entries()) {
            requireValid(/^[a-z0-9][a-z0-9-]*$/.test(section.id) && !sectionIds.has(section.id), `invalid section ${stage.id}`);
            sectionIds.add(section.id);
            requireValid(section.instruction.trim().length > 0, `missing instruction ${stage.id}`);
            if (index === 0) requireValid(section.checkpointId === null, `missing starting section ${stage.id}`);
            else {
                requireValid(section.checkpointId !== null && !checkpointIds.has(section.checkpointId) && checkpoints.some(object => object.id === section.checkpointId), `invalid checkpoint reference ${stage.id}`);
                checkpointIds.add(section.checkpointId);
            }
        }
        for (const object of level.objects) {
            if (object.visual.kind === "gltf") requireValid(assetExists(object.visual.asset), `missing asset ${object.visual.asset}`);
            if (object.collision.kind === "trigger-box") continue;
            const required: CampaignMechanic[] = [];
            if (object.collision.mode === "one-way") required.push("one-way");
            if (object.collision.kind === "slope") required.push("sloped-ice");
            if (object.role === "platform" && object.motion) required.push("motion");
            if (object.role === "platform" && object.crumble) required.push("crumble");
            if ("surface" in object && object.surface && object.surface.profile !== "default") required.push(`${object.surface.profile}-surface` as CampaignMechanic);
            for (const skill of required) requireValid(taught.has(skill), `untaught geometry ${skill} in ${stage.id}/${object.id}`);
            requireValid(!("surface" in object && object.surface?.overrides), `campaign uses unintroduced surface coefficients in ${stage.id}/${object.id}`);
        }
        for (const position of [level.spawnPosition, ...checkpoints.map(object => object.transform.position)]) validateRespawn(level, position);
        const triggers = level.objects.filter(object => object.collision.kind === "trigger-box");
        for (const [index, a] of triggers.entries()) for (const b of triggers.slice(index + 1)) {
            const separated = [0, 1, 2].some(axis => Math.abs(a.transform.position[axis]! - b.transform.position[axis]!) >
                (a.transform.scale[axis]! * a.collision.dimensions[axis]! + b.transform.scale[axis]! * b.collision.dimensions[axis]!) / 2 + 0.65);
            requireValid(separated, `overlapping progression volumes ${stage.id}/${a.id}/${b.id}`);
        }
        for (const [a, b] of overlappingLevelSurfaces(level)) diagnostics.push(`${stage.id}: overlapping surfaces ${a}, ${b}`);
    }
    return diagnostics;
}

export function validateRespawn(level: LevelDefinition, position: Vec3Tuple): void {
    const surfaces = levelSurfaces(level);
    const support = surfaces.find(surface => {
        const object = level.objects.find(object => object.id === surface.id)!;
        return !(object.role === "platform" && (object.motion || object.crumble)) && surface.grade === 0 &&
            (!("surface" in object) || !object.surface || object.surface.profile === "default" || object.surface.profile === "grip") &&
            levelSurfaceContains(surface, position[0], position[2], -0.5) &&
            position[1] - surface.topY >= DEFAULT_TUNING.POLE_LENGTH_M && position[1] - surface.topY <= 3;
    });
    requireValid(!!support, `unsafe respawn support in ${level.id} at ${position}`);
    const tipY = position[1] - DEFAULT_TUNING.POLE_LENGTH_M;
    for (const surface of surfaces) {
        if (surface.id === support.id || !levelSurfaceContains(surface, position[0], position[2], 0.4)) continue;
        const object = level.objects.find(object => object.id === surface.id)!;
        if (object.collision.kind !== "trigger-box" && object.collision.mode === "one-way") continue;
        const top = surface.topY + Math.abs(surface.grade * surface.width / 2), bottom = surface.topY - surface.height - Math.abs(surface.grade * surface.width / 2);
        requireValid(top < tipY || bottom > position[1] + PLAYER_TRIGGER_CAPSULE_HEIGHT_M / 2, `obstructed respawn in ${level.id}`);
    }
}

export function validateCampaignContent(levels: ReadonlyMap<string, LevelDefinition>, assetExists: (id: string) => boolean): string[] {
    return validateCampaign(CAMPAIGN_STAGES, levels, assetExists);
}
