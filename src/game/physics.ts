import {
    Body,
    component,
    f32,
    Shape,
    Transform,
    UNIT_CUBE_ID,
    type Plugin,
    type World,
} from "@dylanebert/shallot";
import {
    castShape,
    PhysicsWorldDefinition,
    StandardPhysicsPlugin,
    type ShapeProxy,
} from "@dylanebert/shallot/standard/physics";
import { DEFAULT_TUNING, type Tuning } from "../config/gameplay";
import {
    levelSurfaceContains,
    levelSurfaces,
    type LevelDefinition,
    type LevelObjectDefinition,
    type LevelSurface,
} from "../content/level";
import { landingAlpha, type LandingContact, type LandingSweep } from "../sim";

export const LandingSurface = component("LandingSurface", {
    centerX: f32,
    centerZ: f32,
    rotationY: f32,
    topY: f32,
    width: f32,
    depth: f32,
    edgeTolerance: f32,
});

export type LevelEntity = {
    id: string;
    collisionEid?: number;
    visualEids?: number[];
    object: LevelObjectDefinition;
};

function levelSurface(object: LevelObjectDefinition): LevelSurface {
    if (object.collision.kind !== "box")
        throw new Error(`Trigger object "${object.id}" has no landing surface`);
    const [surface] = levelSurfaces({
        id: "editor-object",
        spawnPosition: [0, 0, 0],
        failureBoundaryY: -20,
        objects: [object],
    });
    if (!surface) throw new Error(`Level surface missing for object "${object.id}"`);
    return surface;
}

function addSurface(
    world: World,
    geometry: number,
    object: LevelObjectDefinition,
    surface: LevelSurface,
    edgeTolerance: number,
): number {
    const eid = world.create();
    world.add(eid, Transform, {
        translation: object.transform.position,
        rotation: object.transform.rotation,
        scale: object.transform.scale,
    });
    world.add(eid, Body);
    world.add(eid, Shape, { geometry, scale: object.collision.dimensions });
    world.add(eid, LandingSurface, {
        centerX: surface.centerX,
        centerZ: surface.centerZ,
        rotationY: surface.rotationY,
        topY: surface.topY,
        width: surface.width,
        depth: surface.depth,
        edgeTolerance,
    });
    return eid;
}

export function addLevelPhysics(
    world: World,
    level: LevelDefinition,
    tuning: Tuning = DEFAULT_TUNING,
): LevelEntity[] {
    return level.objects.map((object) => addLevelObjectPhysics(world, object, tuning));
}

export function addLevelObjectPhysics(
    world: World,
    object: LevelObjectDefinition,
    tuning: Tuning = DEFAULT_TUNING,
): LevelEntity {
    if (object.collision.kind === "trigger-box") return { id: object.id, object };
    const surface = levelSurface(object);
    const edgeTolerance = object.role === "ground" ? 0 : tuning.LANDING_EDGE_TOLERANCE_M;
    return {
        id: object.id,
        collisionEid: addSurface(world, UNIT_CUBE_ID, object, surface, edgeTolerance),
        object,
    };
}

export function destroyLevelEntities(world: World, entities: LevelEntity[]): void {
    for (const entity of entities) {
        for (const visualEid of entity.visualEids ?? []) world.destroy(visualEid);
        if (entity.collisionEid !== undefined) world.destroy(entity.collisionEid);
    }
    entities.length = 0;
}

