/** Generative background music: soft pad, warm bass and a pentatonic pluck melody, scheduled ahead on the
 * AudioContext clock. Each lighting preset has its own key, chords and tempo; changes cross over at the next bar.
 * No audio files: everything is synthesised, so there is nothing to license or download. */
export type MusicMood = 'day' | 'sunset' | 'night';

interface Mood { bpm: number; root: number; chords: number[][]; scale: number[]; density: number; bright: number }
// Semitone offsets from the mood's root (MIDI note). Chords are voiced as pad triads.
const MOODS: Record<MusicMood, Mood> = {
  // C major pentatonic, I–vi–IV–V: bright campus morning.
  day: { bpm: 84, root: 60, chords: [[0, 4, 7], [9, 12, 16], [5, 9, 12], [7, 11, 14]], scale: [0, 2, 4, 7, 9, 12, 14, 16], density: .62, bright: 2400 },
  // F major, I–vi–IV–V slower and warmer: 西子灣夕陽.
  sunset: { bpm: 72, root: 65, chords: [[0, 4, 7], [-3, 0, 4], [-7, -3, 0], [-5, -1, 2]], scale: [0, 2, 4, 7, 9, 12, 14], density: .48, bright: 1700 },
  // A minor pentatonic, i–VI–III–VII sparse: night by the sea.
  night: { bpm: 64, root: 57, chords: [[0, 3, 7], [-4, 0, 3], [3, 7, 10], [-2, 2, 5]], scale: [0, 3, 5, 7, 10, 12, 15], density: .32, bright: 1200 },
};
const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

export class GenerativeMusic {
  private out: GainNode;
  private pad: GainNode;
  private lp: BiquadFilterNode;
  private timer = 0;
  private nextBar = 0;
  private bar = 0;
  private lastNote = 4;
  private mood: MusicMood = 'day';
  private duck = 1;
  private voices = new Set<OscillatorNode>();
  private disposed = false;

  constructor(private ctx: AudioContext, destination: AudioNode, private level = .26) {
    this.out = ctx.createGain(); this.out.gain.value = 0;
    // Gentle space: a short feedback delay instead of a convolver keeps it cheap on phones.
    const delay = ctx.createDelay(1); delay.delayTime.value = .33;
    const fb = ctx.createGain(); fb.gain.value = .28;
    const wet = ctx.createGain(); wet.gain.value = .22;
    this.lp = ctx.createBiquadFilter(); this.lp.type = 'lowpass'; this.lp.frequency.value = 2400;
    this.pad = ctx.createGain(); this.pad.gain.value = 1;
    this.pad.connect(this.lp); this.lp.connect(this.out);
    this.lp.connect(delay); delay.connect(fb); fb.connect(delay); delay.connect(wet); wet.connect(this.out);
    this.out.connect(destination);
  }

  setMood(mood: MusicMood) { this.mood = mood; }

  /** Lower the music while a dialogue is open (0..1). */
  setDuck(amount: number) {
    this.duck = amount;
    this.out.gain.setTargetAtTime(this.timer ? this.level * this.duck : 0, this.ctx.currentTime, .4);
  }

  start() {
    if (this.timer || this.disposed || this.ctx.state === 'closed') return;
    this.nextBar = this.ctx.currentTime + .1;
    this.out.gain.setTargetAtTime(this.level * this.duck, this.ctx.currentTime, 1.5);
    // Look-ahead scheduler: plan bars ~1.5 s ahead of the audio clock.
    this.timer = window.setInterval(() => { while (this.nextBar < this.ctx.currentTime + 1.5) this.scheduleBar(); }, 250);
  }

  /** Stop scheduling and silence every voice already queued (a suspended context would otherwise resume them). */
  stop() {
    clearInterval(this.timer); this.timer = 0;
    this.out.gain.cancelScheduledValues(this.ctx.currentTime); this.out.gain.setValueAtTime(0, this.ctx.currentTime);
    for (const o of this.voices) { try { o.stop(); } catch { /* not started yet */ } o.disconnect(); }
    this.voices.clear();
  }

  private voice(type: OscillatorType, freq: number, at: number, dur: number, peak: number, attack: number, dest: AudioNode, detune = 0) {
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.value = freq; o.detune.value = detune;
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(peak, at + attack);
    g.gain.setTargetAtTime(0, at + Math.max(attack, dur - .3), .35);
    o.connect(g); g.connect(dest);
    o.start(at); o.stop(at + dur + 1.6);
    this.voices.add(o); o.onended = () => { this.voices.delete(o); g.disconnect(); };
  }

  private scheduleBar() {
    const m = MOODS[this.mood], beat = 60 / m.bpm, barLen = beat * 4, at = this.nextBar;
    this.lp.frequency.setTargetAtTime(m.bright, at, 1);
    const chord = m.chords[this.bar % m.chords.length];
    // Pad: each chord tone twice, slightly detuned, slow swell over the bar.
    for (const n of chord) for (const d of [-6, 6]) this.voice('triangle', hz(m.root + n - 12), at, barLen, .045, beat * 1.2, this.pad, d);
    // Bass on beats 1 and 3.
    this.voice('sine', hz(m.root + chord[0] - 24), at, beat * 1.8, .16, .02, this.pad);
    this.voice('sine', hz(m.root + chord[0] - 24), at + beat * 2, beat * 1.6, .12, .02, this.pad);
    // Melody: eighth-note grid, a small random walk on the scale, favouring chord tones on strong beats.
    for (let step = 0; step < 8; step++) {
      if (Math.random() > m.density * (step % 2 ? .7 : 1)) continue;
      const move = Math.floor(Math.random() * 5) - 2;
      this.lastNote = Math.max(0, Math.min(m.scale.length - 1, this.lastNote + move));
      let note = m.scale[this.lastNote];
      if (step % 4 === 0) note = chord[Math.floor(Math.random() * chord.length)] + 12;
      const t = at + step * beat / 2;
      this.voice('triangle', hz(m.root + note), t, beat * .9, .07, .008, this.lp);
      this.voice('sine', hz(m.root + note + 12), t, beat * .5, .02, .004, this.lp);
    }
    this.bar++;
    this.nextBar += barLen;
  }

  dispose() { this.disposed = true; this.stop(); this.out.disconnect(); }
}
