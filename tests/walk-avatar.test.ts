import { describe, expect, it } from 'vitest';
import * as T from 'three';
import { Avatar } from '../src/walk/avatar';

const clip = (name: string, len = .6) => new T.AnimationClip(name, len, [new T.NumberKeyframeTrack('.position[y]', [0, len], [0, 0])]);
const make = () => { const a = new Avatar(); a.setModel(new T.Group(), ['Idle', 'Walk', 'Run', 'Jump', 'Fall'].map(n => clip(n))); return a; };
const frame = (o: Partial<Parameters<Avatar['update']>[1]> = {}) => ({ foot: new T.Vector3(), onGround: true, airborneFor: 0, speed: 0, intendedSpeed: 0, jumped: false, runSpeed: 7.2, ...o });

describe('avatar state machine', () => {
  it('a brief loss of contact (seam) never shows a jump or fall', () => {
    const a = make(); const states = new Set<string>();
    for (let i = 0; i < 120; i++) {
      const gap = i % 17 === 0;
      a.update(1 / 60, frame({ speed: 3.6, intendedSpeed: 3.6, heading: new T.Vector3(0, 0, -1), onGround: !gap, airborneFor: gap ? 1 / 60 : 0 }));
      states.add(a.state);
    }
    expect([...states]).toEqual(['walk']);
  });
  it('jump plays once; landing returns to the gait', () => {
    const a = make();
    a.update(1 / 60, frame({ jumped: true, onGround: false }));
    expect(a.state).toBe('jump');
    for (let i = 1; i < 30; i++) a.update(1 / 60, frame({ onGround: false, airborneFor: i / 60, speed: 3.6, intendedSpeed: 3.6 }));
    expect(a.state).toBe('jump');
    a.update(1 / 60, frame({ speed: 3.6, intendedSpeed: 3.6 }));
    expect(a.state).toBe('walk');
  });
  it('turns smoothly instead of snapping 180°', () => {
    const a = make(); a.face(0);
    a.update(1 / 60, frame({ speed: 3.6, intendedSpeed: 3.6, heading: new T.Vector3(0, 0, 1) }));
    expect(Math.abs(a.heading)).toBeLessThan(.7);
    for (let i = 0; i < 60; i++) a.update(1 / 60, frame({ speed: 3.6, intendedSpeed: 3.6, heading: new T.Vector3(0, 0, 1) }));
    expect(Math.abs(Math.abs(a.heading) - Math.PI)).toBeLessThan(.05);
  });
  it('visual height filters millimetre contact noise below 1 mm', () => {
    const a = make(); const ys: number[] = [];
    for (let i = 0; i < 300; i++) { a.update(1 / 60, frame({ foot: new T.Vector3(0, (i % 3 - 1) * .0012, 0) })); if (i > 30) ys.push(a.root.position.y); }
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(1e-3);
  });
  it('wall sliding (speed drops, intent stays) keeps a steady gait speed', () => {
    const a = make(); const scales: number[] = [];
    for (let i = 0; i < 120; i++) { a.update(1 / 60, frame({ speed: i % 2 ? 3.2 : 1.1, intendedSpeed: 3.6, heading: new T.Vector3(1, 0, 0) })); scales.push(a.state === 'walk' ? 1 : 0); }
    expect(scales.slice(10).every(Boolean)).toBe(true);
  });
});
