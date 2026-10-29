import * as T from 'three';

/** Rental bicycle (user request: the gate → science-college stretch is too long on foot).
 * Rent once at the stand beside the school gate (E), then B mounts / dismounts anywhere outdoors. Riding is
 * about three times walking speed and auto-walk (G) rides too; entering a building or going upstairs parks it.
 * The bike is a visual attached to the avatar: physics keeps the same walking capsule, only faster. */
export const RIDE_SPEED = 9.5;

export interface BikeDeps {
  /** Rental stand position (beside the gate). */
  stand: T.Vector3;
  rented(): boolean;
  rent(): void;
  /** True where riding is allowed (outdoors, ground level, not inside a building footprint). */
  outdoors(p: T.Vector3): boolean;
  say(text: string, ms?: number): void;
  cue(id: string): void;
}

export class Bike {
  riding = false;
  readonly standGroup = new T.Group();
  get stand() { return this.d.stand; }
  constructor(private d: BikeDeps) { this.standGroup.name = 'Bike rental stand'; this.standGroup.position.copy(d.stand); }

  /** Is the player at the rental stand (for the E hint and E arbitration)? */
  atStand(p: T.Vector3) { return !this.d.rented() && Math.hypot(p.x - this.d.stand.x, p.z - this.d.stand.z) < 3.2; }

  /** E at the stand: rent the bike and get on. Returns true when E was used. */
  press(p: T.Vector3) {
    if (!this.atStand(p)) return false;
    this.d.rent(); this.d.cue('chime');
    this.riding = true;
    this.d.say('租到腳踏車了！按 B 上下車；進建築會自動停在門口。', 5000);
    return true;
  }

  /** B: mount / dismount. */
  toggle(p: T.Vector3) {
    if (!this.d.rented()) { this.d.say('校門旁的租車點可以租腳踏車（走過去按 E）。', 3500); return; }
    if (!this.riding && !this.d.outdoors(p)) { this.d.say('在戶外才能騎車。', 2500); return; }
    this.riding = !this.riding; this.d.cue('pop');
    this.d.say(this.riding ? '上車：騎乘速度約步行三倍。' : '下車，改用走的。', 2000);
  }

  /** Called every frame: park automatically where riding is not allowed. */
  update(p: T.Vector3) {
    if (this.riding && !this.d.outdoors(p)) { this.riding = false; this.d.say('腳踏車先停在門口，改用走的。', 3000); }
  }
}
