/** DOM-free rhythm judge. All times are seconds from the injected transport clock. */
export interface RhythmSpec { id:string; cues:number; interval:number; lead:number; window:number; need:number; style?:string }
export type CueState='pending'|'hit'|'miss';
export interface RhythmFrame { elapsed:number; duration:number; hits:number; cues:number; cue:number; visible:boolean; ring:number; feedback:'hit'|'miss'|'offbeat'|''; paused:boolean; done:boolean }
export function rhythmCueTimes(spec:RhythmSpec):number[] {
  if(!Number.isInteger(spec.cues)||spec.cues<1||spec.cues>64||![spec.interval,spec.lead,spec.window].every(Number.isFinite)||spec.interval<=0||spec.lead<=0||spec.window<0||spec.window>=spec.interval/2)throw new Error('Invalid rhythm timing');
  return Array.from({length:spec.cues},(_,i)=>spec.lead+i*spec.interval);
}
export class RhythmRound {
  readonly times:number[];
  readonly states:CueState[];
  readonly duration:number;
  private start:number;
  private pauseAt?:number;
  private feedback:RhythmFrame['feedback']='';
  private feedbackUntil=0;
  constructor(readonly spec:RhythmSpec,private now:()=>number) {
    this.times=rhythmCueTimes(spec);this.states=this.times.map(()=>'pending');this.duration=this.times.at(-1)!+spec.window;this.start=now();
  }
  private elapsedAt(at:number){return Math.max(0,(this.pauseAt??at)-this.start);}
  get elapsed(){return this.elapsedAt(this.now());}
  get hits(){return this.states.filter(s=>s==='hit').length;}
  get paused(){return this.pauseAt!==undefined;}
  setPaused(paused:boolean,at=this.now()) {
    if(paused&&!this.paused)this.pauseAt=at;
    else if(!paused&&this.pauseAt!==undefined){this.start+=at-this.pauseAt;this.pauseAt=undefined;}
  }
  sample(at=this.now()):RhythmFrame {
    const t=this.elapsedAt(at);
    for(let i=0;i<this.times.length;i++)if(this.states[i]==='pending'&&t>this.times[i]+this.spec.window+1e-9){this.states[i]='miss';this.feedback='miss';this.feedbackUntil=t+.65;}
    const next=this.states.findIndex(s=>s==='pending'),i=next<0?this.times.length-1:next,until=this.times[i]-t;
    return {elapsed:t,duration:this.duration,hits:this.hits,cues:this.times.length,cue:i+1,visible:next>=0&&until<=this.spec.lead&&until>=-this.spec.window,
      ring:Math.max(0,Math.min(1,until/this.spec.lead)),feedback:t<=this.feedbackUntil?this.feedback:'',paused:this.paused,done:t>this.duration+1e-9};
  }
  /** `at` is the input instant on the transport clock, never the last rendered frame time. */
  clap(at=this.now()):boolean {
    if(!Number.isFinite(at)||at<this.start||this.paused)return false;
    const frame=this.sample(at);if(frame.done)return false;
    const t=frame.elapsed;
    // A render may have marked a miss while a timely DOM event was queued behind it.
    // Its original timestamp may recover that miss, but can never count an already-hit cue twice.
    const i=this.times.findIndex((cue,i)=>this.states[i]!=='hit'&&Math.abs(t-cue)<=this.spec.window+1e-9);
    if(i<0){this.feedback='offbeat';this.feedbackUntil=t+.45;return false;}
    this.states[i]='hit';this.feedback='hit';this.feedbackUntil=t+.65;return true;
  }
}
/** Accents occur at exactly the judged cue times, regardless of the chosen arpeggio style. */
export function guitarScore(spec:RhythmSpec):{at:number;midi:number;accent:boolean}[] {
  const times=rhythmCueTimes(spec),slow=/slow|慢/.test(spec.style??''),step=spec.interval/(slow?2:4);
  const chords=[[48,55,60,64],[45,52,57,60],[41,48,53,57],[43,50,55,59]];
  const notes:{at:number;midi:number;accent:boolean}[]=[];
  times.forEach((at,i)=>{
    const chord=chords[i%chords.length];notes.push({at,midi:chord[2]+12,accent:true});
    for(let j=0;j<(slow?2:4);j++){const t=at-spec.lead+j*step;if(t>=0&&t<=times.at(-1)!+spec.window)notes.push({at:t,midi:chord[j%4],accent:false});}
  });
  return notes.sort((a,b)=>a.at-b.at);
}
