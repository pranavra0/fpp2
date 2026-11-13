import { CAMPAIGN_STAGES, campaignStage, campaignStageIndex, nextCampaignStage } from "../content/campaign";
import { Devices, mountOverlay, requestPointerLock, type World } from "@dylanebert/shallot";
import { activeLevel, runtime } from "./state";
import { gameplayProgress } from "./gameplay-state";
import { editorState, isEditing } from "./editor-state";
import { restartGameplay } from "./gameplay-system";
import { unlockCampaignStage } from "./campaign-progress";

const HUD_STYLE = `
#fpp2-hud{position:absolute;inset:0;color:#eee;font:13px/1.4 system-ui,sans-serif;pointer-events:none}
#fpp2-hud [hidden]{display:none!important}
#fpp2-hud .hud-level{position:absolute;top:10px;right:10px;padding:4px 8px;background:#111c}
#fpp2-hud .hud-instructions{position:absolute;top:10px;left:10px;display:grid;gap:8px;max-width:calc(100vw - 20px)}
#fpp2-hud .hud-lesson{max-width:min(360px,calc(100vw - 20px));padding:8px;background:#111c}
#fpp2-hud .hud-help{max-width:min(320px,calc(100vw - 20px));padding:8px;background:#111c}
#fpp2-hud .hud-controls{display:grid;grid-template-columns:auto auto;column-gap:16px;row-gap:3px}
#fpp2-hud .hud-event{position:absolute;bottom:10px;left:10px;padding:5px 8px;background:#111c}
#fpp2-hud .hud-complete{position:absolute;bottom:10px;left:10px;display:flex;align-items:center;gap:8px;padding:5px 8px;background:#111c;pointer-events:auto}
#fpp2-hud button{min-height:28px;padding:4px 8px;border:0;background:#333;color:#fff;font:inherit;cursor:pointer}
#fpp2-hud button:hover{background:#444}
`;

function appendControlRow(container: HTMLElement, key: string, action: string): void {
    const keyLabel = document.createElement("span");
    keyLabel.textContent = key;
    const actionLabel = document.createElement("span");
    actionLabel.textContent = action;
    container.append(keyLabel, actionLabel);
}

function campaignControls(levelId: string): HTMLElement {
    const rows = document.createElement("div");
    rows.className = "hud-controls";
    const stage = campaignStage(levelId);
    const mechanics = stage?.mechanics;
    if (mechanics === undefined || mechanics.includes("steering"))
        appendControlRow(rows, "WASD", "Steer");
    if (mechanics === undefined || mechanics.includes("charge"))
        appendControlRow(rows, "Space", "Charge and release");
    if (mechanics === undefined || mechanics.includes("pole-length"))
        appendControlRow(rows, "E / Q", "Extend / retract pole");
    appendControlRow(rows, "R", "Restart at checkpoint");
    appendControlRow(rows, "Shift + R", "Restart lesson");
    appendControlRow(rows, "H", "Toggle controls");
    return rows;
}

function openCampaignLevel(id: string): void {
    const url = new URL(window.location.href);
    url.searchParams.set("level", id);
    window.location.assign(url.toString());
}

