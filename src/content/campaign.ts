export type CampaignControl = "steering" | "charge" | "pole-length";
export type CampaignMechanic = CampaignControl | "motion" | "one-way" | "crumble"
    | "elastic-surface" | "grip-surface" | "directional-surface" | "ice-surface" | "ice-hold" | "sloped-ice";

export type CampaignStage = {
    id: string;
    chapterId?: string;
    title: string;
    introduces?: CampaignMechanic;
    practices?: readonly CampaignMechanic[];
    enabledControls: readonly CampaignControl[];
};

export const CAMPAIGN_REVISION = 2;
const STEER = ["steering"] as const;
const CHARGE = ["steering", "charge"] as const;
const ALL = ["steering", "charge", "pole-length"] as const;

export const CAMPAIGN_STAGES: readonly CampaignStage[] = [
    { id: "first-level", title: "Steering", introduces: "steering", practices: ["steering"], enabledControls: STEER },
    { id: "charge-course", title: "Charge", introduces: "charge", practices: ["steering", "charge"], enabledControls: CHARGE },
    { id: "pole-length", title: "Pole length", introduces: "pole-length", practices: ["steering", "charge", "pole-length"], enabledControls: ALL },
    { id: "moving-platforms", title: "Moving platforms", introduces: "motion", practices: ["steering", "motion"], enabledControls: ALL },
    { id: "crumbling-platforms", title: "Crumbling platforms", introduces: "crumble", practices: ["steering", "crumble"], enabledControls: ALL },
    { id: "ice-surface", title: "Ice", introduces: "ice-surface", practices: ["steering", "ice-surface"], enabledControls: ALL },
];

export function campaignStage(id: string): CampaignStage | undefined {
    return CAMPAIGN_STAGES.find(stage => stage.id === id);
}

export function campaignStageIndex(id: string): number | undefined {
    const index = CAMPAIGN_STAGES.findIndex(stage => stage.id === id);
    return index < 0 ? undefined : index;
}

export function campaignControlEnabled(id: string, control: CampaignControl): boolean {
    return campaignStage(id)?.enabledControls.includes(control) ?? true;
}

export function nextCampaignStage(id: string): CampaignStage | undefined {
    const index = campaignStageIndex(id);
    return index === undefined ? undefined : CAMPAIGN_STAGES[index + 1];
}
