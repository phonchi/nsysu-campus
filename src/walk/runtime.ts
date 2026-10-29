import * as T from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { CampusLod } from '../walk-lod';
import { decorateCampus, addCampusProps, animateCampus } from '../walk-art';
import { CampusSky, PRESET_LABEL, type SkyPreset } from '../walk-sky';
import { NIGHT_MATERIALS, NIGHT_FADE } from '../walk-materials';
import { CampusUi, type CampusInfo } from '../walk-campus-ui';
import { buildWalkWorld, type WalkWorld, type WorldDoor } from '../walk-world';
import { wouldEnterDoor } from '../walk-door';
import type { CampusStructure, WalkBuilding, WalkDestination } from '../walk-types';
import { RapierController, initPhysics } from './controller';
import { doorConstraint, animateDoors } from './doors';
import { CameraRig } from './camera-rig';
import { Avatar } from './avatar';
import { surfaceRouteSegments } from './surface-route';
import { WalkInput } from './input';
import { selectInteraction, cycleInteraction, encounterReach } from './interaction-choice';
import { liftWins, toggleDoor, nearestDoor, type LiftStopRef } from './interaction';
import { hudTemplate, drawFloorMinimap, makeDoorSign, safe } from './hud';
import { toonify } from '../render/toon';
import { PostPipeline, POST_LOOKS, lerpLook } from '../render/post';
import { AdaptiveQuality, TIERS, initialTier, type Tier } from '../render/quality';
import { addOutlines, OUTLINE_UNIFORMS } from '../render/outline';
import { mergeStatic } from '../render/batch';
import { CampusSound } from '../audio/sound';
import { CampusMinimap } from './minimap';
import { Terrain } from '../world/terrain';
import { GrowableSurfaceField, campusVegetationVolumes } from '../world/growable-surface';
import { gateBarrierObstacles } from '../world/gate-barriers';
import { loadPlacements, landmarkCarves, landmarkTransforms, loadLandmarks, REPLACES } from '../world/landmarks';
import { OutdoorRoutes } from './route';
import { Campus, clearCampus, type Body } from '../story/collection';
import { clearProgress } from '../story/engine';
import { GrassTufts, type GroundMask } from '../render/ground';
import { buildClouds } from '../render/clouds';
import { Album } from '../story/album';
import { planProps, addProps, propsForTier } from '../world/props';
import { PhotoMode } from '../games/photo';
import { Bike, RIDE_SPEED } from './bike';
import { Quiz, Chase, judgeSunset, type Question } from '../games/minigames';
import { TalkDirector, type NpcData, type CollectionData } from '../story/talk';
import { PALETTES, modelFor, recolor } from './player-look';
import { planRoute as plan, followRoute, validateRoutes as validatePaths, sightLine } from './autopilot';
import { NpcManager, disposeObject, NPC_CAP, type StoryZones, type Preset } from '../world/npc';
import { StoryDirector } from '../story/director';
import type { StoryData } from '../story/schema';
import bundledQuests from '../../public/data/quests.json';
import { QuestEngine, QUEST_KEY, type QuestData, type QuestWorld } from '../story/quests';
import { EncounterEngine, type EncounterData } from '../story/encounters';
import { EncounterScene } from '../world/encounter-scene';
import { ObstacleField, doorCameraObstacles, type Obstacle } from './obstacles';
import { JournalView, type JournalModel } from '../story/journal';
import '../walkthrough.css';

const WALK_SPEED = 3.6, RUN_SPEED = 7.2;
/** Frame time cap. `?qa=1` lets slow software-rendered test browsers keep real-time simulation (physics still
 * sub-steps at 1/120 s, so movement and collisions are identical, only fewer frames are drawn). */
