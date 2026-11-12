import { AudioOutput, play, registerClip, type Resource, type World } from "@dylanebert/shallot";

export type GameSound = "landing" | "launch" | "checkpoint" | "failure" | "complete";
type GameAudioHandles = Record<GameSound, number>;

const gameAudio: Resource<GameAudioHandles> = {
    create: () => ({ landing: -1, launch: -1, checkpoint: -1, failure: -1, complete: -1 }),
};

function tone(
    sampleRate: number,
    duration: number,
    startHz: number,
    endHz: number,
    gain: number,
): Float32Array {
    const sampleCount = Math.max(1, Math.floor(sampleRate * duration));
    const samples = new Float32Array(sampleCount);
    let phase = 0;
    for (let index = 0; index < sampleCount; index++) {
        const t = index / sampleCount;
        const frequency = startHz + (endHz - startHz) * t;
        const attack = Math.min(1, t / 0.04);
        const release = Math.min(1, (1 - t) / 0.25);
        const envelope = attack * release * (1 - 0.18 * t);
        samples[index] = Math.sin(phase) * gain * envelope;
        phase += (2 * Math.PI * frequency) / sampleRate;
    }
    return samples;
}

function completion(sampleRate: number): Float32Array {
    const duration = 0.85;
    const samples = new Float32Array(Math.floor(sampleRate * duration));
    const notes = [523.25, 659.25, 783.99];
    for (let index = 0; index < samples.length; index++) {
        const time = index / sampleRate;
        const note = Math.min(notes.length - 1, Math.floor(time / 0.18));
        const localTime = time - note * 0.18;
        const envelope = Math.min(1, localTime / 0.015) * Math.max(0, 1 - localTime / 0.3);
        samples[index] = Math.sin(2 * Math.PI * notes[note]! * localTime) * 0.16 * envelope;
    }
    return samples;
}

export function initializeGameAudio(world: World): void {
    const sampleRate = world.resource(AudioOutput).context?.sampleRate ?? 48000;
    const handles = world.resource(gameAudio);
    handles.landing = registerClip(world, tone(sampleRate, 0.12, 210, 105, 0.2), sampleRate, "landing");
    handles.launch = registerClip(world, tone(sampleRate, 0.22, 170, 460, 0.16), sampleRate, "launch");
    handles.checkpoint = registerClip(world, tone(sampleRate, 0.3, 480, 720, 0.18), sampleRate, "checkpoint");
    handles.failure = registerClip(world, tone(sampleRate, 0.24, 220, 95, 0.17), sampleRate, "failure");
    handles.complete = registerClip(world, completion(sampleRate), sampleRate, "complete");
}

export function playGameAudio(world: World, event: GameSound, volume = 1): void {
    const clip = world.resource(gameAudio)[event];
    if (clip >= 0) play(world, clip, { volume });
}
