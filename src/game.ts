import {
    BrowserInputPlugin,
    MeshPlugin,
    recoverResource,
    type Plugin,
    type World,
    StandardRenderingPlugin,
} from "@dylanebert/shallot";
import { StandardAudioPlugin } from "@dylanebert/shallot/standard/audio";
import { OutlinePlugin } from "@dylanebert/shallot/extras";
import { FollowCamera, PresentCamera, PresentFollowCamera } from "./game/camera";
import { ReadControls } from "./game/input";
import { PogoWorldCollisionPlugin } from "./game/physics";
import { initializeGame } from "./game/scene";
import { Simulate } from "./game/simulation";
import { runtime } from "./game/state";
import { gameplayProgress } from "./game/gameplay-state";
import { GameplayProgression } from "./game/gameplay-system";

function recoverGameState(world: World) {
    const recoverRuntime = recoverResource(runtime)(world);
    const recoverProgress = recoverResource(gameplayProgress)(world);
    const initial = { runtime: recoverRuntime.snapshot(), progress: recoverProgress.snapshot() };
    return {
        snapshot: () => ({ runtime: recoverRuntime.snapshot(), progress: recoverProgress.snapshot() }),
        restore(snapshot: typeof initial) {
            recoverRuntime.restore(snapshot.runtime);
            recoverProgress.restore(snapshot.progress);
        },
    };
}

export const Game: Plugin = {
    name: "Game",
    recovery: recoverGameState,
    dependencies: [
        BrowserInputPlugin,
        MeshPlugin,
        StandardRenderingPlugin,
        StandardAudioPlugin,
        PogoWorldCollisionPlugin,
        ...(import.meta.env?.DEV === true ? [OutlinePlugin] : []),
    ],
    initialize: initializeGame,
    systems: [ReadControls, Simulate, GameplayProgression, FollowCamera, PresentFollowCamera, PresentCamera],
};
