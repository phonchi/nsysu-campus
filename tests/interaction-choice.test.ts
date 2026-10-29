import {expect,it} from 'vitest';
import {selectInteraction,cycleInteraction,encounterReach} from '../src/walk/interaction-choice';
it('nearby NPC and door outrank a wide zone task, but the zone remains selectable',()=>{
 const choices=[{id:'zone',priority:10,distance:0},{id:'npc',priority:75,distance:2},{id:'door',priority:50,distance:1}];
 expect(selectInteraction(choices)?.id).toBe('npc');expect(cycleInteraction(choices)?.id).toBe('door');expect(cycleInteraction(choices,'door')?.id).toBe('zone');
 expect(selectInteraction(choices,'zone')?.id).toBe('zone');expect(selectInteraction(choices,'gone')?.id).toBe('npc');
});
it('empty selection and reach boundary agree for both phases',()=>{expect(selectInteraction([])).toBeUndefined();expect(cycleInteraction([])).toBeUndefined();expect(encounterReach('active')).toBe(1.5);expect(encounterReach('offered')).toBe(4);});
