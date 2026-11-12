/** Display-only plush, modelled from the local Cat_t.webp reference.
 * Metres; contact plane y=0, face +Z. Shared geometry/materials survive batching.
 * No DOM, source-image loading, collision shapes, or external texture requests.
 */
import * as THREE from 'three';

const C = { fur: '#f5f1e9', orange: '#efb54e', grey: '#a8abb0', ink: '#242229', red: '#b9434d', tongue: '#e49ca9', eye: '#dddce3' };
let template: THREE.Group | undefined;

function fabricMaterial(): THREE.MeshStandardMaterial {
  const size = 256, bytes = new Uint8Array(size * size * 4);
  // Four deliberately offset spirals form a seamless repeat; pixel-space strokes
  // keep their scale stable when this material is merged into the room batches.
  const spirals: [number, number][] = [];
  for (const [cx, cy, phase] of [[60, 62, .3], [188, 46, 1.7], [50, 186, 2.5], [183, 180, .9]]) {
    for (let i = 0; i <= 150; i++) {
      const t = i / 150, a = phase + t * Math.PI * 3.6, r = 3 + 28 * t;
      spirals.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
  }
  // Only pixels within the stroke radius can affect its colour. Rasterise those
  // neighbourhoods instead of testing every pixel against every spiral sample.
  const distances = new Float64Array(size * size).fill(8);
  for (const [sx, sy] of spirals) {
    for (let y = Math.max(0, Math.ceil(sy - 3)); y <= Math.min(size - 1, Math.floor(sy + 3)); y++) {
      for (let x = Math.max(0, Math.ceil(sx - 3)); x <= Math.min(size - 1, Math.floor(sx + 3)); x++) {
        const i = y * size + x;
        distances[i] = Math.min(distances[i], Math.hypot(x - sx, y - sy));
      }
    }
  }
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const line = THREE.MathUtils.clamp(2.2 - distances[y * size + x], 0, 1);
    const weave = ((x + y) % 2 ? 1 : -1) * 2;
    const i = (y * size + x) * 4;
    bytes[i] = 19 + line * 145 + weave;
    bytes[i + 1] = 104 + line * 99 + weave;
    bytes[i + 2] = 91 + line * 89 + weave;
    bytes[i + 3] = 255;
  }
  const map = new THREE.DataTexture(bytes, size, size, THREE.RGBAFormat);
  map.name = 'plush spiral fabric';
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.magFilter = THREE.LinearFilter;
  map.minFilter = THREE.LinearMipmapLinearFilter;
  map.generateMipmaps = true;
  map.needsUpdate = true;
  return new THREE.MeshStandardMaterial({ color: '#ffffff', map, roughness: 1, emissive: '#ffffff', emissiveMap: map, emissiveIntensity: .09 });
}

