import type { LevelDefinition } from "../content/level";
import type { EditorState } from "./editor-state";

const HISTORY_LIMIT = 50;

export function cloneLevel(level: LevelDefinition): LevelDefinition {
    return structuredClone(level);
}

export function sameLevel(a: LevelDefinition, b: LevelDefinition): boolean {
    return JSON.stringify(a) === JSON.stringify(b);
}

export function dirty(editor: EditorState, level: LevelDefinition): boolean {
    return editor.saved === undefined || !sameLevel(editor.saved, level);
}

export function saveHistory(editor: EditorState, level: LevelDefinition): void {
    editor.undo.push(cloneLevel(level));
    if (editor.undo.length > HISTORY_LIMIT) editor.undo.shift();
    editor.redo.length = 0;
}
