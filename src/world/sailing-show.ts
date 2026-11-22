import * as T from 'three';
import type {SailingShowSpec} from './v12-types';
import {pathLength,samplePath} from '../walk/v12-geometry';
export class SailingShow {
 readonly group=new T.Group();private time=0;private boats:T.Group[]=[];private paths:{path:SailingShowSpec['boats'][number]['path'];length:number}[]=[];
 constructor(readonly spec:SailingShowSpec,model:T.Object3D,label?:(text:string)=>T.Object3D){
  if(spec.boats.length!==8||spec.boats.filter(b=>b.team==='nsysu').length!==4||spec.boats.filter(b=>b.team==='osaka').length!==4)throw Error('帆船情境需兩隊各四艘');
  this.group.name='帆船賽・情境重現';for(const b of spec.boats){const path=[...b.path,b.path[0]];this.paths.push({path,length:pathLength(path)});const g=new T.Group();g.name=b.id;g.userData.teamLabel=spec.teamLabels?.[b.team]??(b.team==='nsysu'?'中山':'日本隊');g.add(model.clone(true));if(label){const sign=label(g.userData.teamLabel);sign.name='team-label';sign.position.y=14;sign.scale.multiplyScalar(30);g.add(sign);}const flag=new T.Mesh(new T.PlaneGeometry(.5,.28),new T.MeshBasicMaterial({color:b.team==='nsysu'?'#e0b65f':'#597eb4',side:T.DoubleSide}));flag.position.set(0,5.8,0);g.add(flag);this.group.add(g);this.boats.push(g);}this.update(0);
 }
 update(dt:number){this.time+=dt;this.spec.boats.forEach((b,i)=>{const {path,length}=this.paths[i],pose=samplePath(path,(b.startProgress*length+this.time*2.4)%Math.max(.01,length));this.boats[i].position.fromArray(pose.position);this.boats[i].rotation.set(Math.sin(this.time+i)*.025,pose.yaw,Math.sin(this.time*.7+i)*.04);});}
 dispose(){this.group.removeFromParent();}
}
