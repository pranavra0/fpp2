export type BoxSurface = {
    centerX: number;
    centerZ: number;
    topY: number;
    width: number;
    depth: number;
    thickness: number;
};

export type LevelDefinition = {
    ground: BoxSurface;
    platforms: readonly BoxSurface[];
};

export const DEFAULT_LEVEL: LevelDefinition = {
    ground: {
        centerX: 0,
        centerZ: 0,
        topY: 0,
        width: 28,
        depth: 24,
        thickness: 1,
    },
    platforms: [
        { centerX: 3, centerZ: -2, topY: 2.6, width: 4, depth: 5.5, thickness: 0.36 },
        { centerX: -3, centerZ: 3, topY: 5.2, width: 4, depth: 5.5, thickness: 0.36 },
        { centerX: 3, centerZ: -3, topY: 7.8, width: 4, depth: 5.5, thickness: 0.36 },
    ],
};
