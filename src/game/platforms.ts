import { configurePlatform, platformPaths, PlatformPose, PlatformMotionState, PlatformCrumbleState } from "./platform-components";
import { Body, Transform, type World } from "@dylanebert/shallot";
import { setTransform, SyncPhysicsSystem } from "@dylanebert/shallot/standard/physics";
import { advanceCrumble, contactCrumble, motionOffset, type CrumbleState, type CompiledPlatformMotion } from "../platforms";
import { playerPose, type LandingContact, type Sim, type SupportSnapshot } from "../sim";
import { LandingSurface, type LevelEntity } from "./physics";
import { playerOccupiesSurface } from "./player-collision";

const PHASES = ["ready", "counting", "absent"] as const;

export function capturePlatformVisuals(world: World, entity: LevelEntity): void {
    const transform = world.storage(Transform);
    entity.visualPlacements = [...entity.visualEids ?? [], ...entity.indicatorEids ?? []].map(eid => ({
        eid,
        position: [transform.translation.x.get(eid), transform.translation.y.get(eid), transform.translation.z.get(eid)],
        scale: [transform.scale.x.get(eid), transform.scale.y.get(eid), transform.scale.z.get(eid)],
    }));
}

function syncPlatform(world: World, entity: LevelEntity): boolean {
    const eid = entity.collisionEid;
    if (eid === undefined) return false;
    const pose = world.storage(PlatformPose);
    const x = pose.x.get(eid), y = pose.y.get(eid), z = pose.z.get(eid);
    const available = pose.available.get(eid);
    const surface = world.storage(LandingSurface);
    surface.centerX.set(eid, x);
    surface.centerZ.set(eid, z);
    surface.topY.set(eid, y + surface.height.get(eid) / 2);
    // Transform writes alone would leave native queries at the preceding fixed tick.
    setTransform(world, eid, [x, y, z], entity.object.transform.rotation);
    const changed = world.storage(Body).isEnabled.get(eid) !== available;
    if (changed) world.storage(Body).isEnabled.set(eid, available);
    const origin = entity.object.transform.position;
    const transform = world.storage(Transform);
    for (const visual of entity.visualPlacements ?? []) {
        if (entity.pathIndicatorEids?.includes(visual.eid)) continue;
        transform.translation.set(visual.eid, visual.position[0] + x - origin[0], visual.position[1] + y - origin[1], visual.position[2] + z - origin[2]);
        transform.scale.set(visual.eid, available ? visual.scale[0] : 0, available ? visual.scale[1] : 0, available ? visual.scale[2] : 0);
    }
    return changed;
}

export function resetPlatforms(world: World, entities: readonly LevelEntity[], editing = false): void {
    invalidatePlatformIndex(entities);
    for (const entity of entities) {
        const eid = entity.collisionEid;
        if (eid === undefined) continue;
        configurePlatform(world, eid, entity.object);
        const motion = world.resource(platformPaths).get(eid);
        if (motion && !editing) {
            const offset = motionOffset(motion, 0);
            const pose = world.storage(PlatformPose);
            for (const [axis, value] of [["x", offset.x], ["y", offset.y], ["z", offset.z]] as const) {
                const base = entity.object.transform.position[axis === "x" ? 0 : axis === "y" ? 1 : 2];
                pose[axis].set(eid, base + value);
                pose[axis === "x" ? "previousX" : axis === "y" ? "previousY" : "previousZ"].set(eid, base + value);
            }
        }
        syncPlatform(world, entity);
    }
    SyncPhysicsSystem.update!(world);
}

