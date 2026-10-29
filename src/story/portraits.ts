/** Original half-body portraits for the dialogue box (art-direction-v4 §9): flat vector, ink outline,
 * one shadow tone, same colour slots and hair silhouettes as the 3D models. Expressions only swap the
 * face layer (brows, eyes, mouth, blush). No photos, no real people. */
import type { Face } from './dialogue';

export interface PortraitSpec {
  kind?: 'human' | 'monkey';
  skin?: string; hair?: string; hairStyle?: string; top?: string; topStyle?: string; accessory?: string;
}

const INK = '#2a2c4a';
const shade = (hex: string, k: number) => {
  const n = parseInt(hex.slice(1), 16), c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => Math.round(Math.max(0, Math.min(255, v * k))));
  return '#' + c.map(v => v.toString(16).padStart(2, '0')).join('');
};
const S = `stroke="${INK}" stroke-width="5" stroke-linejoin="round" stroke-linecap="round"`;

function face(f: Face, skin: string) {
  const eye = (x: number) => {
    if (f === 'smile') return `<path d="M${x - 15} 196 q15 -15 30 0" fill="none" ${S}/>`;
    const h = f === 'surprised' ? 25 : 21;
    return `<ellipse cx="${x}" cy="196" rx="12.5" ry="${h}" fill="#fff" ${S} stroke-width="4"/>
<ellipse cx="${x + 1}" cy="${f === 'troubled' ? 200 : 198}" rx="9.5" ry="${h - 5}" fill="#3b2f5c"/>
<ellipse cx="${x + 1}" cy="${(f === 'troubled' ? 200 : 198) + 6}" rx="7" ry="${(h - 5) * .45}" fill="#8fd3d8" opacity=".55"/>
<circle cx="${x + 1}" cy="${f === 'troubled' ? 201 : 199}" r="5" fill="#1b1630"/>
<circle cx="${x - 3}" cy="${f === 'troubled' ? 191 : 189}" r="4.5" fill="#fff"/>
<path d="M${x - 15} ${196 - h + 2} q15 -9 30 0" fill="none" ${S} stroke-width="6"/>`;
  };
  const brow = (x: number, side: number) => {
    const tilt = f === 'troubled' ? -7 * side : f === 'surprised' ? 0 : 2 * side, y = f === 'surprised' ? 158 : 164;
    return `<path d="M${x - 13} ${y + tilt} L${x + 13} ${y - tilt}" ${S} stroke-width="5" fill="none"/>`;
  };
  const mouth = {
    neutral: '<path d="M151 238 q9 4 18 0" fill="none" ' + S + ' stroke-width="4"/>',
    smile: `<path d="M146 233 q14 16 28 0 z" fill="#b55a5a" ${S} stroke-width="4"/>`,
    surprised: `<ellipse cx="160" cy="238" rx="8" ry="10" fill="#b55a5a" ${S} stroke-width="4"/>`,
    troubled: '<path d="M150 241 q10 -7 20 0" fill="none" ' + S + ' stroke-width="4"/>',
  }[f];
  const blush = `<ellipse cx="126" cy="220" rx="14" ry="7" fill="#f19a8f" opacity="${f === 'smile' ? .6 : .38}"/><ellipse cx="194" cy="220" rx="14" ry="7" fill="#f19a8f" opacity="${f === 'smile' ? .6 : .38}"/>`;
  const sweat = f === 'troubled' ? `<path d="M212 168 q8 14 0 20 q-8 -6 0 -20z" fill="#bfe6ef" ${S} stroke-width="3"/>` : '';
  void skin;
  return `<g data-face="${f}">${blush}${eye(131)}${eye(189)}${brow(131, 1)}${brow(189, -1)}<path d="M159 214 l-3 9 h6" fill="none" stroke="${shade('#f2c9a5', .78)}" stroke-width="3" stroke-linecap="round"/>${mouth}${sweat}</g>`;
}

