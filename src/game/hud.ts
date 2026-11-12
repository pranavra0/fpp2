import { mountOverlay, requestPointerLock, type World } from "@dylanebert/shallot";
import { activeLevel, runtime } from "./state";
import { gameplayProgress } from "./gameplay-state";
import { editorState, isEditing } from "./editor-state";
import { restartGameplay } from "./gameplay-system";

const HUD_STYLE = `
#fpp2-hud{position:absolute;inset:0;color:#f2f2f2;font:13px/1.45 system-ui,sans-serif;pointer-events:none}
#fpp2-hud .hud-info{position:absolute;top:10px;right:10px;max-width:min(320px,calc(100vw - 20px));padding:8px 10px;background:#111c;border:1px solid #555}
#fpp2-hud .hud-level{font-weight:600}#fpp2-hud .hud-controls{color:#ccc}
#fpp2-hud .hud-event{position:absolute;top:18%;left:50%;transform:translateX(-50%);padding:7px 12px;background:#111d;border:1px solid #777;text-align:center}
#fpp2-hud .hud-complete{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:min(320px,calc(100vw - 32px));padding:18px;background:#111e;border:1px solid #777;text-align:center;pointer-events:auto}
#fpp2-hud .hud-complete h1{margin:0 0 12px;font-size:20px;font-weight:600}
#fpp2-hud button{min-height:32px;padding:5px 12px;border:1px solid #777;background:#292929;color:#fff;font:inherit;cursor:pointer}
#fpp2-hud button:hover{background:#383838}
@media(max-width:600px){#fpp2-hud .hud-info{font-size:12px}#fpp2-hud .hud-event{top:22%}}
`;

export function initializeGameplayHud(world: World): void {
    const root = document.createElement("div");
    root.id = "fpp2-hud";
    root.innerHTML = `<style>${HUD_STYLE}</style>
      <div class="hud-info"><div class="hud-level" data-hud-level></div><div class="hud-controls">WASD move · Space jump / charge · E/Q pole length<br>R restart at checkpoint/start · Shift+R restart level</div></div>
      <div class="hud-event" data-hud-event hidden></div>
      <section class="hud-complete" data-hud-complete hidden><h1>Level complete</h1><button type="button" data-hud-restart>Replay level</button></section>`;
    root.querySelector<HTMLButtonElement>("[data-hud-restart]")!.addEventListener("click", () => {
        restartGameplay(world, true);
        requestPointerLock(world);
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
        const hidden = isEditing(world.resource(editorState));
        root.hidden = hidden;
        if (hidden) return;
        const progress = world.resource(gameplayProgress);
        root.querySelector<HTMLElement>("[data-hud-level]")!.textContent = activeLevel(world.resource(runtime)).id;
        const complete = progress.mode === "complete";
        root.querySelector<HTMLElement>("[data-hud-complete]")!.hidden = !complete;
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
