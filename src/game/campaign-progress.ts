import { CAMPAIGN_STAGES, unlockedCampaignStageCount } from "../content/campaign";

const UNLOCKED_STAGE_COUNT_KEY = "fpp2.campaign.unlocked-stage-count";

export function readUnlockedCampaignStageCount(): number {
    return unlockedCampaignStageCount(window.localStorage.getItem(UNLOCKED_STAGE_COUNT_KEY));
}

export function unlockCampaignStage(index: number): void {
    if (!Number.isInteger(index) || index < 0 || index >= CAMPAIGN_STAGES.length)
        throw new Error(`Invalid campaign stage index: ${index}`);
    const count = Math.max(readUnlockedCampaignStageCount(), index + 1);
    window.localStorage.setItem(UNLOCKED_STAGE_COUNT_KEY, String(count));
}
