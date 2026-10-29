import type { JournalEntry, QuestWorld } from './quests';
export interface EncounterDefinition { id: string; title: string; zone: string; npc: string; description: string; target: string; radius: number; reward: string; success: string; giveUp: string; duration: number; when?: string }
export interface EncounterData { version: number; encounters: EncounterDefinition[] }
export interface ActiveEncounter { definition: EncounterDefinition; phase: 'offered' | 'active'; remaining: number; instance: string; offeredAt: number; acceptedAt?: number }
export interface EncounterOptions { random?: () => number; now?: () => number; record?: (entry: Omit<JournalEntry, 'at'>) => void; onChange?: () => void }
/** Only exploration time advances this scheduler; UI/dialogue/navigation pauses are explicit. */
export class EncounterEngine {
  active?: ActiveEncounter;
  private elapsed = 0;
  private checkAt = 30;
  private lastGlobal = -Infinity;
  private lastKind: Record<string, number> = {};
  private serial = 0;
  private random: () => number;
  constructor(readonly data: EncounterData, private options: EncounterOptions = {}) { this.random = options.random ?? Math.random; }
  /** Read-only clock snapshot for diagnostics; callers cannot alter scheduler state. */
  get diagnostics() { return { elapsed: this.elapsed, lastGlobal: this.lastGlobal, lastKind: { ...this.lastKind } }; }
  update(dt: number, world: QuestWorld, paused = false) {
    if (paused || !Number.isFinite(dt) || dt <= 0) return;
    this.elapsed += dt;
    if (this.active) {
      this.active.remaining -= dt;
      if (this.active.remaining <= 0) this.giveUp();
      return;
    }
    if (this.elapsed < this.checkAt) return;
    this.checkAt = this.elapsed + 30;
    if (this.elapsed - this.lastGlobal < 120 || this.random() >= .35) return;
    const candidates = this.data.encounters.filter(e => this.elapsed - (this.lastKind[e.id] ?? -Infinity) >= 600 && (!e.when || e.when === world.timeOfDay()) && world.distanceTo(`zone:${e.zone}`) <= 35);
    if (candidates.length) this.offer(candidates[Math.min(candidates.length - 1, Math.floor(this.random() * candidates.length))].id);
  }
  /** Deterministic QA and authored invitations use the same state transition as the scheduler. */
  offer(id: string) {
    if (this.active) return false;
    const definition = this.data.encounters.find(e => e.id === id); if (!definition) return false;
    this.active = { definition, phase: 'offered', remaining: 45, offeredAt: (this.options.now ?? Date.now)(), instance: `${(this.options.now ?? Date.now)()}:${++this.serial}` };
    this.options.onChange?.(); return this.active?.definition.id === id;
  }
  accept() { if (!this.active || this.active.phase !== 'offered') return false; this.active.phase = 'active'; this.active.acceptedAt = (this.options.now ?? Date.now)(); this.active.remaining = this.active.definition.duration; this.lastGlobal = this.elapsed; this.lastKind[this.active.definition.id] = this.elapsed; this.options.onChange?.(); return true; }
  interact(world: QuestWorld) {
    const a = this.active; if (!a || a.phase !== 'active' || world.distanceTo(a.definition.target) > a.definition.radius) return false;
    this.finish(true); return true;
  }
  cancelOffer() { if (this.active?.phase !== 'offered') return false; this.active = undefined; this.options.onChange?.(); return true; }
  offerSceneFailed() { return this.cancelOffer(); }
  giveUp() { if (!this.active) return false; if (this.active.phase === 'offered') return this.cancelOffer(); this.finish(false); return true; }
  private finish(success: boolean) {
    const a = this.active!;
    this.options.record?.({ id: `encounter:${a.definition.id}:${a.instance}`, kind: 'encounter', title: a.definition.title, text: a.definition.description, zone: a.definition.zone, npc: a.definition.npc, result: success ? a.definition.success : a.definition.giveUp, choice: success ? '參與並完成' : '這次先放過它', reward: success ? a.definition.reward : undefined });
    this.active = undefined; this.options.onChange?.();
  }
}