export function initializeGameplayHud(world: World): void {
    const root = document.createElement("div");
    root.id = "fpp2-hud";
    root.innerHTML = `<style>${HUD_STYLE}</style>
      <div class="hud-level"><div data-hud-level></div></div>
      <div class="hud-instructions"><section class="hud-lesson" data-hud-lesson aria-label="Lesson" aria-live="polite">
        <strong data-lesson-title></strong>
        <div data-lesson-mechanic></div>
        <div data-lesson-instruction></div>
        <div>Press H to show controls</div>
      </section>
      <section class="hud-help" data-hud-help aria-label="Controls" hidden>
        <div data-hud-controls></div>
      </section>
      </div>
      <div class="hud-event" data-hud-event hidden></div>
      <div class="hud-complete" data-hud-complete hidden>
        <span data-hud-complete-title></span>
        <button type="button" data-hud-continue hidden>Next lesson</button>
        <button type="button" data-hud-restart>Replay lesson</button>
      </div>`;
    const levelId = activeLevel(world.resource(runtime)).id;
    root.querySelector<HTMLElement>("[data-hud-controls]")!.replaceWith(campaignControls(levelId));
    root.querySelector<HTMLButtonElement>("[data-hud-continue]")!.addEventListener("click", () => {
        const currentIndex = campaignStageIndex(activeLevel(world.resource(runtime)).id);
        if (currentIndex === undefined) throw new Error("Cannot advance from a level outside the campaign");
        const next = CAMPAIGN_STAGES[currentIndex + 1];
        if (!next) throw new Error("The campaign has no next lesson");
        unlockCampaignStage(currentIndex + 1);
        openCampaignLevel(next.id);
    });
    root.querySelector<HTMLButtonElement>("[data-hud-restart]")!.addEventListener("click", () => {
        const currentId = activeLevel(world.resource(runtime)).id;
        const currentIndex = campaignStageIndex(currentId);
        if (currentIndex === CAMPAIGN_STAGES.length - 1) {
            openCampaignLevel(CAMPAIGN_STAGES[0]!.id);
        } else {
            restartGameplay(world, true);
            requestPointerLock(world);
        }
    });
    const canvas = document.querySelector("canvas");
    mountOverlay(canvas, world).append(root);
    world.addSystem(GameplayHud);
}

const GameplayHud = {
    name: "GameplayHud",
    group: "draw" as const,
    update(world: World): void {
        const root = document.getElementById("fpp2-hud");
        if (!root) return;
        const help = root.querySelector<HTMLElement>("[data-hud-help]")!;
        if (isEditing(world.resource(editorState))) {
            help.hidden = true;
            root.querySelector<HTMLElement>("[data-hud-lesson]")!.hidden = true;
            root.hidden = true;
            return;
        }
        root.hidden = false;
        const state = world.resource(runtime);
        const level = activeLevel(state);
        const devices = world.resource(Devices);
        if (devices.enabled && devices.keys.pressed.has("KeyH")) help.hidden = !help.hidden;
        const progress = world.resource(gameplayProgress);
        const lesson = root.querySelector<HTMLElement>("[data-hud-lesson]")!;
        const stage = campaignStage(level.id);
        const stageIndex = campaignStageIndex(level.id);
        root.querySelector<HTMLElement>("[data-hud-level]")!.textContent =
            stage && stageIndex !== undefined
                ? `Lesson ${stageIndex + 1} / ${CAMPAIGN_STAGES.length}`
                : level.id;
        lesson.hidden = stage === undefined;
        root.querySelector<HTMLElement>(".hud-level")!.hidden = stage === undefined;
        if (stage && stageIndex !== undefined) {
            root.querySelector<HTMLElement>("[data-lesson-title]")!.textContent = stage.title;
            root.querySelector<HTMLElement>("[data-lesson-mechanic]")!.textContent =
                `New mechanic: ${stage.newMechanic}`;
            root.querySelector<HTMLElement>("[data-lesson-instruction]")!.textContent = stage.instruction;
        }
        const complete = progress.mode === "complete";
        root.querySelector<HTMLElement>("[data-hud-complete]")!.hidden = !complete;
        const completionTitle = root.querySelector<HTMLElement>("[data-hud-complete-title]")!;
        const continueButton = root.querySelector<HTMLButtonElement>("[data-hud-continue]")!;
        const restartButton = root.querySelector<HTMLButtonElement>("[data-hud-restart]")!;
        const nextStage = nextCampaignStage(level.id);
        const finalCampaignStage = stageIndex === CAMPAIGN_STAGES.length - 1;
        continueButton.hidden = !complete || nextStage === undefined;
        restartButton.textContent = finalCampaignStage ? "Replay campaign" : "Replay lesson";
        completionTitle.textContent = finalCampaignStage
            ? "Campaign complete"
            : stage
              ? `${stage.title} complete`
              : "Level complete";
        const event = root.querySelector<HTMLElement>("[data-hud-event]")!;
        const message = progress.event === "checkpoint"
            ? "Checkpoint activated"
            : progress.event === "failure"
              ? progress.checkpointId ? "Respawned at checkpoint" : "Respawned at start"
              : "";
        event.textContent = message;
        event.hidden = complete || message === "";
    },
};