function build(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'cat teacher plush';
  const materials = new Map<string, THREE.MeshStandardMaterial>();
  const mat = (color: string) => {
    if (!materials.has(color)) materials.set(color, new THREE.MeshStandardMaterial({ color, roughness: 1, emissive: color, emissiveIntensity: .07, side: THREE.DoubleSide }));
    return materials.get(color)!;
  };
  const sphere = new THREE.SphereGeometry(1, 32, 20);
  const mesh = (geometry: THREE.BufferGeometry, material: THREE.MeshStandardMaterial, name: string) => {
    const part = new THREE.Mesh(geometry, material);
    part.name = `plush ${name}`;
    part.castShadow = true;
    part.receiveShadow = true;
    group.add(part);
    return part;
  };
  const oval = (name: string, x: number, y: number, z: number, rx: number, ry: number, rz: number, material: THREE.MeshStandardMaterial) => {
    const part = mesh(sphere, material, name);
    part.position.set(x, y, z); part.scale.set(rx, ry, rz);
    return part;
  };
  const fur = mat(C.fur), green = fabricMaterial();
  oval('body', 0, .115, -.096, .163, .115, .172, fur);
  oval('rump patch', -.025, .193, -.154, .125, .044, .099, mat(C.orange));
  // Short, broad paws support the chin rather than creating a seated pose.
  for (const sign of [-1, 1]) {
    oval('forepaw', sign * .153, .035, .072, .045, .035, .078, fur);
    oval('hindpaw', sign * .131, .032, -.188, .044, .032, .059, fur);
  }
  oval('head', 0, .132, .118, .187, .126, .135, fur);

  const ear = new THREE.Shape();
  ear.moveTo(-.047, 0);
  ear.quadraticCurveTo(-.047, .039, -.024, .084);
  ear.quadraticCurveTo(-.014, .104, .002, .082);
  ear.quadraticCurveTo(.032, .051, .049, .006);
  ear.quadraticCurveTo(0, -.018, -.047, 0);
  const earGeometry = new THREE.ExtrudeGeometry(ear, { depth: .032, bevelEnabled: true, bevelThickness: .009, bevelSize: .009, bevelSegments: 3, steps: 1, curveSegments: 10 });
  for (const sign of [-1, 1]) {
    const part = mesh(earGeometry, fur, 'ear');
    part.position.set(sign * .116, .215, .065);
    part.rotation.z = -sign * .13;
  }
  // Thick cloth bundle arches over the back and drops beside the ears.
  oval('bundle', 0, .265, -.074, .170, .089, .133, green);
  for (const sign of [-1, 1]) {
    const fold = oval('bundle fold', sign * .155, .185, -.036, .040, .120, .104, green);
    fold.rotation.z = -sign * .10;
  }
  oval('bundle knot', .015, .323, -.138, .042, .035, .040, green);

  // Features follow the ellipsoid rather than sitting on a flat face card.
  // Rings subdivide the interior too, so the coloured forehead cannot sink
  // into the head between widely separated boundary vertices.
  const face = (x: number, y: number, lift = .003) => new THREE.Vector3(x, y,
    .118 + .135 * Math.sqrt(Math.max(0, 1 - (x / .187) ** 2 - ((y - .132) / .126) ** 2)) + lift);
  const patch = (name: string, shape: THREE.Shape, color: string, lift = .003, rings = 6) => {
    const points = shape.getPoints(12);
    if (points[0].distanceTo(points[points.length - 1]) < 1e-8) points.pop();
    const center = points.reduce((sum, p) => sum.add(p), new THREE.Vector2()).multiplyScalar(1 / points.length);
    const positions: number[] = [], uv: number[] = [], indices: number[] = [];
    const put = (p: THREE.Vector2) => { const v = face(p.x, p.y, lift); positions.push(v.x, v.y, v.z); uv.push(p.x, p.y); };
    put(center);
    for (let r = 1; r <= rings; r++) for (const p of points) put(center.clone().lerp(p, r / rings));
    const n = points.length;
    for (let i = 0; i < n; i++) indices.push(0, 1 + i, 1 + (i + 1) % n);
    for (let r = 1; r < rings; r++) for (let i = 0; i < n; i++) {
      const a = 1 + (r - 1) * n + i, b = 1 + (r - 1) * n + (i + 1) % n, c = a + n, d = b + n;
      indices.push(a, c, b, b, c, d);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geometry.setIndex(indices); geometry.computeVertexNormals();
    const part = mesh(geometry, mat(color), name);
    part.castShadow = false;
    return part;
  };
  const orange = new THREE.Shape();
  orange.moveTo(-.077, .226);
  orange.bezierCurveTo(-.061, .243, -.028, .252, .004, .252);
  orange.bezierCurveTo(.014, .227, .034, .194, .038, .167);
  orange.bezierCurveTo(.007, .151, -.024, .158, -.038, .180);
  orange.bezierCurveTo(-.054, .201, -.062, .216, -.077, .226);
  patch('orange forehead', orange, C.orange);
  const grey = new THREE.Shape();
  grey.moveTo(.004, .252);
  grey.bezierCurveTo(.048, .248, .087, .224, .101, .199);
  grey.bezierCurveTo(.114, .169, .073, .155, .038, .167);
  grey.bezierCurveTo(.034, .194, .014, .227, .004, .252);
  patch('grey forehead', grey, C.grey, .0031);

  const stitch = (name: string, points: [number, number][], color: string, radius = .0017, lift = .005) => {
    const curve = new THREE.CatmullRomCurve3(points.map(([x, y]) => face(x, y, lift)));
    const part = mesh(new THREE.TubeGeometry(curve, 20, radius, 5, false), mat(color), name);
    part.castShadow = false;
  };
  for (const sign of [-1, 1]) {
    const cx = sign * .083, cy = .120;
    const eye = new THREE.Shape();
    eye.moveTo(cx - .041, cy - .007);
    eye.bezierCurveTo(cx - .033, cy + .035, cx + .027, cy + .035, cx + .041, cy - .007);
    eye.quadraticCurveTo(cx, cy - .004, cx - .041, cy - .007);
    patch('eye outline', eye, C.ink, .004);
    const white = new THREE.Shape();
    white.moveTo(cx - .036, cy - .003);
    white.bezierCurveTo(cx - .026, cy + .027, cx + .023, cy + .029, cx + .035, cy - .003);
    white.closePath();
    patch('eye white', white, C.eye, .006);
    const pupil = new THREE.Shape();
    pupil.moveTo(cx - .003, cy - .003);
    pupil.lineTo(cx - .003, cy + .024);
    pupil.quadraticCurveTo(cx + .021, cy + .024, cx + .025, cy - .003);
    pupil.closePath();
    patch('half open pupil', pupil, C.ink, .008);
    // The original cheek embroidery has both vertical curls and cheek arcs.
    stitch('cheek curl', [[sign * .136, .168], [sign * .134, .154], [sign * .142, .145]], C.red, .0025);
    stitch('cheek curl', [[sign * .148, .151], [sign * .146, .139], [sign * .155, .133]], C.red, .0023);
    stitch('cheek smile', [[sign * .115, .091], [sign * .135, .086], [sign * .151, .094]], C.red, .0025);
    stitch('cheek smile', [[sign * .122, .079], [sign * .136, .075], [sign * .148, .081]], C.red, .0019);
    // Small paw seam details remain attached to the solid front paws.
    for (const dx of [-.008, .008]) {
      oval('paw stitch', sign * .153 + dx, .030, .147, .0010, .010, .0010, mat('#cbc5bd'));
    }
  }
  const tongue = new THREE.Shape();
  tongue.moveTo(-.010, .065); tongue.lineTo(.011, .065);
  tongue.bezierCurveTo(.012, .037, -.010, .037, -.010, .065);
  patch('tongue', tongue, C.tongue, .006);
  stitch('nose', [[-.007, .083], [0, .078], [.007, .083]], C.ink, .0022);
  stitch('mouth center', [[0, .078], [0, .069]], C.ink, .0015);
  stitch('mouth', [[-.020, .068], [-.011, .063], [0, .069], [.011, .063], [.020, .068]], C.ink, .0017);
  return group;
}

/** A reusable, static plush: maximum footprint .42 x .56 m, height .38 m. */
export function createCatTeacherPlush(): THREE.Group {
  template ??= build();
  return template.clone(true);
}