const QA = new URLSearchParams(location.search).get('qa') === '1';
const maxFrame = QA ? .25 : .065;
const base = import.meta.env.BASE_URL;
const asset = (s: string) => base + s.replace(/^\//, '');
const vegetationBoxes = (specs: readonly Obstacle[]) => specs.map(spec => {
  const o = new T.Object3D(); o.position.set(...spec.center); o.rotation.y = spec.yaw ?? 0; o.updateMatrix();
  const box = new T.Box3(new T.Vector3(...spec.half).negate(), new T.Vector3(...spec.half)).applyMatrix4(o.matrix);
  box.min.y = -Infinity; return box;
});

async function loadJson<T>(path: string, what: string): Promise<T> {
  if(QA && new URLSearchParams(location.search).get('qaFail')?.split(',').some(name=>path===`data/${name}.json`)) throw Error(`QA simulated failure: ${path}`);
  const r = await fetch(asset(path));
  if (!r.ok) throw Error(`${what}尚未就緒`);
  return r.json() as Promise<T>;
}

/** Fallback figure while (or if) the character GLB fails to load. */
function capsuleFigure() {
  const g = new T.Group(), m = (c: string) => new T.MeshStandardMaterial({ color: c, roughness: .8 });
  const trunk = new T.Mesh(new T.CapsuleGeometry(.25, .48, 4, 8), m('#e5ca81')); trunk.position.y = 1.05;
  const head = new T.Mesh(new T.SphereGeometry(.22, 12, 8), m('#d9b697')); head.position.y = 1.62;
  g.add(trunk, head);
  for (const side of [-1, 1]) { const leg = new T.Mesh(new T.CapsuleGeometry(.09, .44, 3, 6), m('#3b5559')); leg.position.set(side * .13, .42, 0); g.add(leg); }
  return g;
}

export interface WalkOptions { target?: string; story?: boolean; overview?: boolean }

export async function openWalkthrough(opts: WalkOptions = {}) {
  if (document.querySelector('.walkthrough')) return;
  const host = document.createElement('section');
  host.className = 'walkthrough'; host.setAttribute('aria-label', '中山校園可步行3D導覽');
  host.innerHTML = hudTemplate(asset, base);
  document.body.append(host); document.body.style.overflow = 'hidden';
  const get = <E extends HTMLElement>(s: string) => host.querySelector<E>(s)!;
  const status = get('.walk-status'); let statusTimer = 0;
  let encounters: EncounterEngine | undefined;
  let zoneLabels: Record<string,string> = {};
  let quests: QuestEngine | undefined, notebook: JournalView | undefined, npcDefinitions: NpcData | undefined, storageNotice = '';
  let refreshNotebook = () => {};
  const pocket = document.createElement('button'); pocket.className = 'quest-pocket'; pocket.hidden = true; host.append(pocket);
  pocket.addEventListener('click', () => openNotebook());
  /** Tour placement on start (gate / current goal); not for map arrivals, nor with ?spawn=arcade (QA tools). */
  const placeTour = !opts.target && new URLSearchParams(location.search).get('spawn') !== 'arcade';
  const say = (text: string, ms = 5000) => { status.textContent = text; clearTimeout(statusTimer); if (ms) statusTimer = window.setTimeout(() => status.textContent = '', ms); };
  const storageFailed = () => { storageNotice = '目前無法保存進度；此頁關閉後，部分進度可能遺失。'; say(storageNotice,9000); };
  window.addEventListener('campus-storage-error',storageFailed);
  const exitToMap = () => { host.remove(); document.body.style.overflow = ''; window.dispatchEvent(new Event('walkthrough-exit')); };

  let renderer: T.WebGLRenderer;
  let tier: Tier = initialTier();
  try { renderer = new T.WebGLRenderer({ antialias: !TIERS[tier].post, powerPreference: 'high-performance' }); }
  catch { exitToMap(); return; }
  const coarse = matchMedia('(pointer:coarse)').matches;
  renderer.setSize(innerWidth, innerHeight);
  renderer.localClippingEnabled = true; renderer.shadowMap.enabled = true;
  // Count every pass of a frame (shadow, scene, bloom, composite) in one total.
  renderer.info.autoReset = false;
  renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.03;
  get('.walk-canvas').append(renderer.domElement);
  const scene = new T.Scene(); scene.background = new T.Color('#c4d8d8'); scene.fog = new T.Fog('#c4d8d8', 180, 600);
  const camera = new T.PerspectiveCamera(58, innerWidth / innerHeight, .075, 1100);
  const orbit = new OrbitControls(camera, renderer.domElement);
  orbit.enabled = false; orbit.minDistance = 12; orbit.maxDistance = 650; orbit.maxPolarAngle = Math.PI * .48; orbit.enableDamping = true;
  const sun = new T.DirectionalLight('#fff0d0', 2.3); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -.0001; sun.shadow.normalBias = .12; scene.add(sun, sun.target);
  const sky = new CampusSky(scene, sun, renderer);
  // Night fill that travels with the player so characters never turn into silhouettes after dark.
  const fill = new T.PointLight('#d8e2ff', 0, 9, 1.4); // cool moonlit fill (art-direction-v4 §2.2) scene.add(fill);
  let post = new PostPipeline(renderer, TIERS[tier].samples || 4);
  /** Tier changes touch DPR, post chain, bloom, shadows and outline reach together. */
  let tufts: GrassTufts | undefined, clouds: T.InstancedMesh | undefined;
  let growable: GrowableSurfaceField | undefined;
  /** Tier changes adjust grass and clouds live; tree leaf density and prop sets are chosen at load. */
  function applyTier(t: Tier) {
    if (clouds) clouds.count = Math.min(24, TIERS[t].detail.clouds);
    if (npcs) npcs.cap = NPC_CAP[t];
    if (tufts) tufts.limit = TIERS[t].detail.tufts;
    tier = t; const q = TIERS[t];
    renderer.setPixelRatio(Math.min(devicePixelRatio, q.dprCap)); renderer.setSize(innerWidth, innerHeight);
    post.setSize(innerWidth * renderer.getPixelRatio(), innerHeight * renderer.getPixelRatio());
    // MSAA sample count is fixed per render target: rebuild the chain when the tier changes it.
    if (q.post && post.samples !== Math.min(q.samples, renderer.capabilities.maxSamples)) { post.dispose(); post = new PostPipeline(renderer, q.samples); }
    post.setSize(innerWidth * renderer.getPixelRatio(), innerHeight * renderer.getPixelRatio());
    post.bloomLayers = q.bloomLayers;
    renderer.shadowMap.enabled = q.shadows !== 'off'; sun.castShadow = q.shadows !== 'off';
    renderer.shadowMap.type = T.PCFShadowMap; // r186 dropped PCFSoft; soft tiers keep the larger map
    sun.shadow.radius = q.shadows === 'soft' ? 3 : 1;
    if (sun.shadow.mapSize.x !== q.shadowMap) { sun.shadow.mapSize.set(q.shadowMap, q.shadowMap); sun.shadow.map?.dispose(); sun.shadow.map = null; }
    renderer.shadowMap.needsUpdate = true;
    OUTLINE_UNIFORMS.uViewportH.value = innerHeight * renderer.getPixelRatio();
    for (const h of buildingHulls) h.visible = q.outlines === 'all';
    host.dataset.tier = t; lastShadowOverview = undefined;
  }
  const quality = new AdaptiveQuality(tier, t => { applyTier(t); say(`畫質自動調整為 ${t} 級以維持流暢`, 2500); });

  let world: WalkWorld, physics: RapierController, lod: CampusLod, alive = true;
  const buildingHulls: T.Mesh[] = [];
  const obstacleField = new ObstacleField(); let propsReady = false, legacyPropsReady = false, bikeStandReady = false;
  const featureStatus: Record<string,string> = { props:'loading', legacyProps:'loading', quests:'loading', encounters:'loading', landmarks:'loading', bike:'loading' };
  let failEncounterScene = false;
  let terrainRef: Terrain | undefined, replacedOsm = new Set<string>(), landmarksReady = false;
  let campusData: WalkBuilding[] = [], structure: CampusStructure, campusInfo: CampusInfo | undefined;
  try {
    const nav = await import('../walk-nav');
    const [buildings, access, s, terrain] = await Promise.all([
      nav.loadWalkBuildings(base),
      loadJson<{ floors: Record<string, WalkBuilding['floors'][number]['access']> }>('data/walkthrough/access-plan.json', '入口資料'),
      loadJson<CampusStructure>('data/walkthrough/campus-structure.json', '校園結構資料'),
      Terrain.load(asset),
      initPhysics(),
    ]);
    const placements = await loadPlacements(asset).catch(() => undefined);
    if (placements) {
      terrain.carves = landmarkCarves(placements);
      // OSM blocks that a hand-modelled landmark replaces are never built (display or collision).
      const gone = new Set(Object.keys(placements).map(id => REPLACES[id]).filter(Boolean));
      replacedOsm = gone;
    }
    campusData = buildings; structure = { ...s, context: { ...s.context, landmarks: s.context.landmarks.filter(l => !replacedOsm.has(l.id)) } };
    campusInfo = await loadJson<CampusInfo>('data/campus-info.json', '校園資訊').catch(() => undefined);
    for (const b of campusData) for (const f of b.floors) f.access = access.floors[f.id];
    world = buildWalkWorld(campusData, structure, terrain);
    world.display.userData.roadExclusions = s.context.landmarks.filter(l => replacedOsm.has(l.id)).map(l => l.polygon);
    if (placements?.tunnel) {
      const placement = placements.tunnel;
      world.display.userData.treeBores = [{
        inverse: landmarkTransforms('tunnel', placement, (x, z) => terrain.heightAt(x, z))[0].clone().invert(),
        bounds: new T.Box3(new T.Vector3(-3.9, -.3, -(placement.walkableLength ?? 20) - 2), new T.Vector3(3.9, 6.8, 2)),
      }];
    }
    decorateCampus(world, structure, terrain, TIERS[tier].detail.leaf);
    lod = new CampusLod(world, structure);
    scene.add(world.display);
    clouds = buildClouds(24, world.spawn); clouds.count = TIERS[tier].detail.clouds; scene.add(clouds);
    const mask = world.display.userData.groundMask as GroundMask | undefined;
    if (mask) {
      growable = new GrowableSurfaceField(terrain, mask);
      growable.setRoads(structure.context.roads);
      // Include closed building interiors and artificial floors, even when an upper
      // storey is hidden in the inspector. Only explicit terrain/pad is growable.
      growable.setVolumes('campus', campusVegetationVolumes(world.display, world.frames.keys()));
      tufts = new GrassTufts(6000, growable); scene.add(tufts.mesh);
    }
    world.display.traverse(o => { if (o.name === 'Campus roads · OSM' || o.name === 'Landmark features') mergeStatic(o); });
    toonify(world.display);
    // Outline only building shells and landmark extrusions; never trees, props, ground or interiors.
    world.display.traverse(o => { if (/^Campus LOD |^Campus exterior /.test(o.name)) buildingHulls.push(...addOutlines(o, 'building')); });
    physics = new RapierController(world.collision);
    const obstacles = (world.display.userData.obstacles ?? []) as Obstacle[];
    physics.addObstacles(obstacles); obstacleField.add(obstacles);
    physics.constrain = doorConstraint(world.doors);
    physics.teleport(world.spawn);
    terrainRef = terrain;
    void addCampusProps(world, url => new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(url), asset, () => alive, (x,z,y)=>physics.supportAt(x,z,y))
      .then(specs => { if (!alive) return; physics.addObstacles(specs ?? []); obstacleField.add(specs ?? []); growable?.setVolumes('legacy-props', vegetationBoxes(specs ?? [])); toonify(world.display); featureStatus.legacyProps='ready'; })
      .catch(e => { featureStatus.legacyProps='degraded'; console.warn('campus props',e); })
      .finally(()=>{ legacyPropsReady=true;validateRoutes(); });
    if (!placements) { landmarksReady = true; featureStatus.landmarks='degraded'; growable?.setReady(true); }
    if (placements) void loadLandmarks(asset, placements, terrain).then(lm => {
      if (!alive) { disposeObject(lm.display); disposeObject(lm.collision); return; }
      // Hand-modelled landmarks replace the OSM blocks and the v2 procedural features at those sites.
      world.display.traverse(o => { if (o.name.startsWith('Landmark features')) o.visible = false; });
      scene.add(lm.display); physics.addStatic(lm.collision);
      // Gate boom arms live in the merged visual GLB. Register their actual asset
      // bounds before announcing landmark readiness or validating outdoor routes.
      const barriers = gateBarrierObstacles(lm.display);
      physics.addObstacles(barriers); obstacleField.add(barriers);
      growable?.setVolumes('landmarks', lm.vegetationVolumes);
      growable?.setReady(true);
      landmarksReady = true; featureStatus.landmarks='ready'; validateRoutes();
    }).catch(e => { console.warn('landmarks', e); landmarksReady = true; featureStatus.landmarks='degraded'; validateRoutes(); });
  } catch (e) {
    get('.walk-loading').textContent = '校園圖資暫時無法開啟，請回到校園地圖。';
    get('.walk-welcome').hidden = true;
    get('[data-action=exit]').addEventListener('click', () => { alive = false; renderer.dispose(); orbit.dispose(); exitToMap(); }, { once: true });
    console.error(e); return;
  }
  get('.walk-loading').hidden = true;

  // ---- character -------------------------------------------------------------------------
  const avatar = new Avatar(); scene.add(avatar.root);
  const fallback = capsuleFigure(); toonify(fallback); addOutlines(fallback, 'character'); avatar.setModel(fallback); avatar.face(-Math.PI / 2);
  const gltf = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const campus = new Campus();
  const look = () => campus.progress.player;
  const markChar = () => {
    host.querySelectorAll<HTMLElement>('[data-body]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.body === look().body)));
    const pal = get('.walk-palettes');
    pal.innerHTML = PALETTES[look().body].map((p, i) => `<button data-palette="${i}" role="radio" aria-checked="${i === look().palette}" title="${p.name}" aria-label="${p.name}" style="--c1:${p.look.top};--c2:${p.look.bottom}"></button>`).join('');
  };
  let loading = '';
  const loadCharacter = () => {
    const key = modelFor(look().body), palette = look().palette, token = `${key}:${palette}`;
    loading = token;
    gltf.load(asset(`models/characters/${key}.glb`), g => {
      if (!alive || loading !== token) { disposeObject(g.scene); return; }
      // glTF characters face +Z; the avatar's facing math assumes -Z.
      g.scene.rotation.y = Math.PI;
      toonify(g.scene); recolor(g.scene, PALETTES[look().body][palette].look, true); addOutlines(g.scene, 'character');
      avatar.setModel(g.scene, g.animations);
    }, undefined, () => say('角色模型載入失敗，改用簡易人物。', 3000));
  };
  const nick = get<HTMLInputElement>('.walk-nick input');
  nick.value = look().nickname;
  nick.addEventListener('change', () => { campus.setPlayer({ nickname: nick.value }); nick.value = look().nickname; });
  markChar(); loadCharacter();

  // ---- camera & modes --------------------------------------------------------------------
  const rig = new CameraRig(camera, (a, b, r) => physics.sweep(a, b, r));
  rig.yaw = -Math.PI / 2; rig.snap(physics.position);
  let walking = false, overview = true, inspectedBuilding = 'SC';
  const buildingSelect = get<HTMLSelectElement>('[data-building]'), floorSelect = get<HTMLSelectElement>('[data-floor]');

  function chooseMode(isOverview: boolean) {
    overview = isOverview; walking = true;
    host.classList.toggle('is-overview', isOverview); get('.walk-welcome').hidden = true;
    orbit.enabled = isOverview;
    get('[data-action="walk"]').classList.toggle('is-active', !isOverview);
    get('[data-action="overview"]').classList.toggle('is-active', isOverview);
    if (document.pointerLockElement) document.exitPointerLock();
    if (isOverview) {
      const group = campusData.find(b => b.id === inspectedBuilding) ?? campusData[0];
      const f = group.floors.find(f => f.level === 1) ?? group.floors[0];
      const target = new T.Vector3((f.bounds[0] + f.bounds[2]) / 2, 3, (f.bounds[1] + f.bounds[3]) / 2).applyMatrix4(world.frames.get(group.id)!);
      orbit.target.copy(target); camera.position.copy(target).add(new T.Vector3(-70, 80, 75)); orbit.update();
    } else { floorSelect.value = 'all'; rig.snap(physics.position); startStoryWhenReady(); }
    updateUi();
  }
  function setFirstPerson(on: boolean) {
    rig.firstPerson = on;
    get('[data-action="camera"]').textContent = on ? '第一人稱 V' : '第三人稱 V';
    if (on && !coarse) renderer.domElement.requestPointerLock?.();
    else if (document.pointerLockElement) document.exitPointerLock();
  }
  function toggleLock() {
    const locked = rig.toggleLock();
    get('[data-action=lock]').setAttribute('aria-pressed', String(locked)); get('[data-action=lock]').classList.toggle('is-active', locked);
    get('.walk-lock-badge').hidden = !locked;
    say(locked ? '視角已鎖定：角度與距離固定，再按 L 解除。' : '視角已解除鎖定，可拖曳轉動。', 2500);
  }
  const sound = new CampusSound();
  const soundLabel = () => host.querySelectorAll<HTMLElement>('[data-action=sound]').forEach(b => { if (!b.classList.contains('walk-icon')) b.textContent = sound.enabled ? '音樂 開' : '音樂 關'; b.setAttribute('aria-pressed', String(sound.enabled)); });
  soundLabel();
  host.addEventListener('pointerdown', () => sound.resumeIfEnabled(), { once: true });
  // Coast samples for the sea ambience (OSM water polygons, world metres).
  const coast = structure.context.water.filter(w => w.kind === 'coastline').flatMap(w => w.points);
  const seaProximity = (p: T.Vector3) => { let d = Infinity; for (const [x, z] of coast) d = Math.min(d, Math.hypot(x - p.x, z - p.z)); return T.MathUtils.clamp(1 - (d - 20) / 180, 0, 1); };
  let seaMix = 0, lastSea = 0;
  function cycleSky() {
    const order: SkyPreset[] = ['day', 'sunset', 'night'];
    const next = order[(order.indexOf(sky.preset) + 1) % order.length];
    sky.set(next); get('[data-action=sky]').textContent = `${PRESET_LABEL[next]} N`; say(`時段：${PRESET_LABEL[next]}`, 2000);
  }

  // ---- routes ----------------------------------------------------------------------------
  const routeLine = new T.Group(); scene.add(routeLine);
  let navigation: { findPath: (a: T.Vector3, b: T.Vector3) => T.Vector3[]; dispose: () => void } | undefined;
  let navigationError = '導航網格載入中';
  void import('../walk-nav').then(m => m.loadWalkNavigation(base, 'campus-science-engineering-v2', terrainRef?.surfaceVersion)).then(n => {
    if (!alive) { n.dispose(); return; } navigation = n; navigationError = '';
  }).catch(e => { navigationError = '自動帶路暫時未就緒；仍可自由探索。'; console.warn('walk nav', String(e)); });
  let autoPath: T.Vector3[] = [], pathIndex = 0, autoDestination: WalkDestination | undefined, pendingDestination: WalkDestination | undefined;
  let progressTime = 0, replans = 0; const progressPosition = new T.Vector3();
  const disposeTree = (root: T.Object3D) => root.traverse(o => {
    if (o instanceof T.Mesh || o instanceof T.Line) { o.geometry.dispose(); for (const m of [o.material].flat()) m.dispose(); }
  });
  function clearRoute() { disposeTree(routeLine); routeLine.clear(); }
  function clearAuto(manual = false) {
    const was = autoPath.length > 0;
    autoPath = []; autoDestination = undefined; pendingDestination = undefined; clearRoute();
    if (manual && was) say('已暫停帶路，可自由探索。', 2500);
  }
  function drawRoute(path: T.Vector3[]) {
    clearRoute();
    for (const points of surfaceRouteSegments(path, routeSurface)) {
      routeLine.add(new T.Line(new T.BufferGeometry().setFromPoints(points), new T.LineBasicMaterial({ color: '#f2c94c', depthTest: true, depthWrite: false })));
    }
  }
  const routeSurface = {
    support: (x: number, z: number, y: number) => physics.supportAt(x, z, y),
    clear: (a: T.Vector3, b: T.Vector3) => physics.sweep(a.clone().add(new T.Vector3(0, .2, 0)), b.clone().add(new T.Vector3(0, .2, 0)), .04) >= a.distanceTo(b) - .02,
  };
  /** Auto-walk along the outdoor path network to a named anchor (non-walkable landmarks, story places). */
  function walkOutdoor(anchor: string) {
    if(!routesValidated) { say('場景碰撞與步道仍在準備，請稍候再開始帶路。');return; }
    routes?.avoid.splice(0);
    const p = routes?.path(physics.position, anchor) ?? [];
    if (!p.length) { say('找不到通往這裡的步道；請從地圖查看位置。', 5000); return; }
    clearAuto(); autoPath = p; pathIndex = 0; replans = 0; progressTime = performance.now(); progressPosition.copy(physics.position);
    autoDestination = { id: anchor, label: routes!.label(anchor), position: p[p.length - 1].toArray() as [number, number, number], buildingId: anchor, floorId: 'outdoor' } as WalkDestination;
    chooseMode(false); drawRoute(p); say(`沿校園步道走到 ${autoDestination.label}`, 6000);
  }
  function goTo(destination: WalkDestination) {
    routes?.avoid.splice(0);
    get('.walk-results').hidden = true; get<HTMLInputElement>('.walk-search input').blur(); clearAuto();
    if (!routesValidated) { say('場景碰撞與步道仍在準備，請稍候再開始帶路。'); return; }
    if (!navigation) { say(navigationError || '導航資料尚未就緒'); return; }
    if (!physics.onGround) { pendingDestination = destination; chooseMode(false); say('落地後開始帶路。'); return; }
    const p = planRoute(new T.Vector3(...destination.position));
    if (!p.length) { say('找不到通往這裡的路線；請先走到道路上，或按「回到起點」再試。', 7000); return; }
    autoPath = p; pathIndex = 0; replans = 0; autoDestination = destination; progressTime = performance.now(); progressPosition.copy(physics.position);
    chooseMode(false); drawRoute(p); say(`帶你走到 ${destination.label}｜虛擬導覽，含示意路段`, 7000);
  }

  // ---- interaction -----------------------------------------------------------------------
  const liftPanel = get('.walk-lift');
  function showLift(found: LiftStopRef) {
    liftPanel.innerHTML = `<strong>${safe(found.lift.buildingId)} 電梯（示意）</strong><div>${found.lift.stops.map(s => `<button data-stop="${safe(s.floorId)}"${s === found.stop ? ' aria-current="true"' : ''}>${safe(s.label)}</button>`).join('')}</div>`;
    liftPanel.hidden = false;
  }
  liftPanel.addEventListener('click', e => {
    const id = (e.target as HTMLElement).closest<HTMLElement>('[data-stop]')?.dataset.stop, found = liftWins(world, physics.position);
    liftPanel.hidden = true;
    if (!id || !found) return;
    const stop = found.lift.stops.find(s => s.floorId === id)!;
    if (stop === found.stop) return;
    clearAuto(true); if(!teleportTo(stop.position,undefined,true))return;
    say(`電梯抵達 ${stop.label}｜電梯位置為示意`, 3500);
  });
  type Candidate = { id:string; priority:number; distance:number; label:string; point:T.Vector3; run:()=>void };
  let selectedInteraction: string | undefined;
  function interactionCandidates(): Candidate[] {
    if (notebook?.open || menuOpen() || overview || !walking || photo.active || quiz?.open) return [];
    const p=physics.position, out:Candidate[]=[];
    const add=(id:string,label:string,priority:number,point:T.Vector3|undefined,run:()=>void)=>{if(point)out.push({id,label,priority,point:point.clone(),distance:p.distanceTo(point),run});};
    if (director?.canInteract) add('story','繼續新生導覽',100,director.goal()??p,()=>{director?.press();});
    const monkey=npcs?.get('m3-thief');
    if(chase.active && monkey && Math.hypot(p.x-monkey.position.x,p.z-monkey.position.z)<2.2) add('chase','拿回便當',95,monkey.position,()=>{chase.press(p);});
    const encounter=encounters?.active;
    if(encounter && p.distanceTo(encounterTarget())<=encounterReach(encounter.phase)) add('encounter',encounter.phase==='offered'?'參與偶遇':'完成偶遇互動',90,encounterTarget(),()=>{pressEncounter();});
    for(const v of quests?.list()??[]) {
      const step=v.step; if(!step || step.kind==='photo' || (step.when && step.when!==sky.preset))continue;
      const point=questPoint(step.target);if(!point || p.distanceTo(point)>(step.radius??4))continue;
      add(`quest:${v.definition.id}`,v.definition.title,step.target.startsWith('npc:')?80:10,point,()=>{void sideQuestDialogue(v.definition.id);});
    }
    const person=talk?.candidate(p);
    if(person) add(`talk:${person.id}`,`交談・${person.name}`,75,npcs?.get(person.id)?.position,()=>{talk?.press(p);});
    if(bike.atStand(p)) add('bike','租腳踏車',70,bike.stand,()=>{ if (avatar.rideReady) bike.press(p); else say('腳踏車與人物姿勢仍在準備，請稍候。', 2500); });
    const lift=liftWins(world,p);
    if(lift) add('lift','搭電梯',60,lift.stop.position,()=>{if(liftPanel.hidden)showLift(lift);else liftPanel.hidden=true;});
    const door=nearestDoor(world,p);
    if(door) add(`door:${door.id}`,`${door.target?'關門':'開門'}・${door.label}`,50,door.position,()=>{
      const r=toggleDoor(world,p);if(r.kind==='blocked')say('請先離開門口，再關門。');else if(r.kind!=='none')say(`${r.kind==='opened'?'打開':'關上'} ${r.door.label}｜室內配置為示意`,3000);
    });
    if(campusUi?.nearStory) add('history','校園故事',45,p,()=>{campusUi.interact(p);});
    return out;
  }
  function selectedCandidate() { return selectInteraction(interactionCandidates(),selectedInteraction); }
  function cycleTarget() {
    const choices=interactionCandidates(), selected=cycleInteraction(choices,selectedInteraction);
    selectedInteraction=selected?.id;
    if(selected)say(`互動目標：${selected.label}（E 互動，R 切換）`,2500);
  }
  function interact() {
    if(director?.blocking) { director.press(); return; }
    const candidate=selectedCandidate();
    if(candidate) candidate.run(); else say('靠近人物或互動物件後按 E；多個目標時按 R 切換。',2500);
  }
  function resetToSpawn() { clearAuto(); if(!moveSafely(world.spawn)) { say('起點附近沒有安全落點，請稍後再試或返回校園地圖。',7000); return; } recoveryFailed=false; avatar.face(-Math.PI / 2); rig.yaw = -Math.PI / 2; rig.pitch = -.18; rig.snap(physics.position); chooseMode(false); say('已回到理工長廊前的安全位置。'); }

  // ---- menu (Esc) ------------------------------------------------------------------------
  const menu = get('.walk-menu');
  get('.walk-menu-search').append(get('.walk-search')); get('.walk-menu-tools').append(get('.walk-toolbar'));
  const menuOpen = () => !menu.hidden;
  function setMenu(open: boolean, tab?: string) {
    menu.hidden = !open;
    if (open) { notebook?.close(); input.release(); clearAuto(); if (tab) showTab(tab); menu.querySelector<HTMLElement>('[data-tab][aria-selected=true]')?.focus(); }
    get('[data-action=menu]').setAttribute('aria-pressed', String(open));
  }
  function showTab(tab: string) {
    menu.querySelectorAll<HTMLElement>('[data-tab]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
    menu.querySelectorAll<HTMLElement>('[data-pane]').forEach(p => { p.hidden = p.dataset.pane !== tab; });
    if (tab === 'album') renderAlbum();
  }
  let renderAlbum = () => {};
  menu.addEventListener('click', e => {
    const t = e.target as HTMLElement, tab = t.closest<HTMLElement>('[data-tab]')?.dataset.tab;
    if (tab) { showTab(tab); return; }
    if (t === menu) setMenu(false);
    // Mode buttons act and close the menu so the player sees the result.
    const a = t.closest<HTMLElement>('[data-action]')?.dataset.action;
    if (a && ['walk', 'overview', 'camera', 'lock', 'sky', 'reset', 'character'].includes(a)) window.setTimeout(() => setMenu(false), 0);
  });

  // ---- photo mode (P) --------------------------------------------------------------------
  const photo = new PhotoMode({
    host, camera, canvas: renderer.domElement,
    ground: (x, z) => terrainRef ? terrainRef.heightAt(x, z) : -.055,
    setSky: p => { sky.set(p); get('[data-action=sky]').textContent = `${PRESET_LABEL[p]} N`; },
    sky: () => sky.preset, cue: id => sound.cue(id),
    saved: () => campus.count('photo.saved'),
    recordShot: () => {
      const at = camera.position.clone(), preset = sky.preset;
      const distances = new Map((quests?.data.quests ?? []).flatMap(q=>q.steps.map(step=>[step.target,questPoint(step.target)?.distanceTo(at) ?? Infinity] as const)));
      const snapshot: QuestWorld = { distanceTo:t=>distances.get(t)??Infinity, timeOfDay:()=>preset };
      return () => { const before=quests?.progress.journal.length; quests?.notifyPhoto(snapshot); if (quests && quests.progress.journal.length !== before) say('照片已收進手帳，拍攝任務完成這一步。'); };
    },
    exited: () => rig.snap(physics.position),
  });
  function enterPhoto() {
    if (overview || !walking || director?.blocking) return;
    setMenu(false); clearAuto(); photo.enter(physics.position, rig.yaw);
  }

  // ---- rental bike (gate → campus on wheels) ---------------------------------------------
  const occAt = (x: number, z: number) => (world.display.userData.occupancy as { at(x: number, z: number): number } | undefined)?.at(x, z) ?? 0;
  /** Open ground near the gate for the rental stand (first free cell spiralling out from a spot beside it). */
  const standSpot = (() => {
    const gx = -78, gz = 603; // across the gate from where a fresh tour starts, so it never blocks the first view
    for (let r = 0; r < 14; r++) for (let a = 0; a < 16; a++) {
      const x = gx + Math.cos(a / 16 * Math.PI * 2) * r, z = gz + Math.sin(a / 16 * Math.PI * 2) * r;
      if (occAt(x, z) === 0 && occAt(x + 2, z) === 0 && occAt(x - 2, z) === 0) return new T.Vector3(x, terrainRef ? terrainRef.heightAt(x, z) : 0, z);
    }
    return new T.Vector3(gx, terrainRef ? terrainRef.heightAt(gx, gz) : 0, gz);
  })();
  const bike = new Bike({
    stand: standSpot,
    rented: () => campus.progress.flags.includes('v4.bike'),
    rent: () => campus.setFlag('v4.bike'),
    outdoors: p => occAt(p.x, p.z) !== 1 && p.y < (terrainRef ? terrainRef.heightAt(p.x, p.z) : 0) + 1.2,
    say, cue: id => sound.cue(id),
  });
  function toggleBike() {
    if (!bike.riding && !avatar.rideReady) { say('腳踏車與人物姿勢仍在準備，請稍候。', 2500); return; }
    bike.toggle(physics.position);
  }
  scene.add(bike.standGroup);
  void new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(asset('models/campus/bicycle.glb')).then(g => {
    if (!alive) { disposeObject(g.scene); return; }
    toonify(g.scene);
    // Stand: three parked bikes and a sign; the ridden bike is a fourth copy under the avatar.
    const parked:T.Object3D[]=[];
    for (let k = 0; k < 3; k++) { const c = g.scene.clone(); c.position.set(k * .7 - .7, 0, 0); c.rotation.y = Math.PI / 2; bike.standGroup.add(c); parked.push(c); }
    const sign = makeDoorSign('租借腳踏車 E'); sign.position.set(0, 1.6, -.6); sign.rotation.y = Math.PI; bike.standGroup.add(sign); parked.push(sign);
    const obstacles:Obstacle[]=parked.map((part,i)=>{const bounds=new T.Box3().setFromObject(part),center=bounds.getCenter(new T.Vector3()),half=bounds.getSize(new T.Vector3()).multiplyScalar(.5);return {id:`rental:${i}`,shape:'box',center:center.toArray(),half:[Math.max(.06,half.x),Math.max(.06,half.y),Math.max(.06,half.z)]};});
    physics.addObstacles(obstacles);obstacleField.add(obstacles);featureStatus.bike='ready';
    growable?.setVolumes('bike-stand', vegetationBoxes(obstacles));
    const ride = g.scene.clone(); ride.rotation.y = 0; ride.position.y = 0;
    const holder = new T.Group(); holder.name = 'Ridden bike'; holder.add(ride); avatar.setVehicle(holder);
  }).catch(e => {featureStatus.bike='degraded';console.warn('bike', e);}).finally(()=>{bikeStandReady=true;validateRoutes();});

  // ---- input -----------------------------------------------------------------------------
  const input = new WalkInput(renderer.domElement, get('.walk-joystick'), get('.walk-stick'), {
    modal(k, mode) {
      if (notebook?.open) { notebook.key(k); return; }
      if (mode === 'dialogue') director?.ui.key(k);
      else if (mode === 'photo') photo.key(k);
      else if (mode === 'menu' && quiz?.open) quiz.key(k);
      else if (mode === 'menu') { if (k === 'j') { openNotebook(); return; } if (k === 'escape') setMenu(false); else if (k === '/') { setMenu(true, 'play'); get<HTMLInputElement>('.walk-search input').focus(); } }
    },
    press(k) {
      if (k === 'j') { openNotebook(); return; }
      if (k === 'escape' && encounters?.active?.phase === 'active') { encounters.giveUp(); say('這次先放過它，下次再遇見！'); return; }
      if (k === 'escape' && chase.active) { chase.cancel(); say('放棄追逐。', 2500); return; }
      if (k === 'escape' && !autoPath.length && get('.walk-results').hidden) { setMenu(true, 'play'); return; }
      if (k === 'escape') { get('.walk-results').hidden = true; get<HTMLInputElement>('.walk-search input').blur(); input.release(); clearAuto(); say('已暫停帶路'); return; }
      if (k === '/') { setMenu(true, 'play'); get<HTMLInputElement>('.walk-search input').focus(); return; }
      if (k === 'm') { chooseMode(walking ? !overview : true); return; }
      if (k === 'v') { setFirstPerson(!rig.firstPerson); return; }
      if (k === 'l') { toggleLock(); return; }
      if (k === 'e') { interact(); return; }
      if (k === 'n') cycleSky();
      if (k === 'p') enterPhoto();
      if (k === 'b') toggleBike();
      if (k === 'g') followQuest();
      if (k === 'r') cycleTarget();
    },
    moveStarted() { if (!walking || overview) chooseMode(false); clearAuto(true); },
    look(dx, dy) { if (photo.active) photo.look(dx, dy); else rig.rotate(dx, dy); },
    zoom(d) { if (photo.active) photo.zoom(d); else rig.zoom(d); },
    canLook: () => !overview,
  });
  renderer.domElement.addEventListener('click', () => { if (rig.firstPerson && !overview && !coarse && !document.pointerLockElement) renderer.domElement.requestPointerLock?.(); });
  host.addEventListener('pointerdown', e => { if (e.pointerType === 'touch') host.classList.add('has-touch'); });
  if (coarse) get('.walk-help').textContent = '左搖桿移動 · 右側拖曳轉頭 · 按鈕奔跑／互動／跳躍';

  const searchInput = get<HTMLInputElement>('.walk-search input');
  searchInput.addEventListener('input', () => {
    const term = searchInput.value.normalize('NFKC').toUpperCase().replace(/\s/g, ''), results = get('.walk-results');
    if (!term) { results.hidden = true; return; }
    const matches = world.destinations.filter(d => (d.label + ' ' + d.buildingId).normalize('NFKC').toUpperCase().includes(term)).slice(0, 12);
    results.innerHTML = matches.length ? matches.map(d => `<button data-destination="${safe(d.id)}"><strong>${safe(d.label)}</strong><small>${safe(d.floorId)} · 帶我走到門口 →</small></button>`).join('')
      : '<div class="walk-empty">找不到這個名稱。可試房號前綴，或選擇上方大樓與樓層探索。</div>';
    results.hidden = false;
  });
  host.addEventListener('click', e => {
    const target = e.target as HTMLElement;
    const bodyBtn = target.closest<HTMLElement>('[data-body]'), palBtn = target.closest<HTMLElement>('[data-palette]');
    if (bodyBtn) { if (bodyBtn.dataset.body !== look().body) { campus.setPlayer({ body: bodyBtn.dataset.body as Body, palette: 0 }); markChar(); loadCharacter(); } return; }
    if (palBtn) { campus.setPlayer({ palette: Number(palBtn.dataset.palette) }); markChar(); loadCharacter(); return; }
    const destination = target.closest<HTMLElement>('[data-destination]')?.dataset.destination;
    if (destination) { const d = world.destinations.find(d => d.id === destination); if (d) { setMenu(false); goTo(d); } return; }
    const action = target.closest<HTMLElement>('[data-action]')?.dataset.action;
    switch (action) {
      case 'start': case 'walk': chooseMode(false); break;
      case 'overview': chooseMode(true); break;
      case 'run': input.runToggle = !input.runToggle; break;
      case 'camera': setFirstPerson(!rig.firstPerson); break;
      case 'lock': toggleLock(); break;
      case 'cycle-target': cycleTarget(); break;
      case 'door': interact(); break;
      case 'sky': cycleSky(); break;
      case 'sound': void sound.toggle().then(soundLabel); break;
      case 'jump': clearAuto(true); input.jump = true; break;
      case 'reset': resetToSpawn(); break;
      case 'menu': setMenu(!menuOpen(), 'play'); break;
      case 'journal': openNotebook(); break;
      case 'photo': enterPhoto(); break;
      case 'bike': toggleBike(); break;
      case 'menu-close': setMenu(false); break;
      // Back to walking first (chooseMode hides the welcome card), then reopen the card for body, colours and nickname.
      case 'character': chooseMode(false); markChar(); get('.walk-welcome').hidden = false; get<HTMLInputElement>('.walk-nick input').value = look().nickname; break;
      case 'restart-tour': if (confirm('重新開始新生導覽？保留角色、收藏、支線與校園手帳。')) { clearProgress(); location.reload(); } break;
      case 'clear-all': if (confirm('清除全部導覽、收藏、支線與手帳紀錄？此操作無法復原，角色與暱稱保留。')) { clearProgress(); clearCampus(true); quests?.clear(); localStorage.removeItem(QUEST_KEY); location.reload(); } break;
      case 'exit': close(); break;
    }
  });
  buildingSelect.innerHTML = campusData.map(b => `<option value="${safe(b.id)}">${safe(b.name)}</option>`).join(''); buildingSelect.value = 'SC';
  const floorOptions = () => { floorSelect.innerHTML = '<option value="all">全棟</option>' + world.floors.filter(f => f.buildingId === inspectedBuilding).map(f => `<option value="${safe(f.data.id)}">${safe(f.data.label)}</option>`).join(''); };
  floorOptions();
  buildingSelect.addEventListener('change', () => { inspectedBuilding = buildingSelect.value; floorOptions(); chooseMode(true); });
  floorSelect.addEventListener('change', () => { if (!overview) chooseMode(true); });
  const campusUi = campusInfo ? new CampusUi(host, scene, world, structure, campusData, campusInfo, {
    goToBuilding: id => { const d = world.destinations.find(d => d.id === `${id}-1F-entrance`); if (d) { chooseMode(false); goTo(d); } },
    inspectBuilding: id => { chooseMode(true); buildingSelect.value = id; buildingSelect.dispatchEvent(new Event('change')); },
    say,
  }) : undefined;
  const resize = () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); applyTier(tier); };
  window.addEventListener('resize', resize);

  // ---- HUD refresh (7 Hz) ----------------------------------------------------------------
  const minimap = get<HTMLCanvasElement>('.walk-minimap'), ctx = minimap.getContext('2d')!;
  const minimapSheet = new CampusMinimap(); void minimapSheet.load(asset).catch(e => console.warn('minimap', e));
  let currentFloor = world.floors.find(f => f.buildingId === 'SC' && f.data.level === 1)!;
  const inverseFrames = new Map([...world.frames].map(([id, m]) => [id, m.clone().invert()]));
  const signs = new Map<string, T.Mesh>();
  let placeIndoors = false;
  function updateUi() {
    const foot = physics.position; let nearestBuilding = 'SC', best = Infinity;
    for (const b of campusData) {
      const p = foot.clone().applyMatrix4(inverseFrames.get(b.id)!), fs = world.floors.filter(f => f.buildingId === b.id);
      const box = (fs.find(f => f.data.level === 1) ?? fs[0]).data.bounds;
      const score = Math.hypot(Math.max(box[0] - p.x, 0, p.x - box[2]), Math.max(box[1] - p.z, 0, p.z - box[3])) * (world.scales.get(b.id) ?? 1);
      if (score < best) { best = score; nearestBuilding = b.id; }
    }
    currentFloor = world.floors.filter(f => f.buildingId === nearestBuilding && f.y <= foot.y + .65).sort((a, b) => b.y - a.y)[0] ?? world.floors.find(f => f.buildingId === nearestBuilding)!;
    const selected = world.floors.find(f => f.data.id === floorSelect.value), floorRecord = overview && selected ? selected : currentFloor;
    const buildingName = campusData.find(b => b.id === nearestBuilding)!.name;
    placeIndoors = best < .5;
    get('#walk-place').textContent = autoDestination ? `前往 ${autoDestination.label}` : best < 8 ? `${buildingName}・${currentFloor.data.label}` : director?.zoneLabel ?? (best < 60 ? '中山・理工校園' : '中山大學・西子灣');
    lod.update(foot, { overview, buildingId: inspectedBuilding, floorId: floorSelect.value });
    const runBtn = get('[data-action=run]'); runBtn.classList.toggle('is-running', input.running); runBtn.setAttribute('aria-pressed', String(input.running));
    for (const door of world.doors) {
      const distance = door.position.distanceTo(foot), floorVisible = world.floors.find(f => f.data.id === door.floorId)?.group.visible !== false;
      door.group.visible = distance < 75 && floorVisible;
      let sign = signs.get(door.id);
      if (distance < 19 && floorVisible) {
        if (!sign) { sign = placeSign(door); signs.set(door.id, sign); }
        sign.visible = true;
      } else if (sign) {
        sign.visible = false;
        if (distance > 65) { scene.remove(sign); disposeTree(sign); signs.delete(door.id); }
      }
    }
    drawFloorMinimap(ctx, world, floorRecord, foot, rig.yaw, autoPath, inverseFrames.get(floorRecord.buildingId)!);
    if ((overview && floorSelect.value === 'all') || (!overview && best >= 4)) {
      const center = overview ? orbit.target : foot, heading = overview ? Math.atan2(camera.position.x - orbit.target.x, camera.position.z - orbit.target.z) : rig.yaw;
      if (!minimapSheet.draw(ctx, center, heading, director?.goal())) campusUi?.drawMinimap(ctx, center, heading);
    }
    const door = nearestDoor(world, foot), inLift = liftWins(world, foot);
    if (!inLift) liftPanel.hidden = true;
    const candidate=selectedCandidate(); get('[data-action=door]').textContent=candidate?`${candidate.label} E`:'互動 E';
  }
  function placeSign(door: WorldDoor) {
    const mesh = makeDoorSign(door.label), normal = door.outside.clone().sub(door.position); normal.y = 0; normal.normalize();
    mesh.position.copy(door.position).addScaledVector(normal, .13).add(new T.Vector3(0, 2.55, 0));
    mesh.quaternion.setFromUnitVectors(new T.Vector3(0, 0, 1), normal); scene.add(mesh); return mesh;
  }

  function close() {
    alive = false; campusUi?.dispose(); clearTimeout(statusTimer); cancelAnimationFrame(frameId);
    input.dispose(); window.removeEventListener('campus-storage-error',storageFailed); window.removeEventListener('resize', resize); orbit.dispose(); navigation?.dispose();
    encounterScene.dispose();
    notebook?.dispose(); director?.dispose(); npcs?.dispose(); photo.dispose();
    lod.dispose(); physics.dispose(); avatar.dispose(); post.dispose(); sound.dispose(); renderer.dispose();
    for (const sign of signs.values()) disposeTree(sign); signs.clear();
    Reflect.deleteProperty(window, 'campusWalk'); sky.dispose();
    const seen = new Set<unknown>();
    scene.traverse(o => {
      if (!(o instanceof T.Mesh || o instanceof T.Line || o instanceof T.Points)) return;
      o.geometry.dispose();
      for (const m of [o.material].flat() as T.Material[]) {
        if (seen.has(m)) continue; seen.add(m);
        for (const v of Object.values(m)) if (v instanceof T.Texture && !seen.has(v)) { seen.add(v); v.dispose(); }
        // Textures held in shader uniforms (sea heights, cloud puffs, lawn mask and detail) are not material fields.
        const uniforms = { ...((m as T.ShaderMaterial).uniforms ?? {}), ...(m.userData.lawn ?? {}) } as Record<string, { value: unknown }>;
        for (const u of Object.values(uniforms)) if (u?.value instanceof T.Texture && !seen.has(u.value)) { seen.add(u.value); u.value.dispose(); }
        m.dispose();
      }
    });
    NIGHT_MATERIALS.clear(); NIGHT_FADE.clear(); exitToMap();
    const url = new URL(location.href); url.searchParams.delete('view'); history.replaceState(null, '', url);
  }

  const encounterScene = new EncounterScene(scene, { asset, ground:(x,z,y)=>physics.supportAt(x,z,y??physics.position.y), sweep:(a,b,r)=>physics.sweep(a,b,r), actorSweep:(id,a,b,r,h)=>physics.sweepActor(id,a,b,r,h) });
  const encounterTarget = () => encounterScene.getTarget() ?? physics.position.clone().addScalar(1e6);
  const encounterPanel = document.createElement('div'); encounterPanel.className = 'encounter-card'; encounterPanel.hidden = true; host.append(encounterPanel);
  let encounterInstance = '', encounterHits = 0, encounterPhotoBaseline = 0;
  function syncEncounter() {
    const a = encounters?.active;
    encounterPanel.hidden = !a; host.classList.toggle('has-encounter',!!a);
    if (!a) { encounterScene.reset(); return; }
    if (a.instance !== encounterInstance) {
      encounterInstance = a.instance; encounterHits = 0; encounterPhotoBaseline = campus.progress.counters['photo.saved'] ?? 0;
      if (failEncounterScene || !encounterScene.start(a.definition,physics.position.clone())) { failEncounterScene=false; encounters?.offerSceneFailed(); say('附近空間不足，這次偶遇先留到下次。'); return; }
      say(`${a.definition.title}：${a.definition.description}`,6000); sound.cue('chime');
    }
    encounterPanel.innerHTML = `<strong>${safe(a.definition.title)}</strong><p>${safe(a.definition.description)}</p>${a.phase === 'offered' ? '<button data-encounter="accept">來幫忙！</button><button data-encounter="skip">下次吧</button>' : '<small>靠近場景目標按 E · Esc 放棄</small><button data-encounter="skip">先離開</button>'}`;
  }
  encounterPanel.addEventListener('click', e => {
    const action = (e.target as HTMLElement).closest<HTMLElement>('[data-encounter]')?.dataset.encounter;
    if (action === 'accept') { encounters?.accept(); input.release(); }
    if (action === 'skip') encounters?.giveUp();
  });
  function encounterWorld(): QuestWorld {
    const world = questWorld();
    return { ...world, distanceTo: target => encounters?.active?.phase === 'active' && target === encounters.active.definition.target ? physics.position.distanceTo(encounterTarget()) : world.distanceTo(target) };
  }
  function animateEncounter(dt:number,_time:number,paused:boolean) {
    encounterScene.update(dt,physics.position,paused,encounters?.active?.phase === 'active');
  }
  function pressEncounter() {
    const a = encounters?.active; if (!a || director?.blocking) return false;
    if (physics.position.distanceTo(encounterTarget()) > encounterReach(a.phase)) return false;
    if (a.phase === 'offered') { encounters?.accept(); return true; }
    if (a.definition.id === 'group-photo' && (campus.progress.counters['photo.saved'] ?? 0) <= encounterPhotoBaseline) { say('一起留張合照吧！拍好後靠近按 E。'); enterPhoto(); return true; }
    if (['wind-flyer','pop-up-song'].includes(a.definition.id) && ++encounterHits < 3) { sound.cue('pop'); say(a.definition.id === 'wind-flyer' ? `接到傳單 ${encounterHits}/3，再接一張！` : `跟著拍手 ${encounterHits}/3，再按 E！`); return true; }
    const success = a.definition.success;
    if (encounters?.interact(encounterWorld())) { sound.cue('fanfare'); say(success,6000); }
    return true;
  }

  function questPoint(target: string): T.Vector3 | undefined {
    const [kind, id] = target.split(':');
    if (kind === 'npc') return npcs && !npcs.isAbsent(id) ? npcs.get(id)?.position.clone() : undefined;
    return npcs?.anchorPoint(id) ?? routes?.anchor(id);
  }
  function questWorld(): QuestWorld {
    return { distanceTo: t => { const p = questPoint(t); return p ? physics.position.distanceTo(p) : Infinity; }, timeOfDay: () => sky.preset, photoCount: campus.progress.counters['photo.saved'] ?? 0 };
  }
  function notebookModel(): JournalModel {
    const names = new Map((npcDefinitions?.npcs ?? []).map(n => [n.id, n.name]));
    return {
      notice: storageNotice,
      tasks: (quests?.list() ?? []).map(v => ({ id: v.definition.id, title: v.definition.title, subtitle: `${v.state?.status === 'completed' ? '已完成' : v.state ? '進行中' : '可接受'} · ${zoneLabels[v.definition.zone] ?? '校園'}`, text: v.definition.description + '\n\n' + (v.step?.text ?? (v.state ? '這段故事已收進手帳。' : '接受後，依照提示前往校園中的地點。')), meta: `同行人物：${names.get(v.definition.npc) ?? v.definition.npc}\n紀念：${v.definition.reward}`,
        actions: !v.state ? [{ id: 'accept', label: '接受任務' }] : v.step ? [{ id: 'track', label: '追蹤這件事' }, { id: 'go', label: '帶我前往' }, ...((v.step.when || (v.step.target.startsWith('npc:') && !questPoint(v.step.target))) ? [{id:'time',label:'切換至人物出現時段'}] : [])] : [] })),
      events: [...(quests?.progress.journal ?? [])].reverse().map(e => ({ id: e.id, title: e.title, subtitle: `${new Date(e.at).toLocaleString('zh-TW')} · ${zoneLabels[e.zone] ?? '校園'}`, text: [e.text, e.choice && `我的選擇：${e.choice}`, e.result, e.reward && `獲得紀念：${e.reward}`].filter(Boolean).join('\n\n'), meta: names.get(e.npc) })),
      people: (npcDefinitions?.npcs ?? []).filter(n => campus.progress.talked.includes(n.id)).map(n => ({ id: n.id, title: n.name, subtitle: n.role, text: `在校園裡認識了${n.name}。\n\n${(quests?.progress.journal ?? []).filter(e => e.npc === n.id).map(e => e.result ?? e.text).join('\n\n') || '還有更多故事，等下次相遇慢慢聊。'}` })),
    };
  }
  function openNotebook() {
    if (director?.blocking || photo.active || quiz?.open) return;
    if (!quests) { say('校園手帳正在準備中。'); return; }
    setMenu(false); clearAuto(); notebook?.show(notebookModel());
  }
  notebook = new JournalView(host, (id, action) => {
    const v = quests?.list().find(v => v.definition.id === id); if (!v || !quests) return;
    if (action === 'accept') { quests.accept(id, questWorld()); say(`已記下：${v.definition.title}`); }
    if (action === 'track') quests.track(id);
    if (action === 'time' && v.step) {
      const npc = npcDefinitions?.npcs.find(n => `npc:${n.id}` === v.step!.target);
      const preset = v.step.when ?? (['day','sunset','night'] as const).find(p => npc?.schedule[p]);
      if (preset && ['day','sunset','night'].includes(preset)) { sky.set(preset as Preset); get('[data-action=sky]').textContent = `${PRESET_LABEL[preset as Preset]} N`; scheduleNpcs(true); }
    }
    if (action === 'go' && v.step) { quests.track(id); notebook?.close(); followQuest(); }
    refreshNotebook();
  }, open => { input.release(); if (open) clearAuto(); });
  refreshNotebook = () => {
    notebook?.update(notebookModel());
    const v = quests?.list().find(v => v.definition.id === quests?.progress.tracked);
    pocket.hidden = !v?.step;
    if (v?.step) pocket.innerHTML = `<strong>${safe(v.definition.title)}</strong><small>${safe(v.step.text)} · J 手帳</small>`;
  };
  async function sideQuestDialogue(id: string) {
    const v = quests?.list().find(v => v.definition.id === id), ui = director?.ui;
    if (!v?.step || !quests || !ui) return;
    // Pause only the NPC this step actually targets; retain its path and story ownership.
    const targetNpc = v.step.target.startsWith('npc:') ? v.step.target.slice(4) : undefined;
    if (targetNpc) { npcs?.setTalking(targetNpc); campus.talked(targetNpc); }
    clearAuto(); ui.begin();
    try {
      await ui.say([{ who: v.definition.npc, text: v.step.text }], !!v.step.choices?.length);
      if (v.step.choices?.length) {
        const options = v.step.choices;
        const choice = await ui.choose(options.map(c => ({ text: c.label, next: c.id })));
        const c = options[choice];
        if (c) {
          if (quests.choose(id, c.id, questWorld())) await ui.say([{who:v.definition.npc,text:c.result}]);
          else say('對象已離開互動範圍，這次選擇尚未提交；請靠近後再按 E 繼續。',6000);
        }
      } else if (!quests.interact(id, questWorld())) say(v.step.kind === 'photo' ? '請在這個地點拍一張照片，再繼續。' : '請再靠近目標，或切換至指定時段。');
    } finally { if (targetNpc) npcs?.setTalking(undefined); ui.end(); refreshNotebook(); }
  }
  function pressSideQuest() {
    const v = quests?.candidate(questWorld());
    if (!v || director?.blocking) return false;
    void sideQuestDialogue(v.definition.id); return true;
  }

  // ---- story, NPCs and outdoor routes --------------------------------------------------------
  let routes: OutdoorRoutes | undefined, npcs: NpcManager | undefined, director: StoryDirector | undefined, storyStarted = false, talk: TalkDirector | undefined;
  let scheduledKey = '', album: Album | undefined, npcEvents: NonNullable<NpcData['events']> = [], eventPreset = '', lastEventCheck = 0, lastEventAt = -1e9;
  const eventsShown = new Set<string>();
  /** Re-place NPCs when the light preset or story progress changes (spec-v4 §15.1). */
  function scheduleNpcs(force = false) {
    if (!npcs || !director || !routesValidated) return;
    const p = director.engine.progress, key = `${sky.preset}|${p.done.length}|${JSON.stringify(p.npcAt)}`;
    if (!force && key === scheduledKey) return;
    scheduledKey = key;
    npcs.schedule(sky.preset as Preset, director.engine.finished, p.npcAt, physics.position);
    album?.evaluate(); // chapters count toward achievements
  }
  function startStoryWhenReady() {
    if(!director || storyStarted || !routesValidated || !(opts.story || (walking && !overview)))return;
    storyStarted=true;director.start(placeTour);scheduleNpcs(true);
  }
  /** Once both the path network and the landmark collision exist, remove path edges the real world blocks. */
  let routesValidated = false;
  function validateRoutes() {
    if (!alive || routesValidated || !routes || !landmarksReady || !propsReady || !legacyPropsReady || !bikeStandReady) return;
    const removed = validatePaths(routes, (p, q, r) => physics.sweep(p, q, r), (x, z) => terrainRef ? terrainRef.heightAt(x, z) : -1e9);
    routesValidated = true;
    console.info('outdoor paths blocked by geometry:', removed);
    startStoryWhenReady();
  }
  const planRoute = (to: T.Vector3) => !routesValidated ? [] : obstacleField.route(plan(physics.position, to, navigation, routes, sightLine((a, b, r) => physics.sweep(a, b, r))), bike.riding ? {radius:.38,halfLength:.57} : .30, sightLine((a,b,r) => physics.sweep(a,b,r)), (x,z,referenceY) => physics.supportAt(x,z,referenceY));
  /** Auto-walk to the current quest goal: indoor navmesh where it reaches, else the outdoor path network. */
  function followQuest() {
    if(!routesValidated) { say('場景碰撞與步道仍在準備，請稍候再開始帶路。');return; }
    routes?.avoid.splice(0); // stuck spots only matter within one auto-walk
    const tracked = quests?.list().find(v => v.definition.id === quests?.progress.tracked);
    const goal = tracked?.step ? questPoint(tracked.step.target) : director?.goal();
    if(tracked?.step && !goal) { say('這位人物目前不在校園；請在手帳選擇『切換至人物出現時段』後再前往。',6000);return; }
    if (!goal || director?.blocking) { say('目前沒有需要前往的地點。', 2500); return; }
    const p = planRoute(goal);
    if (!p.length) { say('找不到通往任務地點的路，請跟著金色箭頭走。', 4000); return; }
    clearAuto(); autoPath = p; pathIndex = 0; replans = 0; progressTime = performance.now(); progressPosition.copy(physics.position);
    autoDestination = { id: 'quest', label: tracked?.definition.title ?? (director!.objectiveText || '任務地點'), position: goal.toArray() as [number, number, number], buildingId: 'quest', floorId: 'quest' } as WalkDestination;
    chooseMode(false); drawRoute(p); say(`自動前往：${autoDestination.label}（任意方向鍵可中斷）`, 4000);
  }
  let recoveryFailed=false;
  function moveSafely(wanted:T.Vector3,face?:T.Vector3):boolean {
    const accept=face&&routesValidated?(candidate:T.Vector3)=>{
      const line=sightLine((a,b,r)=>physics.sweep(a,b,r));
      const raw=plan(candidate,face,navigation,routes,line);
      if(!raw.length || !line(candidate,raw[0]))return false;
      const path=candidate.distanceToSquared(raw[0])>1e-6?[candidate.clone(),...raw]:raw;
      return obstacleField.route(path,.30,line,(x,z,y)=>physics.supportAt(x,z,y)).length>0;
    }:undefined;
    const support=physics.supportAt(wanted.x,wanted.z,wanted.y);
    if(physics.safeTeleport(wanted.clone().setY(support??wanted.y),4,accept)) return true;
    const nearby=(routes?.anchorIds??[]).map(id=>routes!.anchor(id)).filter((p):p is T.Vector3=>!!p&&Math.hypot(p.x-wanted.x,p.z-wanted.z)<25&&Math.abs(p.y-wanted.y)<2).sort((a,b)=>a.distanceToSquared(wanted)-b.distanceToSquared(wanted));
    return nearby.some(point=>physics.safeTeleport(point,4,accept));
  }
  function teleportTo(p:T.Vector3,face?:T.Vector3,keepY=false):boolean {
    clearAuto();
    const reference=keepY?p.y:(physics.supportAt(p.x,p.z,p.y)??terrainRef?.heightAt(p.x,p.z)??p.y);
    if(!moveSafely(p.clone().setY(reference+.15),face)) { say('目的地附近沒有安全落點，這次移動尚未完成；請改用步道前往。',7000);return false; }
    recoveryFailed=false;bike.riding=false;
    const yaw=face?Math.atan2(-(face.x-p.x),-(face.z-p.z)):rig.yaw;
    avatar.face(yaw);rig.yaw=yaw;rig.snap(physics.position);return true;
  }
  void (async () => {
    try {
      const [graph, zones, story, npcData, collection, quizData] = await Promise.all([
        OutdoorRoutes.load(asset('data/walkthrough/outdoor-graph.json')),
        loadJson<StoryZones>('data/story-zones.json', '故事地點'),
        loadJson<StoryData>('data/chapters.json', '故事章節'),
        loadJson<NpcData>('data/npcs.json', '校園人物').catch(e => { console.warn('npcs', e); return undefined; }),
        loadJson<CollectionData>('data/collection.json', '收集資料').catch(e => { console.warn('collection', e); return undefined; }),
        loadJson<{ questions: Question[] }>('data/quiz.json', '校史題庫').catch(e => { console.warn('quiz', e); return undefined; }),
      ]);
      if (!alive) return;
      routes = graph;
      zoneLabels = Object.fromEntries(Object.entries(zones.zones).map(([id,z]) => [id,z.label]));
      validateRoutes();
      npcs = new NpcManager(zones, routes, terrainRef, asset, npcData); scene.add(npcs.group);
      void (async()=>{try {
      // Rendering and simplified collisions register together, independently of story feature loads.
      const occ = world.display.userData.occupancy as { at(x: number, z: number): number } | undefined;
      const keep = [...Object.values(zones.zones).map(z => ({ x: z.p[0], z: z.p[1], r: 2.5 })),
        ...(npcData?.npcs ?? []).flatMap(d => Object.values(d.schedule).flatMap(sc => { const q = sc ? npcs!.anchorPoint(sc.at, sc.offset) : undefined; return q ? [{ x: q.x, z: q.z, r: 1.6 }] : []; }))];
      const g = routes!;
      await addProps(world.display.getObjectByName('Campus art') ?? scene, propsForTier(planProps({
        zone: id => { const z = zones.zones[id]; return z ? { x: z.p[0], z: z.p[1], r: z.r } : undefined; },
        open: (x, z) => !occ || occ.at(x, z) !== 1,
        pathDistance: (x, z) => g.edgeDistance(x, z),
        ground: (x, z) => terrainRef ? terrainRef.heightAt(x, z) : -.055,
        seaLevel: terrainRef?.seaLevel ?? -.4, keepClear: keep,
      }), TIERS[tier].detail.props), asset, (x, z) => terrainRef ? terrainRef.heightAt(x, z) : -.055, () => alive).then(group => { if (!alive) return; const specs = (group.userData.obstacles ?? []) as Obstacle[]; physics.addObstacles(specs); obstacleField.add(specs); growable?.setVolumes('campus-props', vegetationBoxes(specs)); featureStatus.props='ready'; });
      } catch(e) { featureStatus.props='degraded'; console.warn('props',e); }
      finally { propsReady=true;validateRoutes(); } })();
      npcEvents = npcData?.events ?? []; npcDefinitions = npcData;
      npcs.setCollision((id,a,b,r,h) => physics.sweepActor(id,a,b,r,h), (x,z,y) => physics.supportAt(x,z,y));
      npcs.cap = NPC_CAP[tier];
      await npcs.load();
      if (!alive) return;
      director = new StoryDirector({
        host, scene, camera, player: () => physics.position, destinations: world.destinations,
        navPath: (_a, b) => planRoute(b), routeSurface, routes, npcs, zones,
        timeOfDay: () => sky.preset, setSky: p => { if (p === 'day' || p === 'sunset' || p === 'night') { sky.set(p); get('[data-action=sky]').textContent = `${PRESET_LABEL[p]} N`; } },
        cue: id => sound.cue(id), say, teleport: teleportTo,
      }, story);
      director.ui.onObjectiveClick(followQuest);
      director.ui.player = () => {
        const l = look(), pal = PALETTES[l.body][l.palette].look;
        return { name: l.nickname || '新生', portrait: { hair: pal.hair, hairStyle: l.body === 'f' ? 'ponytail' : 'messy', top: pal.top, topStyle: l.body === 'f' ? 'hoodie' : 'tee', accessory: l.body === 'f' ? 'hairclip' : undefined } };
      };
      if (npcData && collection) {
        const n = npcs;
        talk = new TalkDirector(npcData, collection, director.ui, campus, director.engine, {
          nearest: (p, r) => n.nearest(p, r), position: id => n.get(id)?.position, setTalking: id => n.setTalking(id),
          timeOfDay: () => sky.preset, cue: id => sound.cue(id), toast: t => director!.ui.toast('item', t),
          play: async game => {
            const won = await (game === 'history-quiz' ? playQuiz(quizData?.questions ?? []) : game === 'monkey-chase' ? playChase() : playSunset());
            campus.game(game, won ? 1 : 0, won); album?.evaluate();
            return won;
          },
        });
      }
      if (collection) {
        const ui = director.ui, eng = director.engine, n = npcs;
        album = new Album(collection, npcData, campus, {
          place: at => n.anchorPoint(at), chaptersDone: () => eng.progress.done.length,
          toast: (k, t, sub) => ui.toast(k, t, sub), cue: id => sound.cue(id),
          storiesFound: () => campusUi?.storyProgress ?? { found: 0, total: 8 },
        });
        album.evaluate();
        renderAlbum = () => { get('[data-pane=album]').innerHTML = album!.html(); };
      }
      scheduleNpcs(true);
      const questReady = (async()=>{
        try {
          const questData = await loadJson<QuestData>('data/quests.json','支線任務').catch(e=>{ featureStatus.quests='degraded';console.warn('quests',e); return bundledQuests as QuestData; });
          if(!alive)return;
          quests=new QuestEngine(questData,{onChange:()=>refreshNotebook(),onStorageError:()=>{storageNotice='目前無法保存進度；請勿關閉此頁，並檢查瀏覽器儲存空間。';say(storageNotice,9000);}});
          quests.importLegacy(director!.engine.progress.done,campus.progress.talked);
          if(featureStatus.quests!=='degraded')featureStatus.quests='ready';refreshNotebook();
        } catch(e) { featureStatus.quests='failed'; console.warn('quests',e);say('手帳暫時無法載入；主線與自由探索仍可使用。'); }
      })();
      void (async()=>{
        try {
          const data=await loadJson<EncounterData>('data/encounters.json','校園偶遇');
          await questReady;if(!alive)return;
          if(!quests) { featureStatus.encounters='unavailable';return; }
          encounters=new EncounterEngine(data,{record:e=>quests?.record(e),onChange:()=>{syncEncounter();refreshNotebook();}});featureStatus.encounters='ready';
        } catch(e) { featureStatus.encounters='degraded';console.warn('encounters',e);say('偶遇活動暫時未開放；主線與支線仍可繼續。'); }
      })();
      // The tour begins when the player starts walking (or straight away from the map's 'start the tour').
      // A fresh tour starts at the school gate beside 阿灣 (not 475 m away at the arcade); arrivals from the
      // map's "take me there" keep their place.
      startStoryWhenReady();
    } catch (e) { if (!alive) return; console.warn('story', e); say('故事模式暫時無法載入；仍可自由探索。', 4000); }
  })();

  // ---- mini-games (spec-v4 §9.3–9.5) --------------------------------------------------------
  let quiz: Quiz | undefined;
  function playQuiz(bank: Question[]) {
    if (!bank.length) return Promise.resolve(false);
    quiz ??= new Quiz(host, bank, id => sound.cue(id));
    return quiz.play();
  }
  const chase = new Chase({
    monkey: () => npcs?.get('m3-thief'),
    flee: (from, away) => {
      const dir = new T.Vector3(from.x - away.x, 0, from.z - away.z).normalize(), goal = from.clone().addScaledVector(dir, 26);
      goal.y = terrainRef ? terrainRef.heightAt(goal.x, goal.z) : -.055;
      const p = routes?.path(from, goal) ?? [];
      return p.length ? p.slice(1) : [goal];
    },
    say, cue: id => sound.cue(id), timer: t => director?.ui.timer(t, () => { chase.cancel(); say('放棄追逐。', 2500); }),
  });
  function playChase() { return chase.play(); }
  function playSunset() {
    return new Promise<boolean>(resolve => {
      let done = false;
      const finish = (win: boolean) => { if (done) return; done = true; photo.onShot = undefined; photo.onExit = undefined; resolve(win); };
      if (sky.preset !== 'sunset') { sky.set('sunset'); get('[data-action=sky]').textContent = `${PRESET_LABEL.sunset} N`; }
      const sea = npcs?.anchorPoint('seawall');
      photo.onShot = cam => {
        const at = !!sea && Math.hypot(physics.position.x - sea.x, physics.position.z - sea.z) < 34;
        const r = judgeSunset(cam, sky.sunDir, sky.preset, at, (from, dir) => new T.Raycaster(from, dir, .5, 400).intersectObject(world.collision, true).length > 0);
        if (r.ok) window.setTimeout(() => { finish(true); photo.exit(); }, 900);
        return r.msg;
      };
      photo.onExit = () => finish(false);
      setMenu(false); clearAuto(); photo.enter(physics.position, rig.yaw, '拍下西子灣夕陽：讓太陽落在畫面中間');
    });
  }

  // ---- frame loop ------------------------------------------------------------------------
  const direction = new T.Vector3(), previous = new T.Vector3();
  let lastTime = performance.now(), frameId = 0, lastUi = 0, lastShadowOverview: boolean | undefined, jumped = false;
  function steer(time: number) {
    input.direction(rig.forward, direction);
    if (autoPath.length && pathIndex < autoPath.length) {
      const step = followRoute(autoPath, pathIndex, physics.position, direction);
      pathIndex = step.index;
      if (step.arrived) {
        const label = autoDestination?.label, indoor = !['quest', 'outdoor'].includes(autoDestination?.floorId ?? ''); clearAuto(); direction.set(0, 0, 0);
        say(indoor ? `已抵達 ${label ?? '目的地'} 門口，按 E 開門後可走入。` : `已抵達：${label ?? '目的地'}`, 6000);
      }
      if (autoPath.length && time - progressTime > 3500) {
        if (physics.position.distanceTo(progressPosition) < .4) {
          // Stuck: route around this spot and try again (a few times) before handing control back.
          const goal = autoPath[autoPath.length - 1]?.clone(), dest = autoDestination;
          if (goal && dest && routes && replans < 3) {
            // Mark the blockage ahead (where the walker was heading), not the spot it stands on.
            replans++; routes.avoid.push(physics.position.clone().addScaledVector(direction.lengthSq() > 1e-6 ? direction.clone().normalize() : new T.Vector3(), 2.5));
            const p = planRoute(goal);
            if (p.length) { autoPath = p; pathIndex = 0; drawRoute(p); say('前方不通，改走另一條路。', 2500); }
            else { clearAuto(); say('人物暫時無法前進，已停止帶路；可手動調整位置後再試。'); }
          } else { clearAuto(); say('人物暫時無法前進，已停止帶路；可手動調整位置後再試。'); }
        }
        progressTime = time; progressPosition.copy(physics.position);
      }
      // Auto-walk opens doors it is about to pass through, as a person would.
      for (const d of world.doors) if (d.target === 0 && d.position.distanceToSquared(physics.position) < 13 && wouldEnterDoor(d, physics.position, direction, 1 / 30, WALK_SPEED)) d.target = 1;
    }
  }
  function animate(time: number) {
    if (!alive) return;
    frameId = requestAnimationFrame(animate);
    const rawDt = time - lastTime, dt = Math.min(rawDt / 1000, maxFrame); lastTime = time;
    renderer.info.reset();
    previous.copy(physics.position); direction.set(0, 0, 0); jumped = false;
    input.mode = director?.ui.dialogueOpen ? 'dialogue' : notebook?.open || menuOpen() || quiz?.open ? 'menu' : photo.active ? 'photo' : 'walk';
    scheduleNpcs();
    const pausedEvents = !walking || overview || !!notebook?.open || menuOpen() || !!director?.blocking || photo.active || !!quiz?.open || chase.active || autoPath.length > 0;
    encounters?.update(dt, encounterWorld(), pausedEvents);
    animateEncounter(dt, time, pausedEvents);
    if (!notebook?.open && !menuOpen() && !director?.blocking) quests?.update(questWorld());
    if (walking && !overview && !recoveryFailed) {
      if (photo.active || notebook?.open || menuOpen()) direction.set(0, 0, 0); else steer(time);
      // Dialogue and chapter cards hold the player; Space advances like E.
      if (director?.blocking) { direction.set(0, 0, 0); if (input.takeJump()) director.press(); }
      const jump = input.takeJump() && !bike.riding; if (jump) clearAuto(true);
      const wasGround = physics.onGround;
      bike.update(physics.position);
      if (bike.riding && !avatar.rideReady) { bike.riding = false; say('腳踏車與人物姿勢仍在準備，請稍候。', 2500); }
      if (!physics.setRiding(bike.riding, avatar.heading)) { bike.riding = false; physics.setRiding(false,avatar.heading); say('前方空間不足，請下車步行。',2500); }
      avatar.riding = bike.riding;
      physics.step(direction, dt, jump, bike.riding ? RIDE_SPEED : input.running && !autoPath.length ? RUN_SPEED : WALK_SPEED);
      jumped = jump && wasGround && !physics.onGround;
      if (pendingDestination && physics.onGround) { const d = pendingDestination; pendingDestination = undefined; goTo(d); }
      if (physics.position.y < -20) { clearAuto();if(physics.recoverSafe() || moveSafely(world.spawn)) {rig.snap(physics.position);say('已回到最近的安全位置。');}else{recoveryFailed=true;setMenu(true,'play');say('目前找不到安全落點，已暫停移動；請使用回到起點或返回校園地圖。',0);} }
    }
    const speed = Math.hypot(physics.position.x - previous.x, physics.position.z - previous.z) / Math.max(dt, 1e-3);
    const surfaceHeight = physics.supportAt(physics.position.x, physics.position.z, physics.position.y);
    avatar.update(dt, { foot: physics.position, onGround: physics.onGround, airborneFor: physics.airborneFor, speed, intendedSpeed: physics.intendedSpeed, heading: direction, jumped, runSpeed: RUN_SPEED, surfaceHeight, supportAt: routeSurface.support });
    if (bike.riding && !avatar.riding) { bike.riding = false; physics.setRiding(false, avatar.heading); say('前後輪無法同時貼住路面，已下車步行。', 2500); }
    animateDoors(world.doors, physics.position, dt);
    physics.setCameraObstacles(doorCameraObstacles(world.doors,physics.position));
    if(routesValidated)npcs?.update(dt, physics.position);
    physics.setActors([...(npcs?.bodies(physics.position) ?? []),...encounterScene.bodies()]);
    tufts?.update(physics.position);
    chase.update(dt, physics.position);
    if (!overview && walking) album?.update(time, physics.position);
    // Time-of-day campus events (npc-cast-v4 §5): a banner once per time of day when the player comes near.
    if (npcEvents.length && npcs && director && time - lastEventCheck > 1000) {
      lastEventCheck = time;
      if (eventPreset !== sky.preset) { eventPreset = sky.preset; eventsShown.clear(); }
      for (const ev of npcEvents) {
        if (photo.active || notebook?.open || menuOpen() || encounters?.active || ev.when !== sky.preset || eventsShown.has(ev.id) || director.blocking || time - lastEventAt < 8000) continue;
        if (ev.npcs.some(id => !npcs!.isAbsent(id) && (npcs!.get(id)?.position.distanceTo(physics.position) ?? 1e9) < 25)) { eventsShown.add(ev.id); lastEventAt = time; director.ui.banner(ev.banner, '校園事件'); sound.cue('chime'); break; }
      }
    }
    if (!overview && storyStarted && !photo.active && !notebook?.open && !menuOpen()) director?.update(time, dt);
    // This is exactly the candidate that E and the touch button will execute.
    if (director) {
      const candidates=interactionCandidates(), chosen=selectInteraction(candidates,selectedInteraction);
      if(chosen && !director.blocking) {
        const projected=chosen.point.clone();projected.y+=2;projected.project(camera);
        director.ui.hint(projected.z<1?{x:(projected.x+1)/2*innerWidth,y:(1-projected.y)/2*innerHeight,text:`E ${chosen.label}${candidates.length>1?' · R 切換':''}`}:null);
      } else director.ui.hint(null);
      get('[data-action=door]').textContent=chosen?`${chosen.label} E`:'互動 E';
      const switchButton=get('[data-action=cycle-target]');switchButton.hidden=candidates.length<2;
    }
    if (sound.enabled) {
      if (time - lastSea > 1000) { lastSea = time; seaMix = seaProximity(physics.position); }
      const indoors = physics.position.y > 1.5 || placeIndoors;
      sound.ambience(seaMix, sky.preset === 'night' ? 0 : sky.preset === 'sunset' ? .4 : 1, indoors);
      if (walking && !overview && physics.onGround) sound.footsteps(speed, dt, indoors ? 'hard' : 'soft');
    }
    if (photo.active) { photo.update(dt, input.keys); avatar.setOpacity(1); }
    else if (!overview) {
      rig.update(dt, { foot: avatar.root.position, running: input.running, moving: speed > .25, followHeading: autoPath.length ? avatar.heading : undefined });
      avatar.setOpacity(rig.firstPerson ? 0 : rig.avatarOpacity);
    } else { avatar.setOpacity(1); orbit.update(); }
    if (time - lastUi > 140) { lastUi = time; updateUi(); }
    if (lastShadowOverview !== overview) {
      lastShadowOverview = overview;
      // Bird's-eye shadows cover 240 m: trees stop casting there (triangle budget), and cast again when walking.
      world.display.getObjectByName('Campus trees (foliage)')?.traverse(o => { if (o instanceof T.InstancedMesh) o.castShadow = !overview; });
      const extent = overview ? 240 : tier === 'A' ? 70 : 42, cam = sun.shadow.camera;
      cam.left = -extent; cam.right = extent; cam.top = extent; cam.bottom = -extent; cam.far = 900; cam.updateProjectionMatrix();
      sky.shadowTexel = 2 * extent / sun.shadow.mapSize.x;
    }
    sky.update(dt, overview ? orbit.target : physics.position, overview);
    if (sound.enabled) { sound.setMood(sky.preset); sound.duck(!!director?.ui.dialogueOpen); }
    fill.position.set(physics.position.x, physics.position.y + 2.6, physics.position.z);
    fill.intensity += ((sky.preset === 'night' ? 6 : sky.preset === 'sunset' ? 1.2 : 0) - fill.intensity) * Math.min(1, dt * 2);
    animateCampus(world, time);
    campusUi?.update(camera, overview, physics.position, time);
    post.look = lerpLook(POST_LOOKS[sky.fromPreset], POST_LOOKS[sky.preset], sky.progress);
    if (TIERS[tier].post) post.render(scene, camera);
    else { renderer.toneMappingExposure = post.look.exposure; renderer.setRenderTarget(null); renderer.render(scene, camera); }
    photo.afterRender();
    quality.frame(rawDt, time);
  }

  applyTier(tier);
  host.classList.add('is-overview'); orbit.enabled = true;
  camera.position.set(-560, 260, 330); orbit.target.set(-40, 0, 20); orbit.update();
  get('[data-action=walk]').classList.remove('is-active'); get('[data-action=overview]').classList.add('is-active');
  frameId = requestAnimationFrame(animate);
  // Arrivals from the campus map.
  if (opts.target) {
    const d = world.destinations.find(d => d.id === `${opts.target}-1F-entrance`);
    chooseMode(false);
    // One waiter until navigation / routes are ready; runs once at entry, never per frame.
    const wait = () => { if (!alive) return; if (routesValidated && (d ? navigation : routes)) { if (d) goTo(d); else walkOutdoor(opts.target!); } else window.setTimeout(wait, 300); };
    wait();
  } else if (opts.overview) chooseMode(true);
  else if (opts.story) chooseMode(false);

  // Read-only acceptance hooks: observations and real input paths, never hidden teleport navigation.
  (window as unknown as { campusWalk: unknown }).campusWalk = {
    get position() { return physics.position.toArray(); },
    get mode() { return { overview, firstPerson: rig.firstPerson, walking, running: input.running, locked: rig.locked, tier }; },
    get heading() { return rig.yaw; },
    get onGround() { return physics.onGround; },
    get animState() { return avatar.state; },
    get avatarY() { return avatar.root.position.y; },
    get grass() { return QA ? tufts?.diagnostics : undefined; },
    get rideContact() { return QA ? avatar.rideDiagnostics : undefined; },
    get footContact() { return QA ? avatar.footDiagnostics : undefined; },
    surfaceAt: (x: number, z: number, referenceY: number) => QA ? { soil: terrainRef?.surfaceAt(x, z), support: physics.supportAt(x, z, referenceY), surfaceVersion: terrainRef?.surfaceVersion } : undefined,
    get routeSurfaces() { return QA ? { story: director?.routeDiagnostics, automatic: routeLine.children.filter((o): o is T.Line => o instanceof T.Line).map(line => Array.from(line.geometry.attributes.position.array)) } : undefined; },
    get camera() { return { position: camera.position.toArray(), arm: rig.arm, distance: rig.distance, yaw: rig.yaw, pitch: rig.pitch, locked: rig.locked }; },
    get physicsStats() { return physics.stats; },
    probe: (dx: number, dz: number) => physics.probe(dx, dz),
    /** Diagnostics only, and only with ?qa=1: place the player (never used by acceptance runs). */
    qaPlace: (x: number, z: number, y?: number) => QA ? teleportTo(new T.Vector3(x, y ?? 0, z), undefined, y !== undefined) : false,
    plan() { const g = director?.goal(); const nav = g && navigation ? navigation.findPath(physics.position, g).length : -1; const out = g && routes ? routes.path(physics.position, g).length : -1; return { goal: g?.toArray(), plan: g ? planRoute(g).length : -1, nav, outdoor: out, nearest: routes ? routes.nearest(physics.position) : -1 }; },
    get steering() { return { direction: direction.toArray(), intended: physics.intendedSpeed, pathIndex, target: autoPath[pathIndex]?.toArray(), onGround: physics.onGround, blocking: director?.blocking ?? false }; },
    get story() { return director ? { active: director.engine.active?.id, done: director.engine.progress.done, flags: director.engine.progress.flags, dialogue: director.ui.dialogueOpen, blocking: director.blocking } : undefined; },
    get npcs() { return npcs ? npcs.ids().map(id => ({ id, position: npcs!.get(id)?.position.toArray(), absent: npcs!.isAbsent(id), visible: npcs!.get(id)?.root.visible, target: npcs!.targets.get(id)?.toArray() })) : []; },
    get talk() { return talk ? { busy: talk.talking, mode: input.mode, choices: [...host.querySelectorAll('.q-choices:not([hidden]) button')].map(b => b.textContent), line: host.querySelector('.q-dialog:not([hidden]) .text')?.textContent ?? null, name: host.querySelector('.q-dialog:not([hidden]) .name')?.textContent ?? null } : undefined; },
    get campus() { return campus.progress; },
    get encounterClock() { return encounters?.diagnostics; },
    get encounter() { const a = encounters?.active; return a ? { id:a.definition.id,phase:a.phase,remaining:a.remaining,target:encounterTarget().toArray(),hits:encounterHits } : undefined; },
    qaEncounter: (id:string,failScene=false) => { if(!QA)return false;failEncounterScene=failScene;return encounters?.offer(id); },
    get journal() { return quests?.progress; },
    get interaction() { const c=selectedCandidate();return {selected:c?.id,label:c?.label,candidates:interactionCandidates().map(x=>({id:x.id,label:x.label,distance:x.distance}))}; },
    get questList() { return quests?.list(); },
    /** QA only: hide scene groups by name prefix to measure their draw cost. */
    qaHide: (prefix: string, hidden = true) => { if (!QA) return 0; let n = 0; scene.traverse(o => { if (o.name.startsWith(prefix)) { o.visible = !hidden; n++; } }); return n; },
    get photo() { return { active: photo.active, yaw: photo.yaw, pitch: photo.pitch, goal: host.querySelector('.photo-goal:not([hidden])')?.textContent ?? null, sun: sky.sunDir.toArray() }; },
    get game() { return { quiz: quiz?.open ?? false, chase: chase.active, timer: host.querySelector('.q-timer:not([hidden])')?.textContent ?? null, monkey: npcs?.get('m3-thief')?.position.toArray() }; },
    get sound() { return { enabled: sound.enabled, state: sound.state, music: sound.musicPlaying }; },
    get destinations() { return world.destinations; },
    get doors() { return world.doors.map(d => ({ id: d.id, label: d.label, position: d.position.toArray(), open: d.open })); },
    goTo: (code: string) => { const d = world.destinations.find(d => d.label === code); if (d) goTo(d); },
    get route() { return autoPath.map(p => p.toArray()); },
    get chapterCard() { return !!host.querySelector('.q-chapter'); },
    get navReady() { return !!navigation && routesValidated; },
    get worldReady() { return routesValidated; },
    get featureStatus() { return {...featureStatus}; },
    get readiness() { return {...featureStatus,worldReady:routesValidated,routesValidated,propsReady,legacyPropsReady,bikeStandReady,landmarksReady,vegetationReady:growable?.ready ?? false,rideReady:avatar.rideReady}; },
    get renderStats() { return { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, geometries: renderer.info.memory.geometries }; },
    /** Visible drawables grouped by their nearest named ancestor, for draw-call budgeting. */
    drawBreakdown() {
      const groups = new Map<string, { draws: number; tris: number }>();
      scene.traverseVisible(o => {
        if (!(o instanceof T.Mesh || o instanceof T.Line || o instanceof T.Points)) return;
        let key = '', p: T.Object3D | null = o;
        while (p && !key) { key = p.name; p = p.parent; }
        const g = groups.get(key || '(unnamed)') ?? { draws: 0, tris: 0 };
        const mats = Array.isArray(o.material) ? o.material.length : 1, idx = o.geometry.index?.count ?? o.geometry.attributes.position?.count ?? 0;
        g.draws += mats; g.tris += Math.round(idx / 3) * ((o as T.InstancedMesh).count ?? 1);
        groups.set(key || '(unnamed)', g);
      });
      return [...groups].sort((a, b) => b[1].draws - a[1].draws).slice(0, 40);
    },
  };
}
