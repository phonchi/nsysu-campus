import { RhythmRound,guitarScore,type RhythmSpec } from './rhythm';
/** One clock for scoring, ring progress and scheduled plucks. A muted session still runs;
 * without Web Audio it uses a monotonic visual-only clock supplied by the caller. */
export class RhythmPerformance {
  readonly round:RhythmRound;
  private voices=new Set<AudioBufferSourceNode>();
  private buffers=new Map<number,AudioBuffer>();
  private audible=false;
  private paused=false;
  private disposed=false;
  constructor(spec:RhythmSpec,private clock:()=>number,private ctx?:AudioContext,private destination?:AudioNode,private wallNow=()=>performance.now()) {this.round=new RhythmRound(spec,clock);}
  /** DOM timestamps and performance.now share an origin; project a queued input back onto the
   * same audio/visual transport clock used by the score. Invalid/legacy timestamps use handler time. */
  captureTime(eventTimestamp?:number) {
    const at=this.clock(),wall=this.wallNow();
    return eventTimestamp!==undefined&&Number.isFinite(eventTimestamp)&&eventTimestamp>=0&&eventTimestamp<=wall
      ? at-(wall-eventTimestamp)/1000 : at;
  }
  update(paused:boolean,audible:boolean,at=this.clock()) {
    if(this.disposed)return this.round.sample();
    const changed=paused!==this.paused||audible!==this.audible;
    this.round.setPaused(paused,at);this.paused=paused;this.audible=audible;
    if(changed){this.stopVoices();if(!paused&&audible)this.schedule();}
    return this.round.sample();
  }
  clap(at=this.clock()){return !this.disposed&&this.round.clap(at);}
  private buffer(midi:number) {
    const cached=this.buffers.get(midi);if(cached)return cached;
    const ctx=this.ctx!,frequency=440*2**((midi-69)/12),period=Math.round(ctx.sampleRate/frequency);
    const ring=new Float32Array(period);let seed=midi*127+1;
    for(let i=0;i<period;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;ring[i]=seed/0xffffffff*2-1;}
    const buf=ctx.createBuffer(1,Math.ceil(ctx.sampleRate*1.8),ctx.sampleRate),data=buf.getChannelData(0);
    // Karplus–Strong: a noise-excited string loses high frequencies as it decays.
    for(let i=0;i<data.length;i++){const n=i%period;data[i]=ring[n];ring[n]=.496*(ring[n]+ring[(n+1)%period]);}
    this.buffers.set(midi,buf);return buf;
  }
  private schedule() {
    if(!this.ctx||!this.destination)return;
    const elapsed=this.round.elapsed,origin=this.ctx.currentTime-elapsed;
    for(const note of guitarScore(this.round.spec)) {
      if(note.at<elapsed)continue;
      const source=this.ctx.createBufferSource(),gain=this.ctx.createGain();source.buffer=this.buffer(note.midi);
      gain.gain.value=note.accent?.22:.12;source.connect(gain).connect(this.destination);
      this.voices.add(source);source.onended=()=>{source.disconnect();gain.disconnect();this.voices.delete(source);};
      source.start(origin+note.at);source.stop(origin+note.at+1.8);
    }
  }
  private stopVoices(){for(const source of this.voices){try{source.stop();}catch{/* already ended */}}this.voices.clear();}
  dispose(){this.stopVoices();this.buffers.clear();this.disposed=true;}
}
