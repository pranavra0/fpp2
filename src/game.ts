import {
    BrowserInputPlugin,
    MeshPlugin,
    recoverResource,
    type Plugin,
    StandardRenderingPlugin,
} from "@dylanebert/shallot";
import { OutlinePlugin } from "@dylanebert/shallot/extras";
import { FollowCamera, PresentCamera, PresentFollowCamera } from "./game/camera";
import { ReadControls } from "./game/input";
import { PogoWorldCollisionPlugin } from "./game/physics";
import { initializeGame } from "./game/scene";
import { Simulate } from "./game/simulation";
import { runtime } from "./game/state";

export const Game: Plugin = {
    name: "Game",
    recovery: recoverResource(runtime),
    dependencies: [
        BrowserInputPlugin,
        MeshPlugin,
        StandardRenderingPlugin,
        PogoWorldCollisionPlugin,
        ...(import.meta.env?.DEV === true ? [OutlinePlugin] : []),
    ],
    initialize: initializeGame,
    systems: [ReadControls, Simulate, FollowCamera, PresentFollowCamera, PresentCamera],
};
