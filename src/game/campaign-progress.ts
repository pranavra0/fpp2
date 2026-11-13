import type { Resource, World } from "@dylanebert/shallot";
import { CAMPAIGN_REVISION, CAMPAIGN_STAGES, type CampaignStage } from "../content/campaign";
import { gameplayProgress } from "./gameplay-state";
import { activeLevel, runtime } from "./state";
import { editorState, isEditing } from "./editor-state";

export const CAMPAIGN_SAVE_KEY = "fpp2.campaign.progress";
export const LEGACY_SAVE_KEY = "fpp2.campaign.unlocked-stage-count";
const ORIGINAL_IDS = ["first-level", "charge-course", "pole-length", "elastic-surface", "grip-surface", "directional-surface", "ice-surface"] as const;
export type CampaignSave = {
    version: 1;
    campaignRevision: number;
    completedLevelIds: string[];
    lastSelectedLevelId: string | null;
};

export function freshCampaignSave(): CampaignSave {
    return { version: 1, campaignRevision: CAMPAIGN_REVISION, completedLevelIds: [], lastSelectedLevelId: null };
}

export function parseCampaignSave(value: string | null, stages = CAMPAIGN_STAGES): CampaignSave | undefined {
    if (value === null) return undefined;
    try {
        const data = JSON.parse(value);
        if (data === null || typeof data !== "object" || data.version !== 1 ||
            !Number.isSafeInteger(data.campaignRevision) || data.campaignRevision < 1 ||
            !Array.isArray(data.completedLevelIds) || data.completedLevelIds.some((id: unknown) => typeof id !== "string") ||
            (data.lastSelectedLevelId !== null && typeof data.lastSelectedLevelId !== "string")) return undefined;
        const ids = new Set(stages.map(stage => stage.id));
        return { version: 1, campaignRevision: CAMPAIGN_REVISION,
            completedLevelIds: [...new Set<string>(data.completedLevelIds)].filter(id => ids.has(id)),
            lastSelectedLevelId: ids.has(data.lastSelectedLevelId) ? data.lastSelectedLevelId : null };
    } catch { return undefined; }
}

export function unlockedCampaignIds(save: CampaignSave, stages: readonly CampaignStage[] = CAMPAIGN_STAGES): string[] {
    if (!stages.length || new Set(stages.map(stage => stage.id)).size !== stages.length) throw new Error("Invalid campaign order");
    const completed = new Set(save.completedLevelIds);
    const ids: string[] = [];
    for (const stage of stages) {
        ids.push(stage.id);
        if (!completed.has(stage.id)) break;
    }
    return ids;
}

export function migrateLegacyCampaignSave(value: string | null): CampaignSave {
    const save = freshCampaignSave();
    if (value === null || !/^\d+$/.test(value)) return save;
    const count = Number(value);
    if (!Number.isSafeInteger(count) || count < 1) return save;
    const legacyIndex = Math.min(count, ORIGINAL_IDS.length) - 1;
    const knownIds = new Set(CAMPAIGN_STAGES.map(stage => stage.id));
    const accessible = ORIGINAL_IDS.slice(0, legacyIndex + 1).findLast(id => knownIds.has(id));
    const index = accessible === undefined ? -1 : CAMPAIGN_STAGES.findIndex(stage => stage.id === accessible);
    save.completedLevelIds = [...new Set([
        ...CAMPAIGN_STAGES.slice(0, index < 0 ? 0 : index).map(stage => stage.id),
        ...ORIGINAL_IDS.slice(0, legacyIndex).filter(id => knownIds.has(id)),
    ])];
    save.lastSelectedLevelId = accessible ?? null;
    return save;
}

export function completeCampaignLevel(save: CampaignSave, id: string): CampaignSave {
    if (!CAMPAIGN_STAGES.some(stage => stage.id === id) || save.completedLevelIds.includes(id)) return save;
    return { ...save, completedLevelIds: [...save.completedLevelIds, id] };
}

export function campaignLevelForStart(requestedId: string | null, save: CampaignSave, development: boolean): string {
    const unlocked = unlockedCampaignIds(save);
    const fallback = save.lastSelectedLevelId && unlocked.includes(save.lastSelectedLevelId)
        ? save.lastSelectedLevelId : unlocked.at(-1)!;
    if (requestedId === null) return fallback;
    return development || unlocked.includes(requestedId) ? requestedId : fallback;
}

type StorageBoundary = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type CampaignSession = { save: CampaignSave; persistenceFailure: string; recordedLevelId: string | null };
export const campaignSession: Resource<CampaignSession> = {
    create: () => ({ save: freshCampaignSave(), persistenceFailure: "", recordedLevelId: null }),
};

export function writeCampaignSession(session: CampaignSession, storage: StorageBoundary): boolean {
    try {
        storage.setItem(CAMPAIGN_SAVE_KEY, JSON.stringify(session.save));
        storage.removeItem(LEGACY_SAVE_KEY);
        session.persistenceFailure = "";
        return true;
    } catch {
        session.persistenceFailure = "Progress could not be saved. Progress is available for this session only.";
        return false;
    }
}

export function readCampaignSession(storage: StorageBoundary): CampaignSession {
    const session: CampaignSession = { save: freshCampaignSave(), persistenceFailure: "", recordedLevelId: null };
    try {
        const current = storage.getItem(CAMPAIGN_SAVE_KEY);
        session.save = parseCampaignSave(current) ?? migrateLegacyCampaignSave(storage.getItem(LEGACY_SAVE_KEY));
        if (current !== null || storage.getItem(LEGACY_SAVE_KEY) !== null) writeCampaignSession(session, storage);
    } catch { session.persistenceFailure = "Progress could not be loaded. Progress is available for this session only."; }
    return session;
}

export function persistBrowserCampaignSession(session: CampaignSession): void {
    try { writeCampaignSession(session, window.localStorage); }
    catch { session.persistenceFailure = "Progress could not be saved. Progress is available for this session only."; }
}

// Persistence runs outside fixed-state replay so restoring a snapshot cannot write saves.
export const PersistCampaignCompletion = {
    name: "PersistCampaignCompletion",
    group: "draw" as const,
    update(world: World): void {
        if (isEditing(world.resource(editorState))) return;
        const session = world.resource(campaignSession);
        const id = activeLevel(world.resource(runtime)).id;
        if (world.resource(gameplayProgress).mode !== "complete") {
            session.recordedLevelId = null;
            return;
        }
        if (session.recordedLevelId === id) return;
        session.recordedLevelId = id;
        const next = completeCampaignLevel(session.save, id);
        if (next === session.save) return;
        session.save = next;
        persistBrowserCampaignSession(session);
    },
};