function body(top: string, style: string, skin: string) {
  const dark = shade(top, .78);
  const torso = `<path d="M52 400 C56 330 86 300 160 296 C234 300 264 330 268 400 Z" fill="${top}" ${S}/>
<path d="M232 316 C252 334 262 360 266 400 L238 400 C236 368 230 346 220 330 Z" fill="${dark}"/>`;
  const neck = `<path d="M138 262 L138 300 Q160 312 182 300 L182 262 Z" fill="${skin}" ${S}/><path d="M138 282 Q160 296 182 282 L182 268 Q160 280 138 268 Z" fill="${shade(skin, .84)}"/>`;
  let detail = '';
  switch (style) {
    case 'hoodie':
      detail = `<path d="M112 304 Q160 334 208 304 Q196 322 160 330 Q124 322 112 304Z" fill="${dark}" ${S} stroke-width="4"/><path d="M148 326 v38 M172 326 v38" ${S} stroke-width="4"/>`; break;
    case 'shirt': case 'labcoat':
      detail = `<path d="M136 298 L160 336 L184 298" fill="${style === 'labcoat' ? '#fbf6ea' : '#fbf6ea'}" ${S} stroke-width="4"/><path d="M160 336 v64" ${S} stroke-width="3"/><circle cx="160" cy="356" r="3" fill="${INK}"/><circle cx="160" cy="380" r="3" fill="${INK}"/>`; break;
    case 'jacket':
      detail = `<path d="M130 300 L150 400 M190 300 L170 400" ${S} stroke-width="5"/><path d="M150 400 L160 330 L170 400 Z" fill="#fbf6ea" ${S} stroke-width="3"/>`; break;
    case 'vest': case 'uniform':
      detail = `<path d="M128 300 L160 352 L192 300" fill="#fbf6ea" ${S} stroke-width="4"/><rect x="190" y="340" width="34" height="20" rx="4" fill="#fbf6ea" ${S} stroke-width="3"/>${style === 'uniform' ? `<path d="M74 330 h40 M206 330 h40" stroke="#e9b949" stroke-width="8" stroke-linecap="round"/>` : ''}`; break;
    case 'apron':
      detail = `<path d="M118 330 Q160 320 202 330 L210 400 L110 400 Z" fill="#e8b84a" ${S} stroke-width="4"/><path d="M120 312 L132 330 M200 312 L188 330" ${S} stroke-width="4"/>`; break;
    default: // tee: collar + small mountain-and-sea mark (original)
      detail = `<path d="M134 300 Q160 316 186 300" fill="none" ${S} stroke-width="5"/><path d="M140 356 l14 -18 l10 12 l8 -8 l12 14 z" fill="#fbf6ea" stroke="${INK}" stroke-width="2.5" stroke-linejoin="round"/><path d="M140 362 q10 -6 20 0 t20 0" fill="none" stroke="#fbf6ea" stroke-width="3" stroke-linecap="round"/>`;
  }
  return neck + torso + detail;
}

function hairBack(c: string, style: string) {
  switch (style) {
    case 'long': return `<path d="M88 170 C80 260 86 330 104 360 L216 360 C234 330 240 260 232 170 Z" fill="${shade(c, .85)}" ${S}/>`;
    case 'bob': return `<path d="M86 172 C78 236 90 272 112 282 L208 282 C230 272 242 236 234 172 Z" fill="${shade(c, .85)}" ${S}/>`;
    case 'ponytail': return `<path d="M222 150 C262 170 270 236 246 290 C238 250 232 214 214 186 Z" fill="${shade(c, .85)}" ${S}/>`;
    case 'bun': return `<circle cx="160" cy="80" r="30" fill="${c}" ${S}/>`;
    default: return '';
  }
}

function hairFront(c: string, style: string) {
  const hl = shade(c, 1.45);
  if (style === 'none') return '';
  const cap = style === 'grey' ? '#c9c4bb' : c;
  const base = `<path d="M92 186 C86 118 122 92 160 92 C198 92 236 118 228 186 C220 160 206 146 190 142 C176 160 150 166 126 158 C112 164 100 174 92 186 Z" fill="${cap}" ${S}/>`;
  const shine = `<path d="M118 118 q42 -16 84 0" fill="none" stroke="${style === 'grey' ? '#efece6' : hl}" stroke-width="7" stroke-linecap="round" opacity=".8"/>`;
  const tufts = {
    short: `<path d="M150 96 l10 -20 l8 22 M176 100 l16 -14 l-2 22" fill="${c}" ${S} stroke-width="4"/>`,
    messy: `<path d="M120 112 l-18 -16 l26 4 M150 96 l6 -24 l12 22 M190 104 l22 -10 l-10 20" fill="${c}" ${S} stroke-width="4"/>`,
    bob: `<path d="M92 186 C96 214 104 234 116 248 L112 186 Z M228 186 C224 214 216 234 204 248 L208 186 Z" fill="${c}" ${S} stroke-width="4"/>`,
    long: `<path d="M92 186 C92 230 98 262 108 282 L114 190 Z M228 186 C228 230 222 262 212 282 L206 190 Z" fill="${c}" ${S} stroke-width="4"/>`,
  }[style] ?? '';
  return base + tufts + shine;
}

