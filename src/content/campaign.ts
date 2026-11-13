export type CampaignMechanic =
    | "steering"
    | "charge"
    | "pole-length"
    | "elastic-surface"
    | "grip-surface"
    | "directional-surface"
    | "ice-surface";

export type CampaignStage = {
    id: string;
    title: string;
    newMechanic: string;
    instruction: string;
    mechanics: readonly CampaignMechanic[];
};

export const CAMPAIGN_STAGES: readonly CampaignStage[] = [
    {
        id: "first-level",
        title: "Steering",
        newMechanic: "WASD steering",
        instruction: "Use WASD to steer between platforms. The pogo bounces automatically.",
        mechanics: ["steering"],
    },
    {
        id: "charge-course",
        title: "Charged launches",
        newMechanic: "Charging",
        instruction: "Hold Space during contact to charge, then release for a stronger launch.",
        mechanics: ["steering", "charge"],
    },
    {
        id: "pole-length",
        title: "Pole length",
        newMechanic: "Pole extension and retraction",
        instruction: "Hold E to extend or Q to retract the pole. Adjust it before the tip reaches a platform.",
        mechanics: ["steering", "charge", "pole-length"],
    },
    {
        id: "elastic-surface",
        title: "Elastic platforms",
        newMechanic: "Elastic platforms",
        instruction: "Elastic platforms add rebound. Aim for the next landing after the stronger launch.",
        mechanics: ["steering", "charge", "pole-length", "elastic-surface"],
    },
    {
        id: "grip-surface",
        title: "Grip platforms",
        newMechanic: "Grip platforms",
        instruction: "Grip reduces carried horizontal speed during contact, giving you more time to redirect.",
        mechanics: ["steering", "charge", "pole-length", "elastic-surface", "grip-surface"],
    },
    {
        id: "directional-surface",
        title: "Directional platforms",
        newMechanic: "Directional launches",
        instruction: "The arrow on this platform shows the added launch direction. Steer toward the next landing.",
        mechanics: ["steering", "charge", "pole-length", "elastic-surface", "grip-surface", "directional-surface"],
    },
    {
        id: "ice-surface",
        title: "Ice platforms",
        newMechanic: "Ice",
        instruction: "Ice has low traction during contact. Approach with your momentum already aimed at the next platform.",
        mechanics: ["steering", "charge", "pole-length", "elastic-surface", "grip-surface", "directional-surface", "ice-surface"],
    },
];

const CONTROL_MECHANICS = ["steering", "charge", "pole-length"] as const;

export function campaignStage(id: string): CampaignStage | undefined {
    return CAMPAIGN_STAGES.find((stage) => stage.id === id);
}

export function campaignStageIndex(id: string): number | undefined {
    const index = CAMPAIGN_STAGES.findIndex((stage) => stage.id === id);
    return index < 0 ? undefined : index;
}

export function campaignControlEnabled(id: string, mechanic: (typeof CONTROL_MECHANICS)[number]): boolean {
    const stage = campaignStage(id);
    return stage === undefined || stage.mechanics.includes(mechanic);
}

export function unlockedCampaignStageCount(value: string | null): number {
    if (value === null || !/^\d+$/.test(value)) return 1;
    const count = Number(value);
    if (!Number.isSafeInteger(count) || count < 1) return 1;
    return Math.min(count, CAMPAIGN_STAGES.length);
}

export function campaignLevelForStart(
    requestedId: string | null,
    unlockedCount: number,
    development: boolean,
): string {
    if (!Number.isInteger(unlockedCount) || unlockedCount < 1 || unlockedCount > CAMPAIGN_STAGES.length)
        throw new Error(`Invalid unlocked campaign stage count: ${unlockedCount}`);
    const latestUnlocked = CAMPAIGN_STAGES[unlockedCount - 1]!;
    if (requestedId === null) return latestUnlocked.id;
    const requestedIndex = campaignStageIndex(requestedId);
    if (!development && (requestedIndex === undefined || requestedIndex >= unlockedCount))
        return latestUnlocked.id;
    return requestedId;
}

export function nextCampaignStage(id: string): CampaignStage | undefined {
    const index = campaignStageIndex(id);
    return index === undefined ? undefined : CAMPAIGN_STAGES[index + 1];
}
