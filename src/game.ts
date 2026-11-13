import {
    BrowserInputPlugin,
    MeshPlugin,
    type Plugin,
    StandardRenderingPlugin,
} from "@dylanebert/shallot";
import { StandardAudioPlugin } from "@dylanebert/shallot/standard/audio";
import { OutlinePlugin } from "@dylanebert/shallot/extras";
import { FollowCamera, PresentCamera, PresentFollowCamera } from "./game/camera";
import { ReadControls } from "./game/input";
import { PogoWorldCollisionPlugin } from "./game/physics";
import { initializeGame } from "./game/scene";
import { Simulate } from "./game/simulation";
import { GameplayProgression } from "./game/gameplay-system";
import { recoverGameState } from "./game/recovery";

/** Composes game plugins and schedules input, fixed gameplay, progression, and camera systems. */
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