export function advancePlatforms(world: World, entities: readonly LevelEntity[], sim: Sim, dt: number): void {
    const pose = world.storage(PlatformPose);
    const motionState = world.storage(PlatformMotionState);
    const crumble = world.storage(PlatformCrumbleState);
    let availabilityChanged = false;
    const affected = new Set<number>();
    for (const eid of world.query([PlatformMotionState, PlatformPose])) affected.add(eid);
    for (const eid of world.query([PlatformCrumbleState, PlatformPose])) affected.add(eid);
    const byEid = platformEntityIndex(entities);
    for (const eid of affected) {
        const entity = byEid.get(eid);
        if (!entity) throw new Error("Platform behavior has no level object");
        const oldAvailability = pose.available.get(eid);
        const moving = world.has(eid, PlatformMotionState);
        const previous = { x: pose.x.get(eid), y: pose.y.get(eid), z: pose.z.get(eid) };
        pose.previousX.set(eid, previous.x); pose.previousY.set(eid, previous.y); pose.previousZ.set(eid, previous.z);
        if (world.has(eid, PlatformMotionState)) {
            const elapsed = motionState.elapsed.get(eid) + dt;
            motionState.elapsed.set(eid, elapsed);
            const offset = motionOffset(world.resource(platformPaths).get(eid)!, elapsed);
            const base = entity.object.transform.position;
            pose.x.set(eid, base[0] + offset.x); pose.y.set(eid, base[1] + offset.y); pose.z.set(eid, base[2] + offset.z);
        }
        pose.velocityX.set(eid, (pose.x.get(eid) - previous.x) / dt);
        pose.velocityY.set(eid, (pose.y.get(eid) - previous.y) / dt);
        pose.velocityZ.set(eid, (pose.z.get(eid) - previous.z) / dt);
        // Occupancy must use the returning platform's current trajectory position.
        const surface = world.storage(LandingSurface);
        surface.centerX.set(eid, pose.x.get(eid)); surface.centerZ.set(eid, pose.z.get(eid));
        surface.topY.set(eid, pose.y.get(eid) + surface.height.get(eid) / 2);
        if (world.has(eid, PlatformCrumbleState)) {
            const returnDelay = crumble.returnDelay.get(eid);
            const next = advanceCrumble({ phase: PHASES[crumble.phase.get(eid)]!, remaining: crumble.remaining.get(eid) },
                { delay: crumble.delay.get(eid), ...(returnDelay >= 0 ? { returnDelay } : {}) }, dt,
                playerOccupiesSurface(world, eid, playerPose(sim)));
            writeCrumble(world, eid, next);
        }
        if (moving || oldAvailability !== pose.available.get(eid)) availabilityChanged = syncPlatform(world, entity) || availabilityChanged;
    }
    if (availabilityChanged) SyncPhysicsSystem.update!(world);
}

function writeCrumble(world: World, eid: number, state: CrumbleState): void {
    const storage = world.storage(PlatformCrumbleState);
    storage.phase.set(eid, PHASES.indexOf(state.phase));
    storage.remaining.set(eid, state.remaining);
    world.storage(PlatformPose).available.set(eid, Number(state.phase !== "absent"));
}

export function confirmPlatformContact(world: World, contact: LandingContact | undefined): void {
    const eid = contact?.platformId;
    if (eid === undefined || !world.has(eid, PlatformCrumbleState)) return;
    const storage = world.storage(PlatformCrumbleState);
    writeCrumble(world, eid, contactCrumble({ phase: PHASES[storage.phase.get(eid)]!, remaining: storage.remaining.get(eid) }, { delay: storage.delay.get(eid) }));
}

export function platformSupport(world: World, sim: Sim): SupportSnapshot | undefined {
    const support = sim.pogo.support;
    if (!support) return undefined;
    const eid = support.platformId;
    if (!world.has(eid, PlatformPose)) return { platformId: eid, position: support.position, velocity: support.velocity, available: false };
    const pose = world.storage(PlatformPose);
    return { platformId: eid, position: { x: pose.x.get(eid), y: pose.y.get(eid), z: pose.z.get(eid) },
        velocity: { x: pose.velocityX.get(eid), y: pose.velocityY.get(eid), z: pose.velocityZ.get(eid) }, available: !!pose.available.get(eid) };
}

export type PlatformTrajectory = {
    id: string;
    available: boolean;
    motion?: CompiledPlatformMotion;
    elapsed: number;
    collapseIn?: number;
};

export function platformTrajectories(world: World, entities: readonly LevelEntity[]): PlatformTrajectory[] {
    const pose = world.storage(PlatformPose);
    const motion = world.storage(PlatformMotionState);
    const crumble = world.storage(PlatformCrumbleState);
    return entities.flatMap(entity => {
        const eid = entity.collisionEid;
        if (eid === undefined) return [];
        return [{ id: entity.id, available: !!pose.available.get(eid), motion: world.resource(platformPaths).get(eid),
            elapsed: world.has(eid, PlatformMotionState) ? motion.elapsed.get(eid) : 0,
            ...(world.has(eid, PlatformCrumbleState) && crumble.phase.get(eid) === 1 ? { collapseIn: crumble.remaining.get(eid) } : {}),
        }];
    });
}

const entityIndexes = new WeakMap<readonly LevelEntity[], Map<number, LevelEntity>>();
export function invalidatePlatformIndex(entities: readonly LevelEntity[]): void {
    entityIndexes.delete(entities);
}
function platformEntityIndex(entities: readonly LevelEntity[]): Map<number, LevelEntity> {
    let index = entityIndexes.get(entities);
    if (!index) {
        index = new Map(entities.flatMap(entity => entity.collisionEid === undefined ? [] : [[entity.collisionEid, entity] as const]));
        entityIndexes.set(entities, index);
    }
    return index;
}
