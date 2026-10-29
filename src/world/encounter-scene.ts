import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import type { ActorBody } from '../walk/obstacles';
import type { EncounterDefinition } from '../story/encounters';
import { toonify } from '../render/toon';
import { disposeObject } from './npc';
export interface EncounterSceneOptions {
  asset(path: string): string;
  ground(x: number, z: number, referenceY?: number): number | undefined;
  sweep(from: T.Vector3, to: T.Vector3, radius: number): number;
  actorSweep?(id:string,from:T.Vector3,to:T.Vector3,radius:number,height:number):number;
}
/** All event motion is confined to a short ground-supported, swept safe corridor. */
export function encounterCorridor(origin: T.Vector3, ground: EncounterSceneOptions['ground'], sweep: EncounterSceneOptions['sweep'], height = 1.7, radius = .38, canSpawn?: (foot:T.Vector3)=>boolean): T.Vector3[] {
  for (let turn = 0; turn < 12; turn++) {
    const angle = turn * Math.PI / 6, points: T.Vector3[] = []; let last = origin.clone(), valid = true;
    for (let d = 1; d <= 13; d++) {
      const p = new T.Vector3(origin.x + Math.cos(angle) * d, 0, origin.z + Math.sin(angle) * d); const support = ground(p.x,p.z,last.y);
      if (support === undefined) { valid = false; break; } p.y = support;
      if (!Number.isFinite(p.y) || Math.abs(p.y - last.y) > .45) { valid = false; break; }
      const from = last.clone().add(new T.Vector3(0,height/2+.025,0)), to = p.clone().add(new T.Vector3(0,height/2+.025,0));
      // The actor appears 3 m away: never sweep a new actor out of the player's body.
      // Keep checking support from the origin, then require the actual spawn volume to be empty.
      if (d === 3 && canSpawn && !canSpawn(p)) { valid = false; break; }
      if (d > 3 && sweep(from,to,radius) < from.distanceTo(to) - .02) { valid = false; break; }
      if (d >= 3) points.push(p); last = p;
    }
    if (valid) return points;
  }
  return [];
}
export class EncounterScene {
  readonly group = new T.Group();
  private moving = new T.Group();
  private corridor: T.Vector3[] = [];
  private index = 0;
  private time = 0;
  private definition?: EncounterDefinition;
  private monkey?: T.Object3D;
  private mixer?: T.AnimationMixer;
  private pending?: Promise<void>;
  private disposed = false;
  private actorId = 'encounter:scene';
  private height = .7;
  private radius = .24;
  constructor(parent: T.Object3D, private options: EncounterSceneOptions) { this.group.name = '歡樂校園事件'; parent.add(this.group); this.group.visible = false; }
  start(definition: EncounterDefinition, origin: T.Vector3) {
    this.reset();
    this.actorId = `encounter:${definition.id}`;
    this.height = definition.id.startsWith('monkey-') ? .7 : definition.id === 'rolling-ball' ? .55 : .6;
    this.radius = definition.id === 'rolling-ball' ? .27 : .24;
    const sweep = (a:T.Vector3,b:T.Vector3,r:number) => this.options.actorSweep?.(this.actorId,a,b,r,this.height) ?? this.options.sweep(a,b,r);
    const canSpawn=this.options.actorSweep?(foot:T.Vector3)=>{const center=foot.clone().add(new T.Vector3(0,this.height/2+.025,0));return this.options.actorSweep!(this.actorId,center,center,this.radius,this.height)>0;}:undefined;
    const corridor = encounterCorridor(origin,this.options.ground,sweep,this.height,this.radius,canSpawn);
    if (!corridor.length) return false;
    this.corridor = corridor; this.definition = definition; this.index = 1; this.time = 0;
    this.moving.position.copy(corridor[0]); this.group.add(this.moving); this.group.visible = true;
    if (definition.id.startsWith('monkey-')) {
      this.loadMonkey();
      const gift = this.mesh(new T.BoxGeometry(.28,.32,.14), definition.id === 'monkey-hat' ? 0xe9b949 : 0xc75f4a); gift.position.set(.25,.65,.12); this.moving.add(gift);
    } else if (definition.id === 'rolling-ball') {
      const ball = this.mesh(new T.SphereGeometry(.27,12,8),0xe9b949); ball.position.y = .28; this.moving.add(ball);
    } else if (definition.id === 'wind-flyer') {
      for(let i=0;i<5;i++){ const paper=this.mesh(new T.BoxGeometry(.25,.015,.34),i%2?0xfbF6ea:0x2c7f91); paper.position.set((i-2)*.18,.6+i*.12,0); this.moving.add(paper); }
    } else if (definition.id === 'pop-up-song') {
      // Tangible little music notes rise above the shared meeting point.
      for(let i=0;i<5;i++){ const note=this.mesh(new T.SphereGeometry(.08,6,4),0xe9b949); note.position.set((i-2)*.35,1.3+(i%2)*.3,0); this.moving.add(note); const stem=this.mesh(new T.BoxGeometry(.025,.35,.025),0xe9b949); stem.position.copy(note.position).add(new T.Vector3(.06,.15,0)); this.moving.add(stem); }
    } else {
      // Three marked group-photo positions with room for the player, no impassable prop.
      for(let i=0;i<3;i++){const ring=this.mesh(new T.TorusGeometry(.3,.035,4,16),0x2c7f91);ring.rotation.x=-Math.PI/2;ring.position.set((i-1)*.85,.07,0);this.moving.add(ring);}
    }
    return true;
  }
  private mesh(geometry: T.BufferGeometry, color: number) { return new T.Mesh(geometry,new T.MeshToonMaterial({color})); }
  private loadMonkey() {
    if (this.monkey) { this.monkey.visible = true; return; }
    if (this.pending) return;
    this.pending = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(this.options.asset('models/characters/monkey.glb')).then(g=>{
      if (this.disposed) {disposeObject(g.scene);return;}
      this.monkey=g.scene; toonify(g.scene); this.mixer=new T.AnimationMixer(g.scene); const clip=g.animations.find(c=>c.name==='Run')??g.animations.find(c=>c.name==='Walk'); if(clip)this.mixer.clipAction(clip).play(); this.moving.add(g.scene); g.scene.visible=!!this.definition?.id.startsWith('monkey-');
    }).catch(()=>{}).finally(()=>{this.pending=undefined;});
  }
  update(dt: number, player: T.Vector3, paused = false, participating = false) {
    if (!this.definition || paused || !Number.isFinite(dt) || dt <= 0) return;
    const h = Math.min(dt,.1); this.time += h; this.mixer?.update(h);
    const chase = this.definition.id.startsWith('monkey-') || this.definition.id === 'rolling-ball' || this.definition.id === 'wind-flyer';
    if (participating && chase && this.index < this.corridor.length) {
      const next=this.corridor[this.index], distance=this.moving.position.distanceTo(next);
      const speed=this.definition.id.startsWith('monkey-')?2.7:1.8;
      // Re-check every motion in case a door or NPC has moved since event creation.
      const proposed=this.moving.position.clone().lerp(next,Math.min(1,speed*h/Math.max(distance,.001)));
      const support=this.options.ground(proposed.x,proposed.z,this.moving.position.y);
      if(support === undefined || Math.abs(support-this.moving.position.y)>.45)return;
      proposed.y=support;
      const from=this.moving.position.clone().add(new T.Vector3(0,this.height/2+.025,0)),to=proposed.clone().add(new T.Vector3(0,this.height/2+.025,0));
      const free=this.options.actorSweep?.(this.actorId,from,to,this.radius,this.height) ?? this.options.sweep(from,to,this.radius);
      if(free>=from.distanceTo(to)-.01){this.moving.position.copy(proposed);this.moving.rotation.y=Math.atan2(next.x-proposed.x,next.z-proposed.z);if(distance<.15)this.index++;}
    }
    if (this.definition.id === 'wind-flyer') this.moving.children.forEach((p,i)=>{p.rotation.z=Math.sin(this.time*3+i)*.4;p.rotation.y=this.time*.5+i;});
    if (this.definition.id === 'rolling-ball') this.moving.children[0].rotation.x+=participating?h*5:0;
    if (this.definition.id === 'pop-up-song') this.moving.children.forEach((p,i)=>{p.scale.setScalar(1+Math.sin(this.time*4+i)*.12);});
    if (!chase) this.moving.rotation.y=Math.atan2(player.x-this.moving.position.x,player.z-this.moving.position.z);
  }
  bodies(): ActorBody[] {
    return this.definition && (this.definition.id.startsWith('monkey-') || ['rolling-ball','wind-flyer'].includes(this.definition.id)) ? [{id:this.actorId,position:this.moving.position.clone(),radius:this.radius,height:this.height}] : [];
  }
  getTarget() { return this.definition ? this.moving.position.clone() : undefined; }
  reset() {
    this.definition=undefined; this.group.visible=false;
    for(const child of [...this.moving.children]) if(child!==this.monkey){this.moving.remove(child);disposeObject(child);}
    if(this.monkey)this.monkey.visible=false;
    this.corridor=[];
  }
  dispose() { this.reset();this.disposed=true;this.mixer?.stopAllAction();if(this.monkey)disposeObject(this.monkey);this.group.removeFromParent(); }
}
