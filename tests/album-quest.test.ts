import { expect,it } from 'vitest';
import { Album, type AlbumWorld } from '../src/story/album';
import { Campus, normalizeCampus } from '../src/story/collection';
import { TalkDirector, type CollectionData, type TalkWorld } from '../src/story/talk';
import type { StoryUi } from '../src/story/ui';
import type { StoryEngine } from '../src/story/engine';
import type { QuestConsequences } from '../src/walk/interaction-quests';
const collection:CollectionData={version:1,stamps:[],achievements:[],items:[{id:'cup',name:'杯子',desc:'咖啡'},
 {id:'card',name:'配置圖',desc:'花盆',group:'quest',variants:{a:{name:'一列配置圖',desc:'整齊排一列'},b:{name:'沿邊配置圖',desc:'保留視線'}}}]};
const world:AlbumWorld={place:()=>undefined,chaptersDone:()=>0,toast:()=>{},cue:()=>{},storiesFound:()=>({found:0,total:0})};
it('album merges unique Campus and quest items, groups collections and follows a/b variants after reload and clear',()=>{
 const campus=new Campus(normalizeCampus({items:['cup','card']}));
 const quests: { flag?: (id: string) => boolean; grants: NonNullable<QuestConsequences['grants']> }={grants:{'quest:q:card':{itemId:'card',variant:'a'}}};
 const album=new Album(collection,undefined,campus,world,()=>quests);
 let html=album.html();expect(html).toContain('背包 <b>2</b>');expect(html).toContain('校園物品');expect(html).toContain('支線收藏 <b>1</b>');
 expect(html).toContain('一列配置圖');expect(html).not.toContain('沿邊配置圖');expect(html.match(/<strong>一列配置圖/g)).toHaveLength(1);
 quests.grants=[{itemId:'card',variant:'b'}];html=new Album(collection,undefined,campus,world,()=>quests).html();
 expect(html).toContain('沿邊配置圖');expect(html).not.toContain('一列配置圖');
 campus.progress.items=['cup'];quests.grants=[];expect(album.html()).toContain('支線收藏 <b>0</b>');
});
it('talk facts read live quest flags and grants without copying them into Campus or story flags',()=>{
 const campus=new Campus(normalizeCampus({flags:['npc.met'],items:['cup']}));
 const story={progress:{flags:['story.done'],done:[]}} as unknown as StoryEngine;
 let completed=false;const quests: { flag?: (id: string) => boolean; grants: NonNullable<QuestConsequences['grants']> }={flag:id=>completed && id==='quest.q.done',grants:[]};
 const talk=new TalkDirector({version:1,npcs:[],trees:{}},collection,{} as StoryUi,campus,story,{timeOfDay:()=> 'day'} as TalkWorld,()=>quests);
 expect(talk.facts.flag('quest.q.done')).toBe(false);completed=true;quests.grants=[{itemId:'card',variant:'a'}];
 for(const id of ['quest.q.done','npc.met','story.done'])expect(talk.facts.flag(id)).toBe(true);
 expect(talk.facts.flag('quest.q.return.b')).toBe(false);
 expect(talk.facts.hasItem('card')).toBe(true);expect(talk.facts.hasItem('cup')).toBe(true);
 expect(campus.progress.flags).toEqual(['npc.met']);expect(story.progress.flags).toEqual(['story.done']);
 completed=false;quests.grants=[];expect(talk.facts.hasItem('card')).toBe(false);expect(talk.facts.flag('quest.q.done')).toBe(false);
});