export function updateLevelEntity(
    world: World,
    entity: LevelEntity,
    object: LevelObjectDefinition,
    tuning: Tuning = DEFAULT_TUNING,
): void {
    if (object.id !== entity.id)
        throw new Error(`Cannot change stable level object id "${entity.id}"`);
    if (
        entity.object.visual.kind !== object.visual.kind ||
        (entity.object.visual.kind === "gltf" &&
            object.visual.kind === "gltf" &&
            entity.object.visual.asset !== object.visual.asset)
    )
        throw new Error(`Cannot replace the visual for level object "${entity.id}" in place`);
    if (object.collision.kind === "box") {
        if (entity.collisionEid === undefined)
            throw new Error(`Collision entity missing for surface "${entity.id}"`);
        const surface = levelSurface(object);
        const collisionEid = entity.collisionEid;
        world.storage(Transform).translation.set(collisionEid, ...object.transform.position);
        world.storage(Transform).rotation.set(collisionEid, ...object.transform.rotation);
        world.storage(Transform).scale.set(collisionEid, ...object.transform.scale);
        world.storage(Shape).scale.set(collisionEid, ...object.collision.dimensions);
        const edgeTolerance = object.role === "ground" ? 0 : tuning.LANDING_EDGE_TOLERANCE_M;
        world.storage(LandingSurface).centerX.set(collisionEid, surface.centerX);
        world.storage(LandingSurface).centerZ.set(collisionEid, surface.centerZ);
        world.storage(LandingSurface).rotationY.set(collisionEid, surface.rotationY);
        world.storage(LandingSurface).topY.set(collisionEid, surface.topY);
        world.storage(LandingSurface).width.set(collisionEid, surface.width);
        world.storage(LandingSurface).depth.set(collisionEid, surface.depth);
        world.storage(LandingSurface).edgeTolerance.set(collisionEid, edgeTolerance);
    } else if (entity.collisionEid !== undefined) {
        throw new Error(`Trigger object "${entity.id}" cannot have a collision entity`);
    }
    if (object.visual.kind === "box") {
        const visualScale = object.collision.kind === "trigger-box"
            ? [
                  object.transform.scale[0] * object.collision.dimensions[0],
                  object.transform.scale[1] * object.collision.dimensions[1],
                  object.transform.scale[2] * object.collision.dimensions[2],
              ] as const
            : object.transform.scale;
        for (const visualEid of entity.visualEids ?? []) {
            world.storage(Transform).translation.set(visualEid, ...object.transform.position);
            world.storage(Transform).rotation.set(visualEid, ...object.transform.rotation);
            world.storage(Transform).scale.set(visualEid, ...visualScale);
        }
    }
    entity.object = object;
}

function tipProxy(edgeTolerance: number, halfHeight: number): ShapeProxy {
    const points = [];
    for (const x of [-edgeTolerance, edgeTolerance])
        for (const y of [-halfHeight, halfHeight])
            for (const z of [-edgeTolerance, edgeTolerance]) points.push({ x, y, z });
    return { points, count: points.length, radius: 0 };
}

export function findLandingSurface(
    world: World,
    sweep: LandingSweep,
    tuning: Tuning = DEFAULT_TUNING,
): LandingContact | undefined {
    const translation = {
        x: sweep.currentTip.x - sweep.previousTip.x,
        y: sweep.currentTip.y - sweep.previousTip.y,
        z: sweep.currentTip.z - sweep.previousTip.z,
    };
    const proxy = tipProxy(
        tuning.LANDING_EDGE_TOLERANCE_M,
        tuning.LANDING_VERTICAL_TOLERANCE_M,
    );
    const surfaces = world.storage(LandingSurface);
    let bestAlpha = Number.POSITIVE_INFINITY;
    let bestTopY: number | undefined;

    castShape(world, sweep.previousTip, proxy, translation, (hit) => {
        if (!world.has(hit.body, LandingSurface)) return 1;
        const eid = hit.body;
        const topY = surfaces.topY.get(eid);
        const alpha = landingAlpha(sweep, topY, tuning);
        if (alpha === undefined || alpha >= bestAlpha) return 1;
        const x = sweep.previousTip.x + translation.x * alpha;
        const z = sweep.previousTip.z + translation.z * alpha;
        const surface: Pick<
            LevelSurface,
            "centerX" | "centerZ" | "rotationY" | "width" | "depth"
        > = {
            centerX: surfaces.centerX.get(eid),
            centerZ: surfaces.centerZ.get(eid),
            rotationY: surfaces.rotationY.get(eid),
            width: surfaces.width.get(eid),
            depth: surfaces.depth.get(eid),
        };
        if (
            !levelSurfaceContains(
                surface,
                x,
                z,
                surfaces.edgeTolerance.get(eid),
            )
        )
            return 1;
        bestAlpha = alpha;
        bestTopY = topY;
        return 1;
    });

    return bestTopY === undefined ? undefined : { surfaceY: bestTopY };
}

export const PogoWorldCollisionPlugin: Plugin = {
    name: "PogoWorldCollision",
    dependencies: [StandardPhysicsPlugin],
    components: [LandingSurface],
    initialize(world) {
        // Static shapes provide queries; pogo movement remains owned by the game simulation.
        world.resource(PhysicsWorldDefinition).enableAutomaticStep = false;
    },
};