function accessory(a: string | undefined, hair: string) {
  switch (a) {
    case 'glasses': return `<g fill="none" ${S} stroke-width="4"><rect x="111" y="180" width="40" height="32" rx="10"/><rect x="169" y="180" width="40" height="32" rx="10"/><path d="M151 192 h18"/></g>`;
    case 'cap': return `<path d="M94 150 C96 100 130 82 160 82 C196 82 226 102 228 150 Z" fill="#e8b84a" ${S}/><path d="M86 150 Q160 132 246 156 Q240 170 222 166 Q160 152 96 164 Z" fill="${shade('#e8b84a', .8)}" ${S}/>`;
    case 'headphones': return `<path d="M100 236 Q104 316 160 318 Q216 316 220 236" fill="none" stroke="#e9b949" stroke-width="10" stroke-linecap="round"/><path d="M100 236 Q104 316 160 318 Q216 316 220 236" fill="none" stroke="${INK}" stroke-width="2.5"/>`;
    case 'camera': return `<path d="M120 300 L150 352 M200 300 L170 352" ${S} stroke-width="4"/><rect x="132" y="346" width="56" height="40" rx="8" fill="#3c4a5c" ${S} stroke-width="4"/><circle cx="160" cy="366" r="12" fill="#62c8d2" ${S} stroke-width="3"/>`;
    case 'guitar': return `<path d="M224 400 L250 300" stroke="#8a5a3a" stroke-width="12" stroke-linecap="round"/><path d="M224 400 L250 300" ${S} stroke-width="2.5" fill="none"/>`;
    case 'whistle': return `<path d="M136 300 L160 340 L184 300" fill="none" stroke="#e04b3a" stroke-width="4"/><rect x="152" y="338" width="16" height="12" rx="3" fill="#c9c4bb" ${S} stroke-width="3"/>`;
    case 'nametag': return `<rect x="186" y="336" width="40" height="22" rx="4" fill="#fbf6ea" ${S} stroke-width="3"/><path d="M194 347 h24" stroke="${INK}" stroke-width="3"/>`;
    case 'hairclip': return `<path d="M196 122 l22 -8 l2 10 l-22 8 z" fill="#e04b3a" ${S} stroke-width="3"/>`;
    case 'scarf': return `<path d="M120 296 Q160 320 200 296 L204 314 Q160 340 116 314 Z" fill="#e04b3a" ${S} stroke-width="4"/>`;
    default: void hair; return '';
  }
}

function monkey(f: Face) {
  const fur = '#7d6b5d', belly = '#a89686', skin = '#d97f76';
  const eyes = f === 'smile' ? `<path d="M128 196 q10 -10 20 0 M172 196 q10 -10 20 0" fill="none" ${S}/>`
    : `<circle cx="138" cy="196" r="${f === 'surprised' ? 9 : 7}" fill="${INK}"/><circle cx="182" cy="196" r="${f === 'surprised' ? 9 : 7}" fill="${INK}"/><circle cx="135" cy="193" r="2.5" fill="#fff"/><circle cx="179" cy="193" r="2.5" fill="#fff"/>`;
  const mouth = f === 'surprised' ? `<ellipse cx="160" cy="236" rx="9" ry="7" fill="${INK}"/>` : f === 'troubled' ? `<path d="M148 240 q12 -8 24 0" fill="none" ${S} stroke-width="4"/>` : `<path d="M148 234 q12 8 24 0" fill="none" ${S} stroke-width="4"/>`;
  return `<path d="M60 400 C64 320 100 292 160 290 C220 292 256 320 260 400 Z" fill="${fur}" ${S}/>
<ellipse cx="160" cy="372" rx="58" ry="46" fill="${belly}"/>
<circle cx="88" cy="186" r="24" fill="${skin}" ${S}/><circle cx="232" cy="186" r="24" fill="${skin}" ${S}/>
<circle cx="160" cy="182" r="86" fill="${fur}" ${S}/>
<path d="M104 196 C104 150 130 136 160 150 C190 136 216 150 216 196 C216 246 192 266 160 266 C128 266 104 246 104 196 Z" fill="${skin}" ${S}/>
${eyes}<path d="M152 214 q8 6 16 0" fill="none" ${S} stroke-width="3"/>${mouth}`;
}

/** Full portrait SVG (viewBox 320×400). */
export function portraitSvg(spec: PortraitSpec, f: Face = 'neutral') {
  let inner: string;
  if (spec.kind === 'monkey') inner = monkey(f);
  else {
    const skin = spec.skin ?? '#f2c9a5', hair = spec.hair ?? '#2b2622', style = spec.hairStyle ?? 'short';
    inner = `${hairBack(hair, style)}${body(spec.top ?? '#2c7f91', spec.topStyle ?? 'tee', skin)}
<ellipse cx="98" cy="200" rx="10" ry="16" fill="${skin}" ${S} stroke-width="4"/><ellipse cx="222" cy="200" rx="10" ry="16" fill="${skin}" ${S} stroke-width="4"/>
<path d="M98 184 C98 120 126 100 160 100 C194 100 222 120 222 184 C222 238 196 266 160 266 C124 266 98 238 98 184 Z" fill="${skin}" ${S}/>
<path d="M204 222 C196 246 180 260 160 264 C188 258 210 238 216 206 Z" fill="${shade(skin, .86)}"/>
${face(f, skin)}${hairFront(hair, style)}${accessory(spec.accessory, hair)}`;
  }
  return `<svg viewBox="0 0 320 400" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${inner}</svg>`;
}
