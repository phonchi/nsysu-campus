import * as T from 'three';
import { runTalk, entryNode, type Effect, type Facts, type MinigameId, type Tree } from './dialogue';
import type { Campus } from './collection';
import type { StoryEngine } from './engine';
import type { StoryUi, CastEntry } from './ui';
import type { PortraitSpec } from './portraits';

type Sched = { at: string | [number, number]; offset?: [number, number]; activity?: string } | null;
export interface NpcDef {
  id: string; name: string; role: string; model: string; look?: Record<string, string>; portrait: PortraitSpec;
  schedule: Record<'day' | 'sunset' | 'night', Sched>; talk?: string; minigame?: MinigameId; observe?: boolean;
}
export interface NpcData { version: number; npcs: NpcDef[]; trees: Record<string, Tree>; events?: { id: string; when: string; npcs: string[]; banner: string }[] }
export interface CollectionData {
  version: number;
  items: { id: string; name: string; desc: string }[];
  stamps: { id: string; name: string; at: string | [number, number]; r: number; hidden?: boolean; desc: string }[];
  achievements: { id: string; name: string; desc: string; rule: Record<string, unknown> }[];
}

/** The world side a conversation needs (kept small so it can be faked in tests). */
export interface TalkWorld {
  /** Nearest NPC within reach that has a talk tree (or is observable). */
  nearest(player: T.Vector3, reach: number): string | undefined;
  position(id: string): T.Vector3 | undefined;
  setTalking(id: string | undefined): void;
  timeOfDay(): string;
  cue(id: string): void;
  toast(text: string): void;
  /** Run a mini-game; resolves with win/lose. */
  play(game: MinigameId, host: string): Promise<boolean>;
}

/** NPC small talk (spec-v4 §7.2, §8): E near an NPC opens its tree in the visual-novel box. Story steps keep
 * priority — the walk runtime asks the story first and only then calls `press()` here. */
export class TalkDirector {
  private busy = false;
  private byId = new Map<string, NpcDef>();

  constructor(private data: NpcData, private collection: CollectionData, private ui: StoryUi, private campus: Campus,
              private engine: StoryEngine, private world: TalkWorld) {
    for (const n of data.npcs) this.byId.set(n.id, n);
    ui.cast = who => { const n = this.byId.get(who); return n ? { name: n.name, portrait: n.portrait } as CastEntry : undefined; };
  }

  get talking() { return this.busy; }
  npc(id: string) { return this.byId.get(id); }

  readonly facts: Facts = {
    flag: f => this.engine.progress.flags.includes(f) || this.campus.progress.flags.includes(f),
    hasItem: i => this.campus.progress.items.includes(i),
    stamps: () => this.campus.progress.stamps.filter(s => !this.collection.stamps.find(x => x.id === s)?.hidden).length,
    chapterDone: c => this.engine.progress.done.includes(c),
    timeOfDay: () => this.world.timeOfDay(),
    count: c => this.campus.progress.counters[c] ?? 0,
  };

  /** Who would answer an E press right now (for the "E 交談" hint). */
  candidate(player: T.Vector3) {
    if (this.busy) return undefined;
    const id = this.world.nearest(player, 3);
    const n = id ? this.byId.get(id) : undefined;
    return n && (n.talk || n.observe) ? n : undefined;
  }

  /** E pressed in walk mode after the story declined it; returns true when a conversation starts. */
  press(player: T.Vector3) {
    const n = this.candidate(player);
    if (!n) return false;
    if (n.observe || !n.talk) { this.world.toast(`${n.name}：${n.role}（遠遠看就好，不要靠近）`); return true; }
    void this.talk(n.id);
    return true;
  }

  async talk(id: string, start?: string) {
    const n = this.byId.get(id), tree = n?.talk ? this.data.trees[n.talk] : undefined;
    if (!n || !tree || this.busy) return;
    const node = start ?? entryNode(tree, this.facts);
    if (!node) return;
    this.busy = true;
    this.campus.talked(id);
    this.world.setTalking(id); this.world.cue('page');
    this.ui.begin();
    let game: Awaited<ReturnType<typeof runTalk>>;
    try {
      game = await runTalk(tree, node, this.facts, {
        say: (lines, hold) => this.ui.say(lines, hold),
        choose: c => this.ui.choose(c),
        apply: e => this.apply(e),
      });
    } finally {
      this.ui.end(); this.world.setTalking(undefined); this.busy = false;
    }
    if (game) {
      const won = await this.world.play(game.startMinigame, id);
      await this.talk(id, won ? game.win : game.lose);
    }
  }

  apply(e: Effect) {
    const c = this.campus;
    if ('setFlag' in e) c.setFlag(e.setFlag);
    else if ('giveItem' in e) { const i = this.collection.items.find(x => x.id === e.giveItem); c.giveItem(e.giveItem); if (i) this.world.toast(`獲得「${i.name}」`); }
    else if ('stamp' in e) c.stamp(e.stamp);
    else if ('achievement' in e) c.achieve(e.achievement);
    else if ('unlockSideQuest' in e) this.engine.unlockSideQuest(e.unlockSideQuest);
    else if ('playSound' in e) this.world.cue(e.playSound);
    else if ('count' in e) c.count(e.count);
  }
}
