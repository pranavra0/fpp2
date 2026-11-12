import { Devices, mountOverlay, requestPointerLock, type World } from "@dylanebert/shallot";
import { activeLevel, runtime } from "./state";
import { gameplayProgress } from "./gameplay-state";
import { editorState, isEditing } from "./editor-state";
import { restartGameplay } from "./gameplay-system";

const HUD_STYLE = `
#fpp2-hud{position:absolute;inset:0;color:#eee;font:13px/1.4 system-ui,sans-serif;pointer-events:none}
#fpp2-hud [hidden]{display:none!important}
#fpp2-hud .hud-level{position:absolute;top:10px;right:10px;padding:4px 8px;background:#111c}
#fpp2-hud .hud-help{position:absolute;top:10px;left:10px;max-width:min(320px,calc(100vw - 20px));padding:8px;background:#111c}
#fpp2-hud .hud-controls{display:grid;grid-template-columns:auto auto;column-gap:16px;row-gap:3px}
#fpp2-hud .hud-event{position:absolute;bottom:10px;left:10px;padding:5px 8px;background:#111c}
#fpp2-hud .hud-complete{position:absolute;bottom:10px;left:10px;display:flex;align-items:center;gap:12px;padding:5px 8px;background:#111c;pointer-events:auto}
#fpp2-hud button{min-height:28px;padding:4px 8px;border:0;background:#333;color:#fff;font:inherit;cursor:pointer}
#fpp2-hud button:hover{background:#444}
`;

export function initializeGameplayHud(world: World): void {
    const root = document.createElement("div");
    root.id = "fpp2-hud";
    root.innerHTML = `<style>${HUD_STYLE}</style>
      <div class="hud-level" data-hud-level></div>
      <section class="hud-help" data-hud-help aria-label="Controls" hidden>
        <div class="hud-controls">
          <span>WASD</span><span>Move</span>
          <span>Space</span><span>Jump / charge</span>
          <span>E / Q</span><span>Extend / retract pole</span>
          <span>R</span><span>Restart at checkpoint or start</span>
          <span>Shift + R</span><span>Restart level</span>
          <span>H</span><span>Toggle help</span>
        </div>
      </section>
      <div class="hud-event" data-hud-event hidden></div>
      <div class="hud-complete" data-hud-complete hidden><span>Level complete</span><button type="button" data-hud-restart>Replay level</button></div>`;
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
        const help = root.querySelector<HTMLElement>("[data-hud-help]")!;
        if (isEditing(world.resource(editorState))) {
            help.hidden = true;
            root.hidden = true;
            return;
        }
        root.hidden = false;
        const devices = world.resource(Devices);
        if (devices.enabled && devices.keys.pressed.has("KeyH")) help.hidden = !help.hidden;
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
