import {
    Body,
    component,
    f32,
    Hulls,
    Shape,
    Transform,
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

export type LevelEntity = { id: string; eid: number; object: LevelObjectDefinition };

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
    const geometry = world.resource(Hulls).add({ name: "level-box", halfExtents: [0.5, 0.5, 0.5] });
    const surfaces = new Map(levelSurfaces(level).map((surface) => [surface.id, surface]));
    return level.objects.map((object) => {
        const surface = surfaces.get(object.id);
        if (!surface) throw new Error(`Level surface missing for object "${object.id}"`);
        const edgeTolerance =
            object.role === "ground" ? 0 : tuning.LANDING_EDGE_TOLERANCE_M;
        return {
            id: object.id,
            eid: addSurface(world, geometry, object, surface, edgeTolerance),
            object,
        };
    });
}

export function destroyLevelEntities(world: World, entities: LevelEntity[]): void {
    for (const { eid } of entities) world.destroy(eid);
    entities.length = 0;
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
