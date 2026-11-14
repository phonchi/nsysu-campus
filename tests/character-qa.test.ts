import { expect,it } from 'vitest';
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, PerspectiveCamera, Vector3 } from 'three';
import { addOutlines } from '../src/render/outline';
import { CharacterQa } from '../src/walk/character-qa';
function setup(enabled=true){
 const scene=new Group(),root=new Group(),player=new Group(),camera=new PerspectiveCamera();
 root.add(new Mesh(new BoxGeometry(),new MeshBasicMaterial()));scene.add(root,player);
 root.position.set(4,20,6);const hull=addOutlines(root,'character')[0];
 const building=new Mesh(new BoxGeometry(),new MeshBasicMaterial());scene.add(building);const other=addOutlines(building,'building')[0];
 const npc={root,position:root.position,heading:0,qaFade:undefined as number|undefined};
 return {scene,root,player,camera,hull,other,npc,qa:new CharacterQa(enabled,scene,camera,player,id=>id==='teacher-chen'?npc:undefined)};
}
it('QA hooks are inert outside qa=1, including camera, outline and fade mutation',()=>{
 const f=setup(false),position=f.camera.position.clone();
 expect(f.qa.qaOutlines(false)).toBe(false);expect(f.qa.qaCloseup('teacher-chen',1,1,0)).toBe(false);expect(f.qa.qaNpcFade('teacher-chen',0)).toBe(false);
 f.qa.update();expect(f.camera.position.equals(position)).toBe(true);expect(f.npc.qaFade).toBeUndefined();expect((f.hull.material as MeshBasicMaterial).visible).toBe(true);
});
it('turns off only character hulls and survives fade visibility writes',()=>{
 const f=setup();f.qa.qaOutlines(false);f.hull.visible=true;f.qa.update();
 expect((f.hull.material as MeshBasicMaterial).visible).toBe(false);expect((f.other.material as MeshBasicMaterial).visible).toBe(true);
 f.qa.qaOutlines(true);expect((f.hull.material as MeshBasicMaterial).visible).toBe(true);f.qa.dispose();
});
it('places a persistent closeup relative to NPC hand height, independent of the player camera mode',()=>{
 const f=setup();expect(f.qa.qaCloseup('teacher-chen',2,.9,90)).toBe(true);
 expect(f.camera.position.distanceTo(new Vector3(2,20.9,6))).toBeLessThan(1e-6);
 expect(f.camera.getWorldDirection(new Vector3()).distanceTo(new Vector3(1,0,0))).toBeLessThan(1e-6);
 expect(f.player.visible).toBe(false);f.camera.position.set(0,0,0);f.qa.update();expect(f.camera.position.y).toBeCloseTo(20.9);
 expect(f.qa.qaCloseup('missing',1,1,0)).toBe(false);expect(f.qa.qaCloseup('teacher-chen',NaN,1,0)).toBe(false);
 f.qa.qaCloseup(null);expect(f.player.visible).toBe(true);f.qa.dispose();
});
it('forces, clamps and releases alpha without changing dialogue or movement state',()=>{
 const f=setup();expect(f.qa.qaNpcFade('teacher-chen',.4)).toBe(true);expect(f.npc.qaFade).toBe(.4);
 f.qa.qaNpcFade('teacher-chen',2);expect(f.npc.qaFade).toBe(1);f.qa.qaNpcFade('teacher-chen',null);expect(f.npc.qaFade).toBeUndefined();
 expect(f.qa.qaNpcFade('teacher-chen',NaN)).toBe(false);f.qa.dispose();
});
