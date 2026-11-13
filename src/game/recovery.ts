import { recoverResource, type World } from "@dylanebert/shallot";
import { runtime } from "./state";
import { gameplayProgress } from "./gameplay-state";
import { platformPaths } from "./platform-components";
import { surfaceDiagnostics } from "./physics";

export function recoverGameState(world: World) {
    const recoverRuntime = recoverResource(runtime)(world);
    const recoverProgress = recoverResource(gameplayProgress)(world);
    const recoverDiagnostics = recoverResource(surfaceDiagnostics)(world);
    const snapshot = () => ({ runtime: recoverRuntime.snapshot(), progress: recoverProgress.snapshot(),
        paths: structuredClone(world.resource(platformPaths)), diagnostics: recoverDiagnostics.snapshot() });
    return {
        snapshot,
        restore(saved: ReturnType<typeof snapshot>) {
            recoverRuntime.restore(saved.runtime);
            recoverProgress.restore(saved.progress);
            recoverDiagnostics.restore(saved.diagnostics);
            const paths = world.resource(platformPaths);
            paths.clear();
            for (const [eid, motion] of structuredClone(saved.paths)) paths.set(eid, motion);
        },
    };
}
