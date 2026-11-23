import {expect,it} from 'vitest';
import {prepareBusRoutes} from '../src/walk/bus';
import {bus} from './v121-fixtures';
it('samples triangle heights then smooths a 60 m profile, reporting unresolved road deviation',()=>{
 const result=prepareBusRoutes([bus],(x)=>x*.05+(x>45&&x<55?6:0));expect(result.routes[0].legs[0].path.length).toBe(51);expect(result.routes[0].legs[0].path[0][1]).toBe(0);expect(result.routes[0].legs[0].path.at(-1)![1]).toBe(5);expect(result.routes[0].legs[0].path[25][1]).toBeLessThan(5);expect(result.diagnostics[0].maxSurfaceGap).toBeGreaterThan(3);expect(bus.legs[0].path).toEqual([[0,0,0],[100,0,0]]);
});
