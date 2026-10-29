import {it,expect} from 'vitest';
import {Box3,Vector3} from 'three';
import {occupiesDoor,slidePastClosedDoor} from '../src/walk-door';
const door={position:new Vector3(),outside:new Vector3(0,0,1),inside:new Vector3(0,0,-1),closedBox:new Box3(new Vector3(-.55,0,-.05),new Vector3(.55,2.2,.05))};
it('blocks a running player without discarding motion along the door',()=>{const d=new Vector3(.5,0,-1);slidePastClosedDoor(door,new Vector3(0,0,.65),d,.065,6.4);expect(.65+d.z*.065*6.4).toBeGreaterThan(.339);expect(d.z).toBeLessThan(0);expect(d.x).toBe(.5);});
it('allows retreat from either side of an overlapping closed door',()=>{for(const side of [-1,1]){const d=new Vector3(0,0,side);slidePastClosedDoor(door,new Vector3(0,0,side*.2),d,.065,6.4);expect(d.z).toBe(side);}});
it('detects a player in a doorway before allowing it to close',()=>{expect(occupiesDoor(door,new Vector3(0,0,.2))).toBe(true);expect(occupiesDoor(door,new Vector3(0,0,1))).toBe(false);});
