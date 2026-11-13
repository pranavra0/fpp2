import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import {
    CAMPAIGN_STAGES,
    campaignControlEnabled,
    campaignLevelForStart,
    campaignStage,
    nextCampaignStage,
    unlockedCampaignStageCount,
} from "../src/content/campaign";
import { parseLevelDefinition } from "../src/content/level";

test("campaign lessons add one mechanic at a time and keep earlier controls", () => {
    expect(CAMPAIGN_STAGES.map((stage) => stage.newMechanic)).toEqual([
        "WASD steering",
        "Charging",
        "Pole extension and retraction",
        "Elastic platforms",
        "Grip platforms",
        "Directional launches",
        "Ice",
    ]);
    expect(campaignControlEnabled("first-level", "steering")).toBe(true);
    expect(campaignControlEnabled("first-level", "charge")).toBe(false);
    expect(campaignControlEnabled("first-level", "pole-length")).toBe(false);
    expect(campaignControlEnabled("charge-course", "charge")).toBe(true);
    expect(campaignControlEnabled("charge-course", "pole-length")).toBe(false);
    expect(campaignControlEnabled("pole-length", "charge")).toBe(true);
    expect(campaignControlEnabled("pole-length", "pole-length")).toBe(true);
    expect(campaignControlEnabled("prototype", "pole-length")).toBe(true);
    for (let index = 1; index < CAMPAIGN_STAGES.length; index++) {
        expect(CAMPAIGN_STAGES[index]!.mechanics.length).toBe(index + 1);
        expect(CAMPAIGN_STAGES[index]!.mechanics.slice(0, index)).toEqual(
            CAMPAIGN_STAGES[index - 1]!.mechanics,
        );
    }
});

test("campaign start resumes the latest unlocked lesson and blocks locked lessons outside development", () => {
    expect(unlockedCampaignStageCount(null)).toBe(1);
    expect(unlockedCampaignStageCount("invalid")).toBe(1);
    expect(unlockedCampaignStageCount("999")).toBe(CAMPAIGN_STAGES.length);
    expect(campaignLevelForStart(null, 1, false)).toBe("first-level");
    expect(campaignLevelForStart(null, 3, false)).toBe("pole-length");
    expect(campaignLevelForStart("ice-surface", 2, false)).toBe("charge-course");
    expect(campaignLevelForStart("ice-surface", 2, true)).toBe("ice-surface");
    expect(campaignLevelForStart("prototype", 2, false)).toBe("charge-course");
    expect(campaignLevelForStart("prototype", 2, true)).toBe("prototype");
    expect(() => campaignLevelForStart(null, 0, false)).toThrow("Invalid unlocked campaign stage count");
    expect(campaignStage("directional-surface")?.newMechanic).toBe("Directional launches");
    expect(nextCampaignStage("charge-course")?.id).toBe("pole-length");
    expect(nextCampaignStage("ice-surface")).toBeUndefined();
});

test("campaign levels parse and introduce their authored surface profiles in order", async () => {
    const expectedProfiles = [
        ["default"],
        ["default"],
        ["default"],
        ["default", "elastic"],
        ["default", "grip"],
        ["default", "directional"],
        ["default", "ice"],
    ];
    for (const [index, stage] of CAMPAIGN_STAGES.entries()) {
        const text = await readFile(new URL(`../public/levels/${stage.id}.json`, import.meta.url), "utf8");
        const level = parseLevelDefinition(JSON.parse(text));
        expect(level.id).toBe(stage.id);
        const profiles = new Set(level.objects.flatMap((object) =>
            "surface" in object ? [object.surface?.profile ?? "default"] : object.role === "ground" || object.role === "platform" ? ["default"] : [],
        ));
        expect([...profiles].sort()).toEqual(expectedProfiles[index]!.sort());
        expect(level.objects.some((object) => object.role === "goal")).toBe(true);
    }
});
