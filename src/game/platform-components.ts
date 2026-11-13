import { Body, component, f32, type FieldType, type Resource, type World } from "@dylanebert/shallot";
import type { LevelObjectDefinition } from "../content/level";
import { compileMotion, type CompiledPlatformMotion } from "../platforms";
import { resolveSurface } from "../surfaces";
import { crumbleDamageStage, surfaceVisualProperties } from "./platform-visuals";

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
export const PlatformVisualState = component("PlatformVisualState", {
    lowTraction: f32, rebound: f32, grip: f32, directionalLaunch: f32, holdUntilRelease: f32,
    oneWay: f32, moving: f32, crumbling: f32, returning: f32, damageStage: f32, available: f32,
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
    if (world.has(eid, PlatformVisualState)) world.remove(eid, PlatformVisualState);
    const rotationY = 2 * Math.atan2(object.transform.rotation[1], object.transform.rotation[3]);
    const response = resolveSurface("surface" in object ? object.surface : undefined, rotationY);
    const cues = surfaceVisualProperties(response);
    world.add(eid, PlatformVisualState, {
        lowTraction: Number(cues.lowTraction), rebound: Number(cues.rebound), grip: Number(cues.grip),
        directionalLaunch: Number(cues.directionalLaunch), holdUntilRelease: Number(cues.holdUntilRelease),
        oneWay: Number(object.collision.kind !== "trigger-box" && object.collision.mode === "one-way"),
        moving: Number(object.role === "platform" && !!object.motion),
        crumbling: Number(object.role === "platform" && !!object.crumble),
        returning: Number(object.role === "platform" && object.crumble?.returnDelay !== undefined),
        damageStage: object.role === "platform" && object.crumble ? 1 : 0,
        available: 1,
    });
    world.storage(Body).isEnabled.set(eid, 1);
}

export function updatePlatformVisualState(world: World, eid: number): void {
    if (!world.has(eid, PlatformVisualState)) return;
    const visual = world.storage(PlatformVisualState);
    const available = world.storage(PlatformPose).available.get(eid);
    visual.available.set(eid, available);
    if (!world.has(eid, PlatformCrumbleState)) return;
    const crumble = world.storage(PlatformCrumbleState);
    const phase = ["ready", "counting", "absent"][crumble.phase.get(eid)];
    if (phase !== "ready" && phase !== "counting" && phase !== "absent") throw new Error("Invalid platform crumble phase");
    visual.damageStage.set(eid, crumbleDamageStage(crumble.delay.get(eid), crumble.remaining.get(eid), phase));
}

