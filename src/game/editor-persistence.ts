import { parseLevelDefinition, type LevelDefinition } from "../content/level";

export async function saveLevelFile(level: LevelDefinition, overwrite: boolean, request: typeof fetch = fetch): Promise<void> {
    const validated = parseLevelDefinition(level);
    const response = await request(`/__editor/levels/${encodeURIComponent(validated.id)}`, {
        method: "PUT",
        headers: { "content-type": "application/json", "x-level-operation": overwrite ? "overwrite" : "create" },
        body: JSON.stringify(validated, null, 2),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(typeof result.error === "string" ? result.error : `HTTP ${response.status}`);
}
