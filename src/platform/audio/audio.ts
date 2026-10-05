import { preferences, setPreferences, subscribePreferences } from '../preferences/preferences';
let context: AudioContext | undefined, effects: GainNode | undefined, score: GainNode | undefined;
let scene: 'menu' | 'campaign' | 'city' | 'battle' | null = 'menu';
let interval: number | undefined, step = 0, lastImpact = 0;
const melody = [57, 60, 64, 67, 64, 60, 62, 59, 55, 59, 62, 64, 62, 59, 57, 52];
const hz = (note: number) => 440 * 2 ** ((note - 69) / 12);
function levels() {
    if (!context)
        return;
    const p = preferences();
    effects?.gain.setTargetAtTime(p.sound ? p.volume / 100 : 0, context.currentTime, .1);
    score?.gain.setTargetAtTime(p.music ? p.musicVolume / 100 : 0, context.currentTime, .25);
}
subscribePreferences(levels);
export function unlockAudio() {
    try {
        if (!context) {
            context = new AudioContext();
            effects = context.createGain();
            effects.connect(context.destination);
            score = context.createGain();
            score.connect(context.destination);
            levels();
        }
        void context.resume();
        if (!interval) {
            playScore();
            interval = window.setInterval(playScore, 2000);
        }
    }
    catch { /* Sound is optional. */ }
}
function note(frequency: number, at: number, length: number, gain: number, bus: GainNode, type: OscillatorType = 'triangle') {
    if (!context)
        return;
    const oscillator = context.createOscillator(), envelope = context.createGain();
    oscillator.type = type;
    oscillator.frequency.value = frequency;
    envelope.gain.setValueAtTime(.0001, at);
    envelope.gain.exponentialRampToValueAtTime(gain, at + .025);
    envelope.gain.exponentialRampToValueAtTime(.0001, at + length);
    oscillator.connect(envelope);
    envelope.connect(bus);
    oscillator.start(at);
    oscillator.stop(at + length + .05);
}
function noise(at: number, length: number, gain: number, frequency: number) {
    if (!context || !effects)
        return;
    const buffer = context.createBuffer(1, Math.ceil(context.sampleRate * length), context.sampleRate), data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++)
        data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    const source = context.createBufferSource(), filter = context.createBiquadFilter(), envelope = context.createGain();
    source.buffer = buffer;
    filter.type = 'lowpass';
    filter.frequency.value = frequency;
    envelope.gain.setValueAtTime(gain, at);
    envelope.gain.exponentialRampToValueAtTime(.0001, at + length);
    source.connect(filter);
    filter.connect(envelope);
    envelope.connect(effects);
    source.start(at);
}
function playScore() {
    if (!context || !score || !scene || context.state !== 'running' || !preferences().music)
        return;
    const at = context.currentTime, combat = scene === 'battle', root = step % 16 < 8 ? 45 : 43;
    note(hz(root), at, 2.8, .065, score, 'sine');
    note(hz(root + 7), at + .1, 2.6, .028, score, 'sine');
    for (let i = 0; i < 4; i++)
        note(hz(melody[(step + i) % melody.length] - (combat ? 12 : 0)), at + i * .5, 1.1, combat ? .065 : .042, score);
    if (combat) {
        note(62, at, .25, .12, score, 'sine');
        note(52, at + 1, .28, .09, score, 'sine');
    }
    step = (step + 4) % 16;
}
export function setAudioScene(next: typeof scene) { scene = next; }
export function audioEnabled() { return preferences().sound; }
export function setAudio(value: boolean) { setPreferences({ sound: value }); if (value) {
    unlockAudio();
    tone('order');
} }
export function tone(kind: 'order' | 'success' | 'error' | 'arrow' | 'charge' | 'route' | 'select') {
    if (!preferences().sound)
        return;
    unlockAudio();
    if (!context || !effects)
        return;
    const at = context.currentTime;
    if (['arrow', 'charge', 'route'].includes(kind)) {
        if (at - lastImpact < .38)
            return;
        lastImpact = at;
    }
    if (kind === 'arrow') {
        noise(at, .16, .06, 3800);
        return;
    }
    if (kind === 'charge') {
        noise(at, .3, .14, 950);
        note(65, at, .5, .13, effects, 'sine');
        return;
    }
    if (kind === 'route') {
        note(160, at, .5, .06, effects);
        note(120, at + .1, .55, .05, effects);
        return;
    }
    const notes = kind === 'success' ? [196, 247, 294, 392] : kind === 'error' ? [175, 130] : kind === 'select' ? [310] : [294, 392];
    notes.forEach((frequency, i) => note(frequency, at + i * .09, kind === 'success' ? .75 : .2, kind === 'select' ? .02 : .065, effects!));
}
