import { expect, test } from "bun:test";
import { readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { CAMPAIGN_STAGES, campaignControlEnabled } from "../src/content/campaign";
import { parseLevelDefinition } from "../src/content/level";
import { validateCampaignContent } from "../src/content/campaign-validation";
import { campaignLevelForStart, completeCampaignLevel, freshCampaignSave, migrateLegacyCampaignSave, parseCampaignSave, readCampaignSession, unlockedCampaignIds, writeCampaignSession, CAMPAIGN_SAVE_KEY, LEGACY_SAVE_KEY } from "../src/game/campaign-progress";

const original = ["first-level", "charge-course", "pole-length", "elastic-surface", "grip-surface", "directional-surface", "ice-surface"];

test("campaign content uses taught behaviors, ordered sections and safe reset supports", async () => {
    const levels = new Map();
    for (const stage of CAMPAIGN_STAGES) {
        const url = new URL(`../public/levels/${stage.id}.json`, import.meta.url);
        expect((await stat(url)).size).toBeLessThanOrEqual(256 * 1024);
        levels.set(stage.id, parseLevelDefinition(JSON.parse(await readFile(url, "utf8"))));
    }
    validateCampaignContent(levels, id => existsSync(new URL(`../public/models/${id}.glb`, import.meta.url)));
    const first = levels.get(CAMPAIGN_STAGES[0]!.id);
    first.objects = first.objects.filter((object: { role: string }) => object.role !== "goal");
    expect(() => validateCampaignContent(levels, () => true)).toThrow("expected one goal");
    expect(campaignControlEnabled("first-level", "charge")).toBe(false);
    expect(campaignControlEnabled("charge-course", "pole-length")).toBe(false);
    expect(campaignControlEnabled("prototype", "pole-length")).toBe(true);
});

test("fresh completion and final completion persist by identity without granting prerequisites", () => {
    let save = freshCampaignSave();
    expect(unlockedCampaignIds(save)).toEqual([CAMPAIGN_STAGES[0]!.id]);
    const final = CAMPAIGN_STAGES.at(-1)!.id;
    save = completeCampaignLevel(save, final);
    expect(save.completedLevelIds).toContain(final);
    expect(unlockedCampaignIds(save)).toHaveLength(1);
    for (const stage of CAMPAIGN_STAGES) save = completeCampaignLevel(save, stage.id);
    expect(unlockedCampaignIds(save)).toHaveLength(CAMPAIGN_STAGES.length);
    expect(completeCampaignLevel(save, final)).toBe(save);
    expect(parseCampaignSave(JSON.stringify(save))).toEqual(save);
});

test("legacy migration uses the frozen original order and preserves access across insertions", () => {
    for (let count = 1; count <= original.length; count++) {
        const save = migrateLegacyCampaignSave(String(count));
        const accessible = original.slice(0, count).findLast(id => CAMPAIGN_STAGES.some(stage => stage.id === id))!;
        expect(save.lastSelectedLevelId).toBe(accessible);
        expect(unlockedCampaignIds(save)).toContain(accessible);
        if (accessible === original[count - 1]) expect(save.completedLevelIds).not.toContain(accessible);
        expect(save.completedLevelIds.every(id => CAMPAIGN_STAGES.some(stage => stage.id === id))).toBe(true);
        expect(save.completedLevelIds).not.toContain(original.at(-1)!);
        expect(campaignLevelForStart(null, save, false)).toBe(accessible);
    }
    expect(migrateLegacyCampaignSave("999").lastSelectedLevelId).toBe(original.at(-1)!);
    for (const input of [null, "bad", "0", "-1", "1.5", "999999999999999999999999"]) expect(migrateLegacyCampaignSave(input)).toEqual(freshCampaignSave());
});

test("save boundary rejects malformed versions and retains known identities across reorder", () => {
    for (const value of [null, "{", "null", "[]", '{}', JSON.stringify({ ...freshCampaignSave(), version: 2 }), JSON.stringify({ ...freshCampaignSave(), completedLevelIds: [2] })]) expect(parseCampaignSave(value)).toBeUndefined();
    const save = completeCampaignLevel(freshCampaignSave(), "charge-course");
    const reordered = [...CAMPAIGN_STAGES].reverse();
    const parsed = parseCampaignSave(JSON.stringify({ ...save, completedLevelIds: ["removed", "charge-course", "charge-course"], lastSelectedLevelId: "removed" }), reordered)!;
    expect(parsed.completedLevelIds).toEqual(["charge-course"]);
    expect(parsed.lastSelectedLevelId).toBeNull();
    expect(unlockedCampaignIds(parsed, reordered)).toEqual([reordered[0]!.id]);
});

test("selection shares unlock rules and retains replay and development navigation", () => {
    const save = completeCampaignLevel(freshCampaignSave(), CAMPAIGN_STAGES[0]!.id);
    expect(campaignLevelForStart(null, save, false)).toBe(CAMPAIGN_STAGES[1]!.id);
    expect(campaignLevelForStart("ice-surface", save, false)).toBe(CAMPAIGN_STAGES[1]!.id);
    expect(campaignLevelForStart("first-level", save, false)).toBe("first-level");
    expect(campaignLevelForStart("prototype", save, false)).toBe(CAMPAIGN_STAGES[1]!.id);
    expect(campaignLevelForStart("ice-surface", save, true)).toBe("ice-surface");
    expect(campaignLevelForStart(null, { ...save, lastSelectedLevelId: "first-level" }, false)).toBe("first-level");
});

test("storage failure preserves session progress and the legacy key until a successful write", () => {
    const values = new Map([[LEGACY_SAVE_KEY, "7"]]);
    let fail = true;
    const storage = { getItem: (key: string) => values.get(key) ?? null, removeItem: (key: string) => { values.delete(key); }, setItem: (key: string, value: string) => { if (fail) throw new Error("unavailable"); values.set(key, value); } };
    const session = readCampaignSession(storage);
    expect(session.save.lastSelectedLevelId).toBe("ice-surface");
    expect(session.persistenceFailure).toContain("session only");
    expect(values.has(LEGACY_SAVE_KEY)).toBe(true);
    session.save = completeCampaignLevel(session.save, "ice-surface");
    fail = false;
    expect(writeCampaignSession(session, storage)).toBe(true);
    expect(values.has(LEGACY_SAVE_KEY)).toBe(false);
    expect(parseCampaignSave(values.get(CAMPAIGN_SAVE_KEY)!)).toEqual(session.save);
    const unavailable = readCampaignSession({ ...storage, getItem: () => { throw new Error("unavailable"); } });
    expect(unavailable.save).toEqual(freshCampaignSave());
    expect(unavailable.persistenceFailure).not.toBe("");
});
