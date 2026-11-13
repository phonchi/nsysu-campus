/** Synthesised ambience and cues (spec §10). Muted by default; no AudioContext exists until the player
 * turns sound on, so ordinary silent exploration never touches the audio device. An accepted rhythm activity may use a muted audio clock. No audio files are shipped. */
import { RhythmPerformance } from './rhythm-performance';
import type { RhythmSpec } from './rhythm';
import { GenerativeMusic, type MusicMood } from './music';

const KEY = 'nsysu-walk-sound';

export class CampusSound {
  private ctx?: AudioContext;
  private master?: GainNode;
  private sea?: GainNode;
  private cicada?: GainNode;
  private wind?: GainNode;
  private stepTimer = 0;
  private music?: GenerativeMusic;
  private performance?:RhythmPerformance;
  private activityPrepared = false;
  private mood: MusicMood = 'day';
  private gen = 0;
  enabled = false;

  constructor() { try { this.enabled = localStorage.getItem(KEY) === 'on'; } catch { /* default muted */ } }

  get state() { return this.ctx?.state ?? 'none'; }
  get musicPlaying() { return !!this.music && this.enabled; }

  /** Toggle from a user gesture (required for autoplay policies). */
  async toggle() {
    this.enabled = !this.enabled;
    try { localStorage.setItem(KEY, this.enabled ? 'on' : 'off'); } catch { /* per visit */ }
    // A later toggle or dispose supersedes this one: never restart music after an await that lost the race.
    const gen = ++this.gen;
    if (this.enabled) { this.start(); this.master!.gain.value=.5;await this.ctx!.resume(); if (gen === this.gen && this.enabled && this.ctx && !this.performance) this.music?.start(); }
    else { this.music?.stop();if(this.master)this.master.gain.value=0;if(!this.performance)await this.ctx?.suspend(); }
    return this.enabled;
  }

  /** A hidden tab pauses playback and judgement; a muted round still needs its clock on return. */
  setHidden(hidden: boolean) {
    if(hidden)this.performance?.update(true,false);
    if (!this.ctx || this.ctx.state === 'closed') return;
    if (hidden) {void this.ctx.suspend();}
    else if (this.enabled || this.performance) void this.ctx.resume();
  }

  /** Called on the first gesture when sound was left on last visit. */
  resumeIfEnabled() { if (this.enabled) { this.start(); void this.ctx!.resume(); if(!this.performance)this.music?.start(); } }

  /** Called by the invitation's user gesture. Muted activities use a zero-gain clock. */
  prepareActivity() { this.activityPrepared=true;try {this.start();void this.ctx!.resume().catch(()=>{});}catch{/* visual timing remains available */} }
  startRhythm(spec:RhythmSpec) {
    this.performance?.dispose();this.performance=undefined;this.music?.stop();try{this.start();}catch{/* no Web Audio: visual-only */}
    if(this.ctx && this.ctx.state!=='running')void this.ctx.resume().catch(()=>{});
    const ctx=this.ctx;let elapsed=0,lastWall=performance.now()/1000,lastAudio:number|undefined;
    const clock=()=>{
      const wall=performance.now()/1000;
      if(ctx?.state==='running'){const audio=ctx.currentTime;if(lastAudio!==undefined)elapsed+=Math.max(0,audio-lastAudio);lastAudio=audio;}
      else {elapsed+=Math.max(0,wall-lastWall);lastAudio=undefined;}
      lastWall=wall;return elapsed;
    };
    this.performance=new RhythmPerformance(spec,clock,ctx,this.master);return this.performance;
  }
  updateRhythm(paused:boolean,at?:number) { return this.performance?.update(paused,this.enabled && this.ctx?.state==='running',at); }
  stopRhythm() {
    const had=!!this.performance,prepared=this.activityPrepared;this.activityPrepared=false;
    this.performance?.dispose();this.performance=undefined;
    if(had && this.enabled)this.music?.start();
    // Also release a muted context prepared by an accepted invitation that was later cancelled.
    if((had||prepared)&&!this.enabled)void this.ctx?.suspend();
  }

  /** Music follows the lighting preset; it changes key and tempo at the next bar. */
  setMood(mood: MusicMood) { this.mood = mood; this.music?.setMood(mood); }
  /** Lower the music while someone is talking. */
  duck(on: boolean) { this.music?.setDuck(on ? .45 : 1); }

