import { MathUtils, type Object3D, type PerspectiveCamera, Vector3 } from 'three';

export interface QaCharacter { root:Object3D; position:Vector3; heading:number; qaFade?:number }
/** Diagnostic overrides are inert unless the runtime was started with ?qa=1. */
export class CharacterQa {
  private outlines?:boolean;
  private closeup?:{npc:QaCharacter;dist:number;height:number;angle:number};
  private playerVisible?:boolean;
  constructor(private enabled:boolean,private scene:Object3D,private camera:PerspectiveCamera,
    private player:Object3D,private getNpc:(id:string)=>QaCharacter|undefined){}
  qaOutlines(on:boolean){if(!this.enabled)return false;this.outlines=on;this.update();return true;}
  /** Height is relative to the NPC's foot; angle is degrees around its heading. Null restores the normal camera. */
  qaCloseup(npcId:string|null,dist=1,height=1,angleDeg=0){
    if(!this.enabled)return false;
    if(npcId===null){if(this.closeup)this.closeup.npc.root.userData.qaInspected=false;this.closeup=undefined;if(this.playerVisible!==undefined)this.player.visible=this.playerVisible;this.playerVisible=undefined;return true;}
    const npc=this.getNpc(npcId);
    if(!npc||![dist,height,angleDeg].every(Number.isFinite)||dist<=0)return false;
    if(this.playerVisible===undefined)this.playerVisible=this.player.visible;
    if(this.closeup)this.closeup.npc.root.userData.qaInspected=false;
    npc.root.userData.qaInspected=true;
    this.closeup={npc,dist,height,angle:MathUtils.degToRad(angleDeg)};this.update();return true;
  }
  qaNpcFade(npcId:string,alpha:number|null){
    if(!this.enabled)return false;
    const npc=this.getNpc(npcId);if(!npc||(alpha!==null&&!Number.isFinite(alpha)))return false;
    npc.qaFade=alpha===null?undefined:MathUtils.clamp(alpha,0,1);return true;
  }
  update(){
    if(!this.enabled)return;
    if(this.outlines!==undefined)this.scene.traverse(o=>{
      if(o.userData.outlineHull&&o.userData.outlineKind==='character'){
        const mesh=o as import('three').Mesh;
        for(const material of Array.isArray(mesh.material)?mesh.material:[mesh.material])material.visible=this.outlines!;
      }
    });
    if(this.closeup){
      const {npc,dist,height,angle}=this.closeup,target=npc.position.clone().add(new Vector3(0,height,0)),yaw=npc.heading+angle;
      this.camera.position.copy(target).add(new Vector3(-Math.sin(yaw)*dist,0,-Math.cos(yaw)*dist));
      this.camera.lookAt(target);this.player.visible=false;npc.root.visible=true;
    }
  }
  dispose(){if(!this.enabled)return;this.qaCloseup(null);this.qaOutlines(true);}
}
