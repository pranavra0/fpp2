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
import { DEFAULT_LEVEL, type BoxSurface, type LevelDefinition } from "../content/default-level";
import { landingAlpha, type LandingContact, type LandingSweep } from "../sim";

export const LandingSurface = component("LandingSurface", {
    centerX: f32,
    centerZ: f32,
    topY: f32,
    width: f32,
    depth: f32,
    edgeTolerance: f32,
});

function addSurface(
    world: World,
    geometry: number,
    surface: BoxSurface,
    edgeTolerance: number,
): number {
    const eid = world.create();
    world.add(eid, Transform, {
        translation: [surface.centerX, surface.topY - surface.thickness * 0.5, surface.centerZ],
        scale: [surface.width, surface.thickness, surface.depth],
    });
    world.add(eid, Body);
    world.add(eid, Shape, { geometry });
    world.add(eid, LandingSurface, {
        centerX: surface.centerX,
        centerZ: surface.centerZ,
        topY: surface.topY,
        width: surface.width,
        depth: surface.depth,
        edgeTolerance,
    });
    return eid;
}

export function addLevelPhysics(
    world: World,
    level: LevelDefinition = DEFAULT_LEVEL,
    tuning: Tuning = DEFAULT_TUNING,
): { ground: number; platforms: number[] } {
    const geometry = world.resource(Hulls).add({ name: "level-box", halfExtents: [0.5, 0.5, 0.5] });
    return {
        ground: addSurface(world, geometry, level.ground, 0),
        platforms: level.platforms.map((surface) =>
            addSurface(world, geometry, surface, tuning.LANDING_EDGE_TOLERANCE_M),
        ),
    };
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
        if (
            Math.abs(x - surfaces.centerX.get(eid)) >
                surfaces.width.get(eid) * 0.5 + surfaces.edgeTolerance.get(eid) ||
            Math.abs(z - surfaces.centerZ.get(eid)) >
                surfaces.depth.get(eid) * 0.5 + surfaces.edgeTolerance.get(eid)
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