  private noise(seconds = 2) {
    const ctx = this.ctx!, buf = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate), d = buf.getChannelData(0);
    let b = 0;
    for (let i = 0; i < d.length; i++) { b = .985 * b + .015 * (Math.random() * 2 - 1); d[i] = b * 6; } // brown-ish
    const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true; return src;
  }

  private start() {
    if (this.ctx) return;
    const ctx = this.ctx = new AudioContext();
    this.master = ctx.createGain(); this.master.gain.value = this.enabled ? .5 : 0; this.master.connect(ctx.destination);
    // Sea: filtered noise with a slow swell.
    this.sea = ctx.createGain(); this.sea.gain.value = 0;
    const seaSrc = this.noise(4), lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 700;
    const swell = ctx.createOscillator(), swellGain = ctx.createGain(); swell.frequency.value = .11; swellGain.gain.value = .35;
    const swellBias = ctx.createGain(); swellBias.gain.value = .65;
    swell.connect(swellGain).connect(swellBias.gain);
    seaSrc.connect(lp).connect(swellBias).connect(this.sea).connect(this.master);
    seaSrc.start(); swell.start();
    // Cicadas: band-passed noise, amplitude-modulated at ~30 Hz.
    this.cicada = ctx.createGain(); this.cicada.gain.value = 0;
    const cSrc = this.noise(2), bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 5200; bp.Q.value = 6;
    const trem = ctx.createOscillator(), tremGain = ctx.createGain(), tremBias = ctx.createGain(); trem.frequency.value = 31; tremGain.gain.value = .5; tremBias.gain.value = .5;
    trem.connect(tremGain).connect(tremBias.gain);
    cSrc.connect(bp).connect(tremBias).connect(this.cicada).connect(this.master);
    cSrc.start(); trem.start();
    // Soft wind bed everywhere.
    this.wind = ctx.createGain(); this.wind.gain.value = .04;
    const wSrc = this.noise(3), wlp = ctx.createBiquadFilter(); wlp.type = 'lowpass'; wlp.frequency.value = 320;
    wSrc.connect(wlp).connect(this.wind).connect(this.master); wSrc.start();
    this.music = new GenerativeMusic(ctx, this.master); this.music.setMood(this.mood);
  }

  /** Per-frame mix: sea louder near the coast, cicadas by day near trees, quiet indoors. */
  ambience(seaProximity: number, daylight: number, indoors: boolean) {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime, k = indoors ? .25 : 1;
    this.sea!.gain.setTargetAtTime(.32 * seaProximity * k, t, .5);
    this.cicada!.gain.setTargetAtTime(.035 * daylight * k, t, .8);
    this.wind!.gain.setTargetAtTime(.04 * k, t, .8);
  }

  /** Footsteps while moving; interval follows speed. */
  footsteps(speed: number, dt: number, surface: 'hard' | 'soft') {
    if (!this.ctx || !this.enabled || speed < .5) { this.stepTimer = 0; return; }
    this.stepTimer -= dt;
    if (this.stepTimer > 0) return;
    this.stepTimer = speed > 5 ? .3 : .46;
    const ctx = this.ctx, t = ctx.currentTime, src = this.noise(.2), f = ctx.createBiquadFilter(), g = ctx.createGain();
    f.type = 'bandpass'; f.frequency.value = surface === 'hard' ? 1800 : 600; f.Q.value = 1.2;
    g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(surface === 'hard' ? .22 : .12, t + .01); g.gain.exponentialRampToValueAtTime(.0001, t + .09);
    src.connect(f).connect(g).connect(this.master!); src.start(t); src.stop(t + .12);
  }

  /** Short cues: chime (quest), echo (tunnel), page (dialogue), fanfare (chapter), stamp, shutter, monkey, pop. */
  cue(id: string) {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const notes: Record<string, number[]> = { chime: [880, 1320], page: [660], fanfare: [523, 659, 784, 1047], echo: [392, 392, 392], stamp: [196, 1568], shutter: [2093, 1046], monkey: [988, 1319, 988], pop: [880] };
    (notes[id] ?? [740]).forEach((freq, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain(), at = t + i * (id === 'echo' ? .28 : .11), peak = id === 'echo' ? .12 / (i + 1) : .14;
      o.type = id === 'page' ? 'triangle' : 'sine'; o.frequency.value = freq;
      g.gain.setValueAtTime(.0001, at); g.gain.exponentialRampToValueAtTime(peak, at + .015); g.gain.exponentialRampToValueAtTime(.0001, at + (id === 'fanfare' ? .6 : .45));
      o.connect(g).connect(this.master!); o.start(at); o.stop(at + .7);
    });
  }

  dispose() { this.gen++; this.enabled = false;this.performance?.dispose();this.performance=undefined; this.music?.dispose(); this.music = undefined; void this.ctx?.close(); this.ctx = undefined; }
}
