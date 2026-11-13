import type { LevelDefinition, LevelBoxPlatformObjectDefinition, SurfaceCollision } from "../content/level";

export function mountSectionProperties(root: HTMLElement, level: LevelDefinition, apply: (next: LevelDefinition) => void): void {
    const panel = root.querySelector<HTMLElement>("[data-sections]")!;
    if (panel.contains(document.activeElement)) return;
    panel.replaceChildren();
    const label = document.createElement("label");
    label.textContent = "Ordered sections (id, checkpointId, instruction)";
    const input = document.createElement("textarea");
    input.value = JSON.stringify(level.sections ?? [], null, 2);
    input.addEventListener("change", () => {
        try {
            const sections: unknown = JSON.parse(input.value);
            const next = { ...level };
            if (Array.isArray(sections) && sections.length === 0) delete next.sections;
            else next.sections = sections as LevelDefinition["sections"];
            apply(next);
            input.setCustomValidity("");
        } catch { input.setCustomValidity("Enter a valid sections JSON array."); input.reportValidity(); }
    });
    label.append(input);
    panel.append(label);
}

export function mountSlopeProperty(panel: HTMLElement, object: Pick<LevelBoxPlatformObjectDefinition, "collision">, apply: (collision: SurfaceCollision) => void): void {
    const label = document.createElement("label");
    label.textContent = "Slope rise along local X (0 uses box collision)";
    const input = document.createElement("input");
    input.type = "number";
    input.step = "0.1";
    input.dataset.platformProperty = "slope";
    input.value = String(object.collision.kind === "slope" ? object.collision.rise : 0);
    input.addEventListener("change", () => {
        const rise = Number(input.value);
        if (!Number.isFinite(rise)) return;
        const { dimensions, mode } = object.collision;
        apply(rise === 0 ? { kind: "box", dimensions, ...(mode ? { mode } : {}) } : { kind: "slope", dimensions, rise, ...(mode ? { mode } : {}) });
    });
    label.append(input);
    panel.append(label);
}
