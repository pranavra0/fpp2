import type { Resource } from "@dylanebert/shallot";
import type { LevelDefinition } from "../content/level";

export type PlaytestRevision = { level: LevelDefinition; revision: string; testFrom?: string };
export const playtestRevision: Resource<{ current?: PlaytestRevision }> = { create: () => ({}) };

declare module "vite/types/customEvent.d.ts" {
    interface CustomEventMap { "fpp2:blender": PlaytestRevision }
}
