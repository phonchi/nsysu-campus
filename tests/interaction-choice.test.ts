import {describe,expect,it} from 'vitest';
import {selectInteraction,cycleInteraction,encounterReach} from '../src/walk/interaction-choice';
it('nearby NPC and door outrank a wide zone task, but the zone remains selectable',()=>{
 const choices=[{id:'zone',priority:10,distance:0},{id:'npc',priority:75,distance:2},{id:'door',priority:50,distance:1}];
 expect(selectInteraction(choices)?.id).toBe('npc');expect(cycleInteraction(choices)?.id).toBe('door');expect(cycleInteraction(choices,'door')?.id).toBe('zone');
 expect(selectInteraction(choices,'zone')?.id).toBe('zone');expect(selectInteraction(choices,'gone')?.id).toBe('npc');
});
it('empty selection and reach boundary agree for both phases',()=>{expect(selectInteraction([])).toBeUndefined();expect(cycleInteraction([])).toBeUndefined();expect(encounterReach('active')).toBe(1.5);expect(encounterReach('offered')).toBe(4);});

import { orderInteractions, revalidateInteraction, numberedInteractions, interactionPriority as p } from '../src/walk/interaction-choice';
import { interactionListHtml } from '../src/walk/interaction-list';
const action=(id:string,priority:number,targetId='npc:s1')=>({id,priority,targetId,actionId:id,distance:1,label:id,targetLabel:'小禾'});
it('ranks tracked completion, new chapter offer, other offer, talk and other, with stable ties',()=>{
 const choices=[action('z-tracked',p.tracked),action('new',p.newlyUnlocked),action('offer',p.acceptable),action('talk',p.talk),action('door',p.other)];
 expect(orderInteractions([...choices].reverse()).map(c=>c.id)).toEqual(choices.map(c=>c.id));
 expect(orderInteractions([action('b',p.talk),action('a',p.talk)]).map(c=>c.id)).toEqual(['a','b']);
});
it('does not execute a replacement target or a changed quest step/door state',()=>{
 const shown=action('talk',p.talk);
 expect(revalidateInteraction([action('other',p.talk,'npc:s2')],shown)).toBeUndefined();
 expect(revalidateInteraction([{...shown,targetId:'npc:s2'}],shown)).toBeUndefined();
 expect(revalidateInteraction([{...shown,actionId:'changed'}],shown)).toBeUndefined();
 expect(revalidateInteraction([{...shown,distance:2}],shown)?.targetId).toBe('npc:s1');
});
it('retains all rows, groups NPC tasks, supports reverse cycling and four numbered slots beyond row four',()=>{
 const rows=Array.from({length:7},(_,i)=>action(String(i),100-i,i<3?'npc:s1':'npc:s2'));
 expect(cycleInteraction(rows,'0',-1)?.id).toBe('6');
 expect(numberedInteractions(rows,'5').map(c=>c.id)).toEqual(['4','5','6']);
 const html=interactionListHtml(rows,'5');
 expect((html.match(/<button /g)??[]).length).toBe(7);
 expect(html).toContain('小禾 · 3 件事');
 expect(html).toContain('aria-keyshortcuts="E 2"');
 expect(html).toContain('<kbd>E</kbd><span>5</span>');
 expect(html).toContain('data-interaction="6"');
});
it('escapes labels and IDs before putting actions into markup',()=>{
 const html=interactionListHtml([{...action('"<tag>',80),label:'<img onerror=bad>'}],'"<tag>');
 expect(html).not.toContain('<img');expect(html).toContain('&lt;img');expect(html).toContain('&quot;&lt;tag&gt;');
});

describe('v10: the highlight follows priority unless picked by hand', () => {
  const landmark = { id: 'landmark:GATE', priority: 40, distance: 5 };
  const quest = { id: 'quest:gate-lost', priority: 110, distance: 2 };
  it('moves to the quest row that arrives after a landmark was highlighted automatically', () => {
    expect(selectInteraction([landmark, quest], 'landmark:GATE', false)?.id).toBe('quest:gate-lost');
  });
  it('keeps a row the player chose with R', () => {
    expect(selectInteraction([landmark, quest], 'landmark:GATE', true)?.id).toBe('landmark:GATE');
  });
});
