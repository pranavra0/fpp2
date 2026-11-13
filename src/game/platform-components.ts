import { Body, component, f32, type FieldType, type Resource, type World } from "@dylanebert/shallot";
import type { LevelObjectDefinition } from "../content/level";
import { compileMotion, type CompiledPlatformMotion } from "../platforms";

const scalar: FieldType<Float64Array> & { readonly lanes: 1 } = { ctor: Float64Array, lanes: 1, name: "f64" };
export const PlatformPose = component("PlatformPose", {
    x: scalar, y: scalar, z: scalar,
    previousX: scalar, previousY: scalar, previousZ: scalar,
    velocityX: scalar, velocityY: scalar, velocityZ: scalar,
    available: f32,
});
export const PlatformMotionState = component("PlatformMotion", { elapsed: scalar });
export const PlatformCrumbleState = component("PlatformCrumble", {
    phase: f32, remaining: scalar, delay: scalar, returnDelay: scalar,
});
export const platformPaths: Resource<Map<number, CompiledPlatformMotion>> = { create: () => new Map() };

export function configurePlatform(world: World, eid: number, object: LevelObjectDefinition): void {
    const [x, y, z] = object.transform.position;
    if (world.has(eid, PlatformPose)) world.remove(eid, PlatformPose);
    world.add(eid, PlatformPose, { x, y, z, previousX: x, previousY: y, previousZ: z, available: 1 });
    if (world.has(eid, PlatformMotionState)) world.remove(eid, PlatformMotionState);
    if (world.has(eid, PlatformCrumbleState)) world.remove(eid, PlatformCrumbleState);
    world.resource(platformPaths).delete(eid);
    if (object.role === "platform" && object.motion) {
        world.add(eid, PlatformMotionState);
        world.resource(platformPaths).set(eid, compileMotion(object.motion));
    }
    if (object.role === "platform" && object.crumble)
        world.add(eid, PlatformCrumbleState, { delay: object.crumble.delay, returnDelay: object.crumble.returnDelay ?? -1 });
    world.storage(Body).isEnabled.set(eid, 1);
}

