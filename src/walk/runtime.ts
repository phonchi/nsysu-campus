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
import { shoreConstraint } from './shore-constraint';
import { CameraRig } from './camera-rig';
import { Avatar } from './avatar';
import { surfaceRouteSegments } from './surface-route';
import { WalkInput } from './input';
import { CampusEventEngine, type CampusEventWorld } from '../story/campus-events';
import { EventCommandQueue, EventCompletionStorage, EventPlayerPose, activityPresentation, campusActivityGuide, eventSeatHeading, submitRhythmResult, routeEventE, connectNpcPathStart, type RhythmCommand, type RuntimeEventWorld, campusEventAction, campusEventWorld, campusEventsPaused } from './interaction-events';
import type { RhythmPerformance } from '../audio/rhythm-performance';
import { npcQuestStatuses } from './interaction-status';
import { doorSignPose, buildDoorSignWalls } from './door-sign';
import { selectInteraction, cycleInteraction, encounterReach, orderInteractions, numberedInteractions, revalidateInteraction, interactionPriority, type InteractionAction } from './interaction-choice';
import { liftWins, toggleDoorById, nearestDoor, continueQuestAtTarget, npcPresentAt, type LiftStopRef } from './interaction';
import { hudTemplate, drawFloorMinimap, makeDoorSign, safe } from './hud';
import { ContextTips, FirstRunGuide, helpShortcut, type TipId } from './help';
import { startLoadingTips } from './loading-tips';
import { showInAppBrowserNotice } from './in-app-browser';
import { lockedSaves } from '../story/save-guard';
import { toonify, toonMaterial } from '../render/toon';
import { PostPipeline, POST_LOOKS, lerpLook } from '../render/post';
import { AdaptiveQuality, TIERS, initialTier, type Tier } from '../render/quality';
import { addOutlines, OUTLINE_UNIFORMS } from '../render/outline';
import { mergeStatic } from '../render/batch';
import { CampusSound } from '../audio/sound';
import { CampusMinimap, fitCampusFrame, pickMarker, type MapMarker, type MapMarkerKind } from './minimap';
import { Terrain } from '../world/terrain';
import { GrowableSurfaceField, campusVegetationVolumes } from '../world/growable-surface';
import { gateBarrierObstacles } from '../world/gate-barriers';
import { loadPlacements, landmarkCarves, landmarkTransforms, loadLandmarks, REPLACES } from '../world/landmarks';
import { OutdoorRoutes } from './route';
import { fullTunnelProfile, tunnelBores } from '../world/tunnel-surface';
import { Campus, clearCampus, type Body } from '../story/collection';
import { clearProgress } from '../story/engine';
import { GrassTufts, type GroundMask } from '../render/ground';
import { buildClouds } from '../render/clouds';
import { Album } from '../story/album';
import { planProps, addProps, propsForTier, loadPropGeometry } from '../world/props';
import { QuestSpotField, activeSpotIds } from '../world/quest-spots';
import { PhotoMode } from '../games/photo';
import { Bike, RIDE_SPEED } from './bike';
import { Quiz, Chase, judgeSunset, type Question } from '../games/minigames';
import { TalkDirector, type NpcData, type CollectionData } from '../story/talk';
import { PALETTES, modelFor, recolor } from './player-look';
import { planRoute as plan, followRoute, validateRoutes as validatePaths, sightLine } from './autopilot';
import { NpcManager, disposeObject, NPC_CAP, type CharacterWarmupSamples, type StoryZones, type Preset } from '../world/npc';
import { StoryDirector, type GuideOverride } from '../story/director';
import { trackedTarget } from '../story/guide-goal';
import { nextFocus, storyPriority, destinationDistance, findDestination, floorLabel, walkResumes } from '../story/focus';
import type { StoryData } from '../story/schema';
import bundledQuests from '../../public/data/quests.json';
import type { Facts } from '../story/dialogue';
import { nearbyQuestOffers, questGrants, questAvailability, questOfferLabel, questWaitReason, nextQuestRecommendation, syncQuestWorks, type QuestPresentationEngine } from './interaction-quests';
import { QuestEngine, QUEST_KEY, type QuestData, type QuestDefinition, type QuestStep, type QuestWorld } from '../story/quests';
import { EncounterEngine, type EncounterData } from '../story/encounters';
import { EncounterScene } from '../world/encounter-scene';
import { ObstacleField, doorCameraObstacles, type ActorBody, type Obstacle } from './obstacles';
import { JournalView, type JournalModel } from '../story/journal';
import { campusClues } from '../story/clues';
import '../walkthrough.css';

const WALK_SPEED = 3.6, RUN_SPEED = 7.2;
/** An auto-walk to a person stops this far from them, inside every talk radius (the tightest is 2.5 m). */
const NPC_ARRIVE = 1.8, ARRIVAL_OFFSET = .32;
/** Frame time cap. `?qa=1` lets slow software-rendered test browsers keep real-time simulation (physics still
 * sub-steps at 1/120 s, so movement and collisions are identical, only fewer frames are drawn). */
const QA = new URLSearchParams(typeof location==='undefined'?'':location.search).get('qa') === '1';
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

export function configureShaderChecks(renderer:{debug:Pick<T.WebGLRenderer['debug'],'checkShaderErrors'>},dev=import.meta.env.DEV) {
  renderer.debug.checkShaderErrors=dev;
}

/** Some scene jobs (story -> props) enqueue more work after awaiting their own data. */
export async function waitForSceneAssets(jobs:Promise<unknown>[]) {
  for(let taken=0;taken<jobs.length;) {
    const end=jobs.length;await Promise.allSettled(jobs.slice(taken,end));taken=end;
  }
}

type WarmupRenderer=Pick<T.WebGLRenderer,'compile'|'render'|'getRenderTarget'|'setRenderTarget'|'getActiveCubeFace'|'getActiveMipmapLevel'|'getViewport'|'setViewport'|'getScissor'|'setScissor'|'getScissorTest'|'setScissorTest'|'shadowMap'> & {
  compileAsync?:(scene:T.Object3D,camera:T.Camera)=>Promise<unknown>;
  info?:Pick<T.WebGLRenderer['info'],'programs'>;
};
export interface ShaderWarmupTiming {compileMs:number;firstUseMs:number;renderPasses:number}
/** Run only while normal rendering is stopped. Keep hidden material samples alive afterwards:
 * disposing their last material reference would evict the very programs we just warmed. */
export async function warmupWalkScene(renderer:WarmupRenderer,scene:T.Scene,camera:T.Camera,postprocessed=true) {
  const target=new T.WebGLRenderTarget(1,1),oldTarget=renderer.getRenderTarget();
  const face=renderer.getActiveCubeFace(),mip=renderer.getActiveMipmapLevel();
  const viewport=renderer.getViewport(new T.Vector4()),scissor=renderer.getScissor(new T.Vector4()),scissorTest=renderer.getScissorTest();
  const restore:(()=>void)[]=[];
  const materials=new Set<T.Material>();
  const timing:ShaderWarmupTiming={compileMs:0,firstUseMs:0,renderPasses:0};
  const shadowAuto=renderer.shadowMap.autoUpdate,shadowNeeds=renderer.shadowMap.needsUpdate;
  try {
    scene.traverse(object=>{
      const visible=object.visible,culled=object.frustumCulled;
      restore.push(()=>{object.visible=visible;object.frustumCulled=culled;});
      object.visible=true;object.frustumCulled=false;
      if(object instanceof T.LOD){const auto=object.autoUpdate;restore.push(()=>{object.autoUpdate=auto;});object.autoUpdate=false;}
      if(object instanceof T.Mesh || object instanceof T.Line || object instanceof T.Points){
        for(const material of [object.material].flat())if(!materials.has(material)){
          materials.add(material);const visible=material.visible;restore.push(()=>{material.visible=visible;});material.visible=true;
        }
      }
      if((object instanceof T.DirectionalLight || object instanceof T.SpotLight || object instanceof T.PointLight) && object.castShadow){
        const shadow=object.shadow,size=shadow.mapSize.clone(),map=shadow.map,mapPass=shadow.mapPass,auto=shadow.autoUpdate,needs=shadow.needsUpdate;
        restore.push(()=>{shadow.map?.dispose();shadow.mapPass?.dispose();shadow.map=map;shadow.mapPass=mapPass;shadow.mapSize.copy(size);shadow.autoUpdate=auto;shadow.needsUpdate=needs||!map;});
        shadow.map=null;shadow.mapPass=null;shadow.mapSize.set(1,1);shadow.autoUpdate=true;shadow.needsUpdate=true;
      }
    });
    renderer.shadowMap.autoUpdate=true;renderer.shadowMap.needsUpdate=true;
    renderer.setRenderTarget(target);renderer.setScissorTest(false);
    const compile=async()=>{
      const at=performance.now();
      if(typeof renderer.compileAsync==='function')await renderer.compileAsync(scene,camera);else renderer.compile(scene,camera);
      timing.compileMs+=performance.now()-at;
    };
    const firstUse=()=>{
      const at=performance.now();renderer.render(scene,camera);timing.renderPasses++;
      // Zero-count/empty drawables can be compiled without reaching renderBufferDirect. Initialize
      // reflection for their cached programs too; r186 lazily queries uniforms/attributes here.
      for(const program of renderer.info?.programs??[]){program.getUniforms();program.getAttributes();}
      timing.firstUseMs+=performance.now()-at;
    };
    // Use the full scene: preserve every material group, draw range and instance count.
    // Linear offscreen output matches PostPipeline; rendering also initializes shadow programs.
    await compile();firstUse();
    if(!postprocessed){
      // Direct-screen shaders have different output defines. Compiling alone leaves their uniform
      // reflection lazy; draw them into one covered canvas pixel as well, never the full viewport.
      renderer.setRenderTarget(null);renderer.setViewport(new T.Vector4(0,0,1,1));renderer.setScissor(new T.Vector4(0,0,1,1));renderer.setScissorTest(true);
      renderer.shadowMap.autoUpdate=false;renderer.shadowMap.needsUpdate=false;
      await compile();firstUse();
    }
    return timing;
  } finally {
    for(const undo of restore.reverse())undo();
    renderer.shadowMap.autoUpdate=shadowAuto;renderer.shadowMap.needsUpdate=shadowNeeds;
    renderer.setRenderTarget(oldTarget,face,mip);renderer.setViewport(viewport);renderer.setScissor(scissor);renderer.setScissorTest(scissorTest);
    target.dispose();
  }
}

/** Same constructors/flags as the deferred drawables. Badges and edge arrows are DOM, not shaders. */
function warmupSamples() {
  const group=new T.Group();group.name='Shader warmup samples';group.visible=false;
  group.add(makeDoorSign('SC2001 普通教室'));
  const plain=new T.Mesh(new T.BoxGeometry(.1,.1,.1),new T.MeshToonMaterial());plain.castShadow=true;group.add(plain);
  const colored=new T.BoxGeometry(.1,.1,.1);colored.setAttribute('color',new T.Float32BufferAttribute(new Float32Array(colored.attributes.position.count*3).fill(1),3));
  const spot=new T.Mesh(colored,toonMaterial({vertexColors:true,name:'quest-spots'}));spot.castShadow=spot.receiveShadow=true;group.add(spot);
  for(const transparent of [false,true])group.add(new T.Line(new T.BufferGeometry().setFromPoints([new T.Vector3(),new T.Vector3(1,0,0)]),new T.LineBasicMaterial({transparent,opacity:transparent?.85:1,depthWrite:false})));
  return group;
}

export async function openWalkthrough(opts: WalkOptions = {}) {
  if (document.querySelector('.walkthrough')) return;
  const host = document.createElement('section');
  host.className = 'walkthrough'; host.setAttribute('aria-label', '中山校園可步行3D導覽');
  host.innerHTML = hudTemplate(asset, base);
  document.body.append(host); document.body.style.overflow = 'hidden';
  const get = <E extends HTMLElement>(s: string) => host.querySelector<E>(s)!;
  /** Writing the same text still dirties layout; the HUD refreshes many times a second. */
  const setText = (el: HTMLElement, text: string) => { if (el.textContent !== text) el.textContent = text; };
  showInAppBrowserNotice(host);
  const stopLoadingTips = startLoadingTips(get('.walk-loading'), async () => ({
    chapters: await loadJson<{ dialogues: Record<string, { text: string }[]> }>('data/chapters.json', '故事資料').catch(() => undefined),
    campus: await loadJson<{ stories: { text: string; sources?: unknown[] }[] }>('data/campus-info.json', '校園資訊').catch(() => undefined),
  }));
  const status = get('.walk-status'); let statusTimer = 0;
  let encounters: EncounterEngine | undefined;
  let zoneLabels: Record<string,string> = {};
  let spotField: QuestSpotField | undefined;
  let rhythm:RhythmPerformance|undefined,rhythmOwner:string|undefined,movementRequested=false,playerMoved=false;
  let campusEvents: CampusEventEngine | undefined, eventStorage: EventCompletionStorage | undefined, eventCommitted: ReturnType<CampusEventEngine['snapshot']> | undefined, miniGameActive=false;
  let quests: (QuestEngine & QuestPresentationEngine) | undefined, notebook: JournalView | undefined, npcDefinitions: NpcData | undefined, storageNotice = '';
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
  configureShaderChecks(renderer);
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

  let world: WalkWorld, physics: RapierController, lod: CampusLod, alive = true,sceneLoading=true;
  const startupJobs:Promise<unknown>[]=[];
  let shaderWarmupMs=0;
  let shaderWarmupStages:ShaderWarmupTiming|undefined,shaderWarmupPostMs=0;
  let characterWarmup:CharacterWarmupSamples|undefined,characterWarmupPrepareMs=0;
  const buildingHulls: T.Mesh[] = [];
  const obstacleField = new ObstacleField(); let propsReady = false, legacyPropsReady = false, bikeStandReady = false;
  const featureStatus: Record<string,string> = { props:'loading', legacyProps:'loading', quests:'loading', encounters:'loading', landmarks:'loading', bike:'loading',warmup:'loading' };
  let failEncounterScene = false;
  let terrainRef: Terrain | undefined, replacedOsm = new Set<string>(), landmarksReady = false;
  let campusData: WalkBuilding[] = [], structure: CampusStructure, uiStructure: CampusStructure, campusInfo: CampusInfo | undefined;
  let uiPlacements: Awaited<ReturnType<typeof loadPlacements>> | undefined;
  const landmarkBounds = new Map<string,T.Box3>(), landmarkAnchors: Record<string,T.Vector3> = {};
  let refreshLandmarkUi = () => {};
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
    uiPlacements = placements; uiStructure = s;
    if (placements) {
      terrain.carves = landmarkCarves(placements, (x,z)=>terrain.heightAt(x,z));
      // OSM blocks that a hand-modelled landmark replaces are never built (display or collision).
      const gone = new Set(Object.keys(placements).map(id => REPLACES[id]).filter(Boolean));
      replacedOsm = gone;
    }
    campusData = buildings; structure = { ...s, context: { ...s.context, landmarks: s.context.landmarks.filter(l => !replacedOsm.has(l.id)) } };
    campusInfo = await loadJson<CampusInfo>('data/campus-info.json', '校園資訊').catch(() => undefined);
    for (const b of campusData) for (const f of b.floors) f.access = access.floors[f.id];
    world = buildWalkWorld(campusData, structure, terrain);
    world.display.userData.roadExclusions = s.context.landmarks.filter(l => replacedOsm.has(l.id)).map(l => l.polygon);
    if (placements?.tunnel) world.display.userData.treeBores = tunnelBores(fullTunnelProfile(placements.tunnel, (x,z)=>terrain.heightAt(x,z)));
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
    const doors = doorConstraint(world.doors);
    const shore = shoreConstraint(terrain, (x,z,y)=>physics.supportAt(x,z,y));
    physics.constrain = (position,velocity,h)=>{ doors(position,velocity,h); shore(position,velocity,h); };
    physics.teleport(world.spawn);
    terrainRef = terrain;
    startupJobs.push(addCampusProps(world, url => new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(url), asset, () => alive, (x,z,y)=>physics.supportAt(x,z,y))
      .then(specs => { if (!alive) return; physics.addObstacles(specs ?? []); obstacleField.add(specs ?? []); growable?.setVolumes('legacy-props', vegetationBoxes(specs ?? [])); toonify(world.display); featureStatus.legacyProps='ready'; })
      .catch(e => { featureStatus.legacyProps='degraded'; console.warn('campus props',e); })
      .finally(()=>{ legacyPropsReady=true;validateRoutes(); }));
    if (!placements) { landmarksReady = true; featureStatus.landmarks='degraded'; growable?.setReady(true); }
    if (placements) startupJobs.push(loadLandmarks(asset, placements, terrain).then(lm => {
      if (!alive) { disposeObject(lm.display); disposeObject(lm.collision); return; }
      // Hand-modelled landmarks replace the OSM blocks and the v2 procedural features at those sites.
      world.display.traverse(o => { if (o.name.startsWith('Landmark features')) o.visible = false; });
      scene.add(lm.display); physics.addStatic(lm.collision);
      lm.display.traverse(object => {
        const landmarkId = object.userData.landmarkId as string | undefined;
        if (!landmarkId || (object.userData.portal && object.userData.portal !== 'west')) return;
        const id = REPLACES[landmarkId] ?? ({gate:'GATE',tunnel:'TUNNEL'} as Record<string,string>)[landmarkId] ?? landmarkId;
        const bounds = new T.Box3().setFromObject(object);
        if (bounds.isEmpty()) return;
        landmarkBounds.set(id,bounds);
        const anchor = bounds.getCenter(new T.Vector3()); anchor.y = bounds.max.y + 2;
        if (id === 'GATE') anchor.x = (uiPlacements?.gate?.centroid[0] ?? anchor.x) - 7.5;
        landmarkAnchors[id] = anchor;
      });
      refreshLandmarkUi();
      // Gate boom arms live in the merged visual GLB. Register their actual asset
      // bounds before announcing landmark readiness or validating outdoor routes.
      const barriers = gateBarrierObstacles(lm.display);
      physics.addObstacles(barriers); obstacleField.add(barriers);
      growable?.setVolumes('landmarks', lm.vegetationVolumes);
      growable?.setReady(true);
      landmarksReady = true; featureStatus.landmarks='ready'; validateRoutes();
    }).catch(e => { console.warn('landmarks', e); landmarksReady = true; featureStatus.landmarks='degraded'; validateRoutes(); }));
  } catch (e) {
    stopLoadingTips();
    get('.walk-loading').textContent = '校園圖資暫時無法開啟，請回到校園地圖。';
    get('.walk-welcome').hidden = true;
    get('[data-action=exit]').addEventListener('click', () => { alive = false; renderer.dispose(); orbit.dispose(); exitToMap(); }, { once: true });
    console.error(e); return;
  }

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
    return gltf.loadAsync(asset(`models/characters/${key}.glb`)).then(g => {
      if (!alive || loading !== token) { disposeObject(g.scene); return; }
      // glTF characters face +Z; the avatar's facing math assumes -Z.
      g.scene.rotation.y = Math.PI;
      toonify(g.scene); recolor(g.scene, PALETTES[look().body][palette].look, true); addOutlines(g.scene, 'character');
      avatar.setModel(g.scene, g.animations);
    }).catch(() => say('角色模型載入失敗，改用簡易人物。', 3000));
  };
  const nick = get<HTMLInputElement>('.walk-nick input');
  nick.value = look().nickname;
  nick.addEventListener('change', () => { campus.setPlayer({ nickname: nick.value }); nick.value = look().nickname; });
  markChar(); startupJobs.push(loadCharacter());

  // ---- camera & modes --------------------------------------------------------------------
  const rig = new CameraRig(camera, (a, b, r) => physics.sweep(a, b, r));
  rig.yaw = -Math.PI / 2; rig.snap(physics.position);
  let walking = false, overview = true, inspectedBuilding = 'SC';
  const buildingSelect = get<HTMLSelectElement>('[data-building]'), floorSelect = get<HTMLSelectElement>('[data-floor]');

  function chooseMode(isOverview: boolean) {
    if(sceneLoading)return;
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
  const soundVisibility = () => sound.setHidden(document.hidden);
  document.addEventListener('visibilitychange', soundVisibility);
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
  let guideOverride: GuideOverride | undefined, pocketAt = 0;
  const tipsFrom = performance.now() + 25000;
  let autoPath: T.Vector3[] = [], pathIndex = 0, autoDestination: WalkDestination | undefined, pendingDestination: WalkDestination | undefined;
  let progressTime = 0, replans = 0; const progressPosition = new T.Vector3();
  /** G set off and has not been called off: after each dialogue the walk carries on to the next goal. */
  let autoFollow = false, autoTarget: string | undefined, wasBlocking = false, autoCheckAt = 0;
  const disposeTree = (root: T.Object3D) => root.traverse(o => {
    if (o instanceof T.Mesh || o instanceof T.Line) { o.geometry.dispose(); for (const m of [o.material].flat()) m.dispose(); }
  });
  function clearRoute() { disposeTree(routeLine); routeLine.clear(); }
  function clearAuto(manual = false) {
    const was = autoPath.length > 0;
    autoPath = []; autoDestination = undefined; pendingDestination = undefined; autoTarget = undefined; clearRoute();
    if (manual) autoFollow = false;
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
    anchor = ({AD:'admin',IL:'library',GATE:'gate',TUNNEL:'tunnel-west'} as Record<string,string>)[anchor] ?? anchor;
    if(!routesValidated) { say('場景碰撞與步道仍在準備，請稍候再開始帶路。');return; }
    routes?.avoid.splice(0);
    const tunnel = uiPlacements?.tunnel && terrainRef ? fullTunnelProfile(uiPlacements.tunnel,(x,z)=>terrainRef!.heightAt(x,z)) : undefined;
    const goal = anchor==='tunnel-east' ? tunnel?.east : anchor==='tunnel-west' ? tunnel?.west : routes?.anchor(anchor) ?? npcs?.anchorPoint(anchor);
    const p = goal ? planRoute(goal) : [];
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
  type Candidate = InteractionAction & { label:string; targetLabel?:string; point:T.Vector3; run:()=>void };
  let selectedInteraction: string | undefined;
  let shownInteractions: Candidate[] = [];
  function interactionCandidates(): Candidate[] {
    if (eventPose.sitting || rhythm || notebook?.open || menuOpen() || overview || !walking || photo.active || quiz?.open || director?.blocking || guide.open) return [];
    const p=physics.position, out:Candidate[]=[];
    const add=(id:string,label:string,priority:number,point:T.Vector3|undefined,run:()=>void,targetId=id,actionId=id)=>{if(point)out.push({id,targetId,actionId,targetLabel:targetId.startsWith('npc:')?npcs?.displayName(targetId.slice(4)):undefined,label,priority,point:point.clone(),distance:p.distanceTo(point),run});};
    const focused=quests?.progress.tracked;
    const action=campusEvents && campusEventAction(campusEvents,eventWorld(),eventPaused() || eventQueue.busy);
    if(action)add(action.id,action.label,115,p,()=>{if(campusEvents && campusEventAction(campusEvents,eventWorld(),eventPaused())?.actionId===action.actionId){eventQueue.push(campusEvents.act(action.actionId));eventQueue.flush();}},action.targetId,action.actionId);
    if (director?.canInteract) add('story','繼續新生導覽',storyPriority(!!focused,director.blocking),director.goal()??p,()=>{director?.press();},director.goalTarget??'story',`story:${director.engine.progress.active??''}:${(director.engine.progress.fired[director.engine.progress.active??'']??[]).join(',')}`);
    const monkey=npcs?.get('m3-thief');
    if(chase.active && monkey && Math.hypot(p.x-monkey.position.x,p.z-monkey.position.z)<2.2) add('chase','拿回便當',95,monkey.position,()=>{chase.press(p);},'npc:m3-thief','retrieve');
    const encounter=encounters?.active;
    if(encounter && p.distanceTo(encounterTarget())<=encounterReach(encounter.phase)) add('encounter',encounter.phase==='offered'?'參與偶遇':'完成偶遇互動',90,encounterTarget(),()=>{pressEncounter();},`encounter:${encounter.instance}`,encounter.phase);
    for (const { definition: q, availability, disabled } of quests ? nearbyQuestOffers(quests, questWorld()) : []) {
      add(`accept:${q.id}`, questOfferLabel(q.title, availability), q.accept.chapterDone && q.accept.chapterDone === director?.engine.progress.done.at(-1) ? interactionPriority.newlyUnlocked : interactionPriority.acceptable, questPoint(q.accept.near), () => { void acceptSideQuest(q.id); }, q.accept.near, 'accept');
      const row = out.find(c => c.id === `accept:${q.id}`); if (row) row.disabled = disabled;
    }
    for(const v of quests?.list()??[]) {
      const step=v.step; if(!step || step.kind==='photo' || (step.when && step.when!==sky.preset))continue;
      const point=questPoint(step.target);if(!point || questDistance(step.target)>(step.radius??4))continue;
      add(`quest:${v.definition.id}`,step.target.startsWith('spot:')?spotField?.label(step.target.slice(5))??v.definition.title:v.definition.title,v.definition.id===focused?interactionPriority.tracked:interactionPriority.active,point,()=>{void sideQuestDialogue(v.definition.id);},step.target,`step:${step.id}`);
    }
    for (const person of talk?.candidate(p) ?? []) add(`talk:${person.id}`,`交談・${person.name}`,interactionPriority.talk,npcs?.get(person.id)?.position,()=>{talk?.pressId(person.id);},`npc:${person.id}`,'talk');
    if(bike.atStand(p)) add('bike','租腳踏車',70,bike.stand,()=>{ if (avatar.rideReady) bike.press(p); else say('腳踏車與人物姿勢仍在準備，請稍候。', 2500); });
    const lift=liftWins(world,p);
    if(lift) add('lift','搭電梯',60,lift.stop.position,()=>{if(liftPanel.hidden)showLift(lift);else liftPanel.hidden=true;},`lift:${lift.lift.id}`,lift.stop.floorId);
    for (const door of world.doors.filter(d=>d.position.distanceTo(p)<2.15)) {
      const expected=door.target;
      add(`door:${door.id}`,`${door.target?'關門':'開門'}・${door.label}`,50,door.position,()=>{
        const r=toggleDoorById(world,physics.position,door.id,expected);if(r.kind==='blocked')say('請先離開門口，再關門。');else if(r.kind!=='none')say(`${r.kind==='opened'?'打開':'關上'} ${r.door.label}｜室內配置為示意`,3000);
      },`door:${door.id}`,expected?'close':'open');
    }
    const nearbyLandmark=campusUi?.nearbyLandmark(p);
    if(nearbyLandmark) add(`landmark:${nearbyLandmark.id}`,`${nearbyLandmark.name}資訊`,40,nearbyLandmark.position,()=>campusUi?.openCard(nearbyLandmark.id));
    if(campusUi?.nearStory) { const story=campusUi.nearStory; add('history','校園故事',45,p,()=>{if(campusUi.nearStory?.id===story.id)campusUi.interact(p);},`history:${story.id}`,'read'); }
    return orderInteractions(out);
  }
  let pickedByHand=false;
  function selectedCandidate() { return selectInteraction(interactionCandidates(),selectedInteraction,pickedByHand); }
  function cycleTarget(direction = 1) {
    const choices=interactionCandidates(), selected=cycleInteraction(choices,selectedInteraction,direction);
    selectedInteraction=selected?.id; pickedByHand=!!selected;
    shownInteractions=choices;
    input.release(); clearAuto(true);
  }
  function executeInteraction(shown: Candidate) {
    if (director?.blocking) return;
    const current=revalidateInteraction(interactionCandidates(),shown);
    if (current) { selectedInteraction=current.id; current.run(); }
    else say('這個項目已不在互動範圍或狀態已改變，請重新選擇。',2500);
  }
  function interact(eventTimestamp?:number) {
    routeEventE(!!rhythm,()=>clapRhythm(eventTimestamp),interactNormally);
  }
  function interactNormally() {
    if(eventPose.sitting)return;
    if(director?.blocking) { director.press(); return; }
    const candidate=shownInteractions.find(c=>c.id===selectedInteraction);
    if(candidate) executeInteraction(candidate);
    else say('靠近人物或互動物件後按 E；多個項目可點清單或按數字鍵。',2500);
  }
  function resetToSpawn() { clearAuto(); if(!moveSafely(world.spawn)) { say('起點附近沒有安全落點，請稍後再試或返回校園地圖。',7000); return; } recoveryFailed=false; avatar.face(-Math.PI / 2); rig.yaw = -Math.PI / 2; rig.pitch = -.18; rig.snap(physics.position); chooseMode(false); say('已回到理工長廊前的安全位置。'); }

  // ---- menu (Esc) ------------------------------------------------------------------------
  const menu = get('.walk-menu');
  get('.walk-menu-search').append(get('.walk-search')); get('.walk-menu-tools').append(get('.walk-toolbar'));
  const menuOpen = () => !menu.hidden;
  function setMenu(open: boolean, tab?: string) {
    menu.hidden = !open;
    if (open) { notebook?.close(); input.release(); clearAuto(); autoFollow = false; if (tab) showTab(tab); menu.querySelector<HTMLElement>('[data-tab][aria-selected=true]')?.focus(); }
    get('[data-action=menu]').setAttribute('aria-pressed', String(open));
  }
  function showTab(tab: string) {
    menu.querySelectorAll<HTMLElement>('[data-tab]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
    menu.querySelectorAll<HTMLElement>('[data-pane]').forEach(p => { p.hidden = p.dataset.pane !== tab; });
    if (tab === 'album') renderAlbum();
    if (tab === 'map') renderMap();
  }
  let renderAlbum = () => {};
  let renderMap = () => {};
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
    sweep: (a, b, r) => physics.sweep(a, b, r),
    ground: (x, z) => terrainRef ? terrainRef.heightAt(x, z) : -.055,
    setSky: p => { sky.set(p); get('[data-action=sky]').textContent = `${PRESET_LABEL[p]} N`; },
    sky: () => sky.preset, cue: id => sound.cue(id),
    saved: () => campus.count('photo.saved'),
    recordShot: () => {
      // Measured from where the player stands: the photo camera orbits 4.5 m out and can roam 15 m, a viewpoint is a place to stand on.
      const at = physics.position.clone(), preset = sky.preset;
      const distances = new Map((quests?.data.quests ?? []).flatMap(q=>q.steps.map(step=>[step.target,questPoint(step.target)?.distanceTo(at) ?? Infinity] as const)));
      const snapshot: QuestWorld = { distanceTo:t=>distances.get(t)??Infinity, timeOfDay:()=>preset };
      return () => { const before=quests?.progress.journal.length; quests?.notifyPhoto(snapshot); if (quests && quests.progress.journal.length !== before) say('照片已收進手帳，拍攝任務完成這一步。'); };
    },
    exited: () => rig.snap(physics.position),
  });
  function enterPhoto() {
    if (overview || !walking || director?.blocking) return;
    setMenu(false); clearAuto(); autoFollow = false; photo.enter(physics.position, rig.yaw);
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
    if(bike.riding && (eventPose.requested || rhythm))cancelCampusActivity();
  }
  scene.add(bike.standGroup);
  startupJobs.push(new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(asset('models/campus/bicycle.glb')).then(g => {
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
  }).catch(e => {featureStatus.bike='degraded';console.warn('bike', e);}).finally(()=>{bikeStandReady=true;validateRoutes();}));

  // ---- input -----------------------------------------------------------------------------
  // H / the `?` icon: open the menu's 操作說明 tab, or close the menu when that tab is already showing.
  const toggleHelp = () => { if (helpShortcut(menuOpen(), menu.querySelector('[data-tab=help]')?.getAttribute('aria-selected') === 'true') === 'close') setMenu(false); else setMenu(true, 'help'); };
  // First-run guide (spec-v7 Lane C): waits until the player is walking with no dialogue, card, menu, journal, quiz or photo mode up.
  const guide = new FirstRunGuide(host, {
    walking: () => walking && !overview && !!get('.walk-welcome').hidden && !!get('.walk-loading').hidden,
    blocked: () => !!director?.blocking || menuOpen() || !!notebook?.open || photo.active || !!quiz?.open,
    help: () => setMenu(true, 'help'),
  }, { coarse });
  const tips = new ContextTips(host, coarse);
  get('[data-action=tips-reset]').addEventListener('click', () => { tips.reset(); say('提示已重設，用得到時會再出現。', 3000); });
  // Register before WalkInput's capture listener, which owns/stops the event. Keep input.ts untouched.
  let rhythmKeyTimestamp:number|undefined;
  const captureRhythmKey=(event:KeyboardEvent)=>{if(event.key.toLowerCase()==='e')rhythmKeyTimestamp=event.timeStamp;};
  window.addEventListener('keydown',captureRhythmKey,{capture:true});
  const input = new WalkInput(renderer.domElement, get('.walk-joystick'), get('.walk-stick'), {
    modal(k, mode) {
      if (guide.open) { guide.key(k); return; }
      if (notebook?.open) { notebook.key(k); return; }
      if (mode === 'dialogue') director?.ui.key(k);
      else if (mode === 'photo') photo.key(k);
      else if (mode === 'menu' && quiz?.open) quiz.key(k);
      else if (mode === 'menu') { if (k === 'j') { openNotebook(); return; } if (k === 'h') { toggleHelp(); return; } if (k === 'escape') setMenu(false); else if (k === '/') { setMenu(true, 'play'); get<HTMLInputElement>('.walk-search input').focus(); } }
    },
    press(k) {
      if (k === 'j') { openNotebook(); return; }
      if (k === 'h') { toggleHelp(); return; }
      if (k === 'escape' && campusEvents?.activity && !eventPaused()) { cancelCampusActivity(); return; }
      if (k === 'escape' && encounters?.active?.phase === 'active') { encounters.giveUp(); say('這次先放過它，下次再遇見！'); return; }
      if (k === 'escape' && chase.active) { chase.cancel(); say('放棄追逐。', 2500); return; }
      if (k === 'escape' && !autoPath.length && get('.walk-results').hidden) { setMenu(true, 'play'); return; }
      if (k === 'escape') { get('.walk-results').hidden = true; get<HTMLInputElement>('.walk-search input').blur(); input.release(); clearAuto(); autoFollow = false; say('已暫停帶路'); return; }
      if (k === '/') { setMenu(true, 'play'); get<HTMLInputElement>('.walk-search input').focus(); return; }
      if (k === 'm') { chooseMode(walking ? !overview : true); return; }
      if (k === 'v') { setFirstPerson(!rig.firstPerson); return; }
      if (k === 'l') { toggleLock(); return; }
      if (k === 'e') { interact(rhythmKeyTimestamp);rhythmKeyTimestamp=undefined;return; }
      if (k === 'n') cycleSky();
      if (k === 'p') enterPhoto();
      if (k === 'b') toggleBike();
      if (k === 'g') toggleFollow();
      if (k === 'q') switchLine();
      if (k === 'r') cycleTarget();
      if (/^[1-4]$/.test(k)) { const row=numberedInteractions(shownInteractions,selectedInteraction)[Number(k)-1]; if(row)executeInteraction(row); }
    },
    interactionListOpen: () => shownInteractions.length > 1,
    moveStarted() { movementRequested=true;eventPose.update(true,false);if(rhythm)cancelCampusActivity();if (!walking || overview) chooseMode(false); clearAuto(true); },
    look(dx, dy) { if (photo.active) photo.look(dx, dy); else rig.rotate(dx, dy); },
    zoom(d) { if (photo.active) photo.zoom(d); else rig.zoom(d); },
    canLook: () => !overview,
  });
  input.mode='menu';
  renderer.domElement.addEventListener('click', () => { if (rig.firstPerson && !overview && !coarse && !document.pointerLockElement) renderer.domElement.requestPointerLock?.(); });
  host.addEventListener('pointerdown', e => { if (e.pointerType === 'touch') host.classList.add('has-touch'); });
  if (coarse) {
    get('.walk-help').textContent = '左搖桿移動 · 右側拖曳轉頭 · 按鈕奔跑／互動／跳躍';
    // Phone players read touch controls first; the key tables stay below for keyboards on tablets.
    const pane = get('[data-pane=help]'), heading = [...pane.querySelectorAll('h3')].find(h => h.textContent === '手機操作');
    if (heading) pane.prepend(heading, heading.nextElementSibling!);
  }

  const searchInput = get<HTMLInputElement>('.walk-search input');
  searchInput.addEventListener('input', () => {
    const term = searchInput.value.normalize('NFKC').toUpperCase().replace(/\s/g, ''), results = get('.walk-results');
    if (!term) { results.hidden = true; return; }
    const matches = world.destinations.filter(d => (d.label + ' ' + d.buildingId + ' ' + (d.displayName ?? '')).normalize('NFKC').toUpperCase().includes(term)).slice(0, 12);
    const places = (routes?.anchorIds ?? []).filter(id => routes!.label(id).normalize('NFKC').toUpperCase().includes(term)).slice(0, 6);
    results.innerHTML = matches.length || places.length ? places.map(id => `<button data-place="${safe(id)}"><strong>${safe(routes!.label(id))}</strong><small>校園步道 · 帶我走過去 →</small></button>`).join('') + matches.map(d => `<button data-destination="${safe(d.id)}"><strong>${safe(d.displayName ? `${d.label} ${d.displayName}` : d.label)}</strong><small>${safe(d.floorId)} · 帶我走到門口 →</small></button>`).join('')
      : '<div class="walk-empty">找不到這個名稱。可試房號前綴，或選擇上方大樓與樓層探索。</div>';
    results.hidden = false;
  });
  host.addEventListener('click', e => {
    const target = e.target as HTMLElement;
    const bodyBtn = target.closest<HTMLElement>('[data-body]'), palBtn = target.closest<HTMLElement>('[data-palette]');
    if (bodyBtn) { if (bodyBtn.dataset.body !== look().body) { campus.setPlayer({ body: bodyBtn.dataset.body as Body, palette: 0 }); markChar(); loadCharacter(); } return; }
    if (palBtn) { campus.setPlayer({ palette: Number(palBtn.dataset.palette) }); markChar(); loadCharacter(); return; }
    const place = target.closest<HTMLElement>('[data-place]')?.dataset.place;
    if (place) { setMenu(false); walkOutdoor(place); return; }
    const destination = target.closest<HTMLElement>('[data-destination]')?.dataset.destination;
    if (destination) { const d = world.destinations.find(d => d.id === destination); if (d) { setMenu(false); goTo(d); } return; }
    const action = target.closest<HTMLElement>('[data-action]')?.dataset.action;
    switch (action) {
      case 'start': case 'walk': chooseMode(false); break;
      case 'overview': chooseMode(true); break;
      case 'run': input.runToggle = !input.runToggle; break;
      case 'camera': setFirstPerson(!rig.firstPerson); break;
      case 'lock': toggleLock(); break;
      case 'door': interact(); break;
      case 'sky': cycleSky(); break;
      case 'sound': void sound.toggle().then(soundLabel); break;
      case 'jump': clearAuto(true); input.jump = true; break;
      case 'reset': resetToSpawn(); break;
      case 'menu': setMenu(!menuOpen(), 'play'); break;
      case 'help': toggleHelp(); break;
      case 'journal': openNotebook(); break;
      case 'photo': enterPhoto(); break;
      case 'bike': toggleBike(); break;
      case 'menu-close': setMenu(false); break;
      // Back to walking first (chooseMode hides the welcome card), then reopen the card for body, colours and nickname.
      case 'character': chooseMode(false); markChar(); get('.walk-welcome').hidden = false; get<HTMLInputElement>('.walk-nick input').value = look().nickname; break;
      case 'restart-tour': if (confirm('重新開始新生導覽？保留角色、收藏、支線與校園手帳。')) { clearProgress(); location.reload(); } break;
      case 'clear-all': if (confirm('清除全部導覽、收藏、支線與手帳紀錄？此操作無法復原，角色與暱稱保留。')) { clearProgress(); clearCampus(true); quests?.clear(); campusEvents?.clear(); localStorage.removeItem(QUEST_KEY); location.reload(); } break;
      case 'exit': close(); break;
    }
  });
  buildingSelect.innerHTML = campusData.map(b => `<option value="${safe(b.id)}">${safe(b.name)}</option>`).join(''); buildingSelect.value = 'SC';
  const floorOptions = () => { floorSelect.innerHTML = '<option value="all">全棟</option>' + world.floors.filter(f => f.buildingId === inspectedBuilding).map(f => `<option value="${safe(f.data.id)}">${safe(f.data.label)}</option>`).join(''); };
  floorOptions();
  buildingSelect.addEventListener('change', () => { inspectedBuilding = buildingSelect.value; floorOptions(); chooseMode(true); });
  floorSelect.addEventListener('change', () => { if (!overview) chooseMode(true); });
  const campusUi = campusInfo ? new CampusUi(host, scene, world, uiStructure, campusData, campusInfo, {
    goToBuilding: id => { const d = world.destinations.find(d => d.id === `${id}-1F-entrance`); if (d) { chooseMode(false); goTo(d); } else { chooseMode(false); walkOutdoor(({AD:'admin',IL:'library',GATE:'gate'} as Record<string,string>)[id] ?? id); } },
    inspectBuilding: id => { chooseMode(true); buildingSelect.value = id; buildingSelect.dispatchEvent(new Event('change')); },
    focusLandmark: id => {
      const bounds = landmarkBounds.get(id);
      if (!bounds) { say('地標模型仍在載入，請稍候再查看。'); return; }
      clearAuto(); chooseMode(true);
      const center = bounds.getCenter(new T.Vector3()), size = bounds.getSize(new T.Vector3());
      const distance = Math.max(size.y, size.x / camera.aspect, size.z) / (2 * Math.tan(camera.fov * Math.PI / 360)) * 1.6;
      orbit.target.copy(center); const view=id==='AD'?new T.Vector3(0,.28,1):new T.Vector3(-.55,.30,1); camera.position.copy(center).add(view.normalize().multiplyScalar(distance)); orbit.update();campusUi?.focusLandmarkLabel(id);
      say(`查看全貌：${campusInfo?.buildings[id]?.name ?? (id==='GATE'?'校門校碑':id)}（拖曳旋轉，滾輪遠近）`,6000);
    },
    say,
  }, {ground:(x,z)=>terrainRef?.heightAt(x,z) ?? -.055,placements:uiPlacements,anchors:landmarkAnchors}) : undefined;
  refreshLandmarkUi = () => campusUi?.updateLandmarkAnchors(landmarkAnchors);
  refreshLandmarkUi();
  const resize = () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); applyTier(tier); };
  window.addEventListener('resize', resize);

  // ---- HUD refresh (7 Hz) ----------------------------------------------------------------
  const minimap = get<HTMLCanvasElement>('.walk-minimap'), ctx = minimap.getContext('2d')!;
  const minimapSheet = new CampusMinimap(); void minimapSheet.load(asset).catch(e => console.warn('minimap', e));
  const mapCanvas = get<HTMLCanvasElement>('.walk-map-canvas'), mapPick = get('.walk-map-pick'), mapGo = get('[data-map-go]');
  const mapHidden = new Set<MapMarkerKind>();
  let collectionData: CollectionData | undefined;
  let mapMarkers: MapMarker[] = [], mapSelected: MapMarker | undefined, mapFrame = fitCampusFrame(1, 1);
  const collectMarkers = () => {
    const out: MapMarker[] = [{ id: 'bike', kind: 'bike', x: bike.stand.x, y: bike.stand.y, z: bike.stand.z, label: '租車點' }];
    const world = questWorld();
    for (const v of quests?.list() ?? []) {
      if (v.state?.status === 'completed' || (!v.state && !quests!.unlocked(v.definition, world))) continue;
      const point = questPoint(trackedTarget(v));
      if (point) out.push({ id: `quest:${v.definition.id}`, kind: 'quest', x: point.x, y: point.y, z: point.z, label: v.definition.title });
    }
    // Several stamps share one place; a single marker per place lists them all.
    const places = new Map<string, MapMarker>();
    for (const stamp of collectionData?.stamps ?? []) {
      if (campus.progress.stamps.includes(stamp.id)) continue;
      const place = String(stamp.at), known = places.get(place);
      if (known) { known.label += `、${stamp.name}`; continue; }
      const point = Array.isArray(stamp.at) ? new T.Vector3(stamp.at[0], physics.position.y, stamp.at[1]) : routes?.anchor(stamp.at) ?? npcs?.anchorPoint(stamp.at);
      if (point) places.set(place, { id: `stamp:${place}`, kind: 'stamp', x: point.x, y: point.y, z: point.z, label: `章戳・${stamp.name}` });
    }
    out.push(...places.values());
    return out;
  };
  renderMap = () => {
    const box = mapCanvas.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, 2);
    if (!box.width || !box.height) return;
    mapCanvas.width = Math.round(box.width * dpr); mapCanvas.height = Math.round(box.height * dpr);
    const ctx = mapCanvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    mapFrame = fitCampusFrame(box.width, box.height);
    mapMarkers = collectMarkers().filter(m => !mapHidden.has(m.kind));
    if (mapSelected && !mapMarkers.some(m => m.id === mapSelected!.id)) mapSelected = undefined;
    minimapSheet.drawOverview(ctx, mapFrame, mapMarkers, mapSelected?.id, physics.position, rig.yaw, guideOverride?.point ?? director?.goal());
    mapPick.querySelector('span')!.textContent = mapSelected?.label ?? '點地圖上的標記查看地點。';
    mapGo.hidden = !mapSelected;
  };
  mapCanvas.addEventListener('click', e => {
    const box = mapCanvas.getBoundingClientRect();
    mapSelected = pickMarker(mapMarkers, mapFrame, e.clientX - box.left, e.clientY - box.top);
    renderMap();
  });
  host.querySelectorAll<HTMLElement>('[data-map-kind]').forEach(button => button.addEventListener('click', () => {
    const kind = button.dataset.mapKind as MapMarkerKind, show = mapHidden.has(kind);
    if (show) mapHidden.delete(kind); else mapHidden.add(kind);
    button.setAttribute('aria-pressed', String(show));
    renderMap();
  }));
  mapGo.addEventListener('click', () => {
    const picked = mapSelected;
    if (!picked) return;
    setMenu(false);
    if (picked.kind === 'quest') { quests?.track(picked.id.slice(6), questWorld()); refreshNotebook(); followQuest(); }
    else walkToPoint(new T.Vector3(picked.x, picked.y, picked.z), picked.label);
  });
  let currentFloor = world.floors.find(f => f.buildingId === 'SC' && f.data.level === 1)!;
  const inverseFrames = new Map([...world.frames].map(([id, m]) => [id, m.clone().invert()]));
  const signWalls = buildDoorSignWalls(world, campusData, structure);
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
    setText(get('#walk-place'), autoDestination ? `前往 ${autoDestination.label}` : best < 8 ? `${buildingName}・${currentFloor.data.label}` : director?.zoneLabel ?? (best < 60 ? '中山・理工校園' : '中山大學・西子灣'));
    lod.update(foot, { overview, buildingId: inspectedBuilding, floorId: floorSelect.value });
    const runBtn = get('[data-action=run]'); runBtn.classList.toggle('is-running', input.running); runBtn.setAttribute('aria-pressed', String(input.running));
    for (const door of world.doors) {
      const distance = door.position.distanceTo(foot), floorVisible = world.floors.find(f => f.data.id === door.floorId)?.group.visible !== false;
      door.group.visible = distance < 75 && floorVisible;
      let sign = signs.get(door.id);
      if (distance < 19 && floorVisible) {
        if (!sign) { sign = placeSign(door); if (sign) signs.set(door.id, sign); }
        if (sign) sign.visible = true;
      } else if (sign) {
        sign.visible = false;
        if (distance > 65) { scene.remove(sign); disposeTree(sign); signs.delete(door.id); }
      }
    }
    drawFloorMinimap(ctx, world, floorRecord, foot, rig.yaw, autoPath, inverseFrames.get(floorRecord.buildingId)!, guideOverride ? guideOverride.point : director?.goal());
    if ((overview && floorSelect.value === 'all') || (!overview && best >= 4)) {
      const center = overview ? orbit.target : foot, heading = overview ? Math.atan2(camera.position.x - orbit.target.x, camera.position.z - orbit.target.z) : rig.yaw;
      if (!minimapSheet.draw(ctx, center, heading, guideOverride ? guideOverride.point : director?.goal())) campusUi?.drawMinimap(ctx, center, heading);
    }
    const door = nearestDoor(world, foot), inLift = liftWins(world, foot);
    if (!inLift) liftPanel.hidden = true;
  }
  function placeSign(door: WorldDoor) {
    const pose = doorSignPose(door, signWalls.get(door.id));
    if (!pose) return undefined;
    const mesh = makeDoorSign(door.label);
    mesh.position.copy(pose.position); mesh.quaternion.copy(pose.quaternion);
    scene.add(mesh); return mesh;
  }

  function close() {
    alive = false; stopLoadingTips(); campusUi?.dispose(); clearTimeout(statusTimer); cancelAnimationFrame(frameId);
    input.dispose(); window.removeEventListener('keydown',captureRhythmKey,{capture:true});document.removeEventListener('visibilitychange', soundVisibility); window.removeEventListener('campus-storage-error',storageFailed); window.removeEventListener('resize', resize); orbit.dispose(); navigation?.dispose();
    eventQueue.clear(); npcs?.releaseAllBorrowed(); eventInvite.remove();
    encounterScene.dispose();
    notebook?.dispose(); director?.dispose(); characterWarmup?.dispose();npcs?.dispose(); photo.dispose(); spotField?.dispose();
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

  // Campus events own temporary NPC walks; authored schedules resume only after release.
  const eventInvite=document.createElement('div');
  eventInvite.className='encounter-card campus-event-invite';eventInvite.hidden=true;
  eventInvite.setAttribute('role','group');eventInvite.setAttribute('aria-label','校園活動邀請');host.append(eventInvite);
  const eventPose=new EventPlayerPose(sitting=>{
    if(sitting){bike.riding=false;avatar.riding=false;physics.setRiding(false,avatar.heading);clearAuto();autoFollow=false;}
    const host=campusEvents?.activity?.definition.host;
    const point=host && !npcs?.isAbsent(host)?npcs?.get(host)?.position:undefined;
    const heading=sitting?eventSeatHeading(physics.position,point):undefined;
    avatar.setSeated(sitting,heading);rig.setSeated(sitting,heading);
  });
  const questChoice=(quest:string,step:string)=>quests?.progress.quests[quest]?.choices[step];
  const eventSpeech=new Map<string,{text:string;until:number}>();
  let eventMoveFailed=false,eventWalkSeconds=0;
  const eventQueue=new EventCommandQueue({
    banner:(text,title)=>director?.ui.banner(text,title),sound:id=>sound.cue(id),
    journal:entry=>{quests?.record(entry);refreshNotebook();},
    move:(id,target)=>{
      if(!eventNpcAvailable(id))return false;
      const npc=npcs?.get(id),to=questPoint(target);if(!npc || !to || !routesValidated)return false;
      const clear=(a:T.Vector3,b:T.Vector3)=>{
        const from=a.clone().add(new T.Vector3(0,.35,0)),end=b.clone().add(new T.Vector3(0,.35,0));
        return physics.sweepActor(id,from,end,.24,.65)>=from.distanceTo(end)-.02;
      };
      const start=npc.position.clone();
      const planned=plan(start.clone(),to.clone(),navigation,routes,clear);
      const path=obstacleField.route(connectNpcPathStart(start,planned,clear),.24,clear,(x,z,y)=>physics.supportAt(x,z,y));
      if(!path.length || path.at(-1)!.distanceTo(to)>.75)return false;
      return npcs!.borrowPath(id,path);
    },
    moving:()=>npcs?.borrowedMoving??false,
    release:id=>{if(npcs?.releaseBorrowed(id))scheduleNpcs(true);},
    say:(id,text)=>{if(npcs && !npcs.isAbsent(id))eventSpeech.set(id,{text,until:performance.now()+7000});},
    invite:c=>{eventInvite.innerHTML=`<strong>${safe(npcs?.displayName(c.host)??c.host)}</strong><p>${safe(c.text)}</p><button type="button" data-event-answer="yes">${safe(c.accept)}</button><button type="button" data-event-answer="no">${safe(c.decline)}</button>`;},
    objective:text=>director?.ui.eventObjective(text,()=>cancelCampusActivity()),
    pose:(pose,at)=>eventPose.request(pose,at),
    rhythm:command=>startRhythm(command),stopRhythm:()=>stopRhythm(),questChoice,
    achievement:id=>{
      const fresh=!campus.progress.achievements.includes(id);campus.achieve(id);
      // Album already listens to Campus.achieve and owns the normal toast and fanfare.
      if(fresh&&!album)director?.ui.toast('achievement',id==='silence'?'一分鐘':id==='audience'?'聽眾':id);
    },
    counter:id=>{campus.count(id);album?.evaluate();},reward:id=>director?.ui.toast('stamp',id),
    moveFailed:()=>{eventMoveFailed=true;say('步道暫時不通，這次活動先停下，稍後再來。',4000);},
  });
  function storyUsesNpc(id:string) {
    if(director?.goalTarget===`npc:${id}`)return true;
    const chapter=director?.engine.active;
    return !!chapter && chapter.steps.some(step=>!(director!.engine.progress.fired[chapter.id]??[]).includes(step.id) &&
      (JSON.stringify(step).includes(`"${id}"`) || JSON.stringify(step).includes(`"npc:${id}"`) || step.then.some(a=>'dialogue' in a && director!.engine.data.dialogues[a.dialogue]?.some(l=>l.who===id))));
  }
  function eventNpcAvailable(id:string) {
    return !!npcs && !npcs.isAbsent(id) && !npcs.get(id)?.talking && !storyUsesNpc(id) && !(id==='m3-thief' && (chase.active || miniGameActive));
  }
  function eventPaused() {
    return document.hidden || campusEventsPaused({walking:walking && storyStarted && routesValidated,overview,dialogue:!!director?.ui.dialogueOpen,
      menu:menuOpen(),notebook:!!notebook?.open,photo:photo.active,game:miniGameActive||chase.active||!!quiz?.open,
      blocking:!!director?.blocking,encounter:!!encounters?.active,guide:guide.open});
  }
  function eventWorld():RuntimeEventWorld {
    return campusEventWorld({playerMoving:()=>movementRequested||playerMoved||movementIntent()||(eventPose.requested&&!eventPose.sitting),questChoice,timeOfDay:()=>sky.preset,distanceTo:questDistance,hasItem:id=>campus.progress.items.includes(id),npcPresent:id=>!!npcs&&!npcs.isAbsent(id)},npcDefinitions?.events??[],eventNpcAvailable);
  }
  function cancelCampusActivity() {
    eventQueue.clear();eventStorage?.discard();if(eventCommitted)campusEvents?.restore(eventCommitted);
    npcs?.cancelBorrowedMoves();eventQueue.push(campusEvents?.leave()??false);eventQueue.flush();
    npcs?.releaseAllBorrowed();eventInvite.hidden=true;host.classList.remove('has-campus-event-invite');director?.ui.eventObjective();eventWalkSeconds=0;
    scheduleNpcs(true);
  }
  eventInvite.addEventListener('click',e=>{
    const answer=(e.target as HTMLElement).closest<HTMLElement>('[data-event-answer]')?.dataset.eventAnswer;
    if(!answer || eventPaused() || !campusEvents?.activity || !eventNpcAvailable(campusEvents.activity.definition.host))return;
    if(answer==='yes' && activityPresentation(campusEvents)?.definition.steps.some(s=>s.kind==='rhythm'))sound.prepareActivity();
    eventQueue.push(campusEvents.respond(answer==='yes'));eventQueue.flush();eventInvite.hidden=true;
  });
  function updateCampusActivity(dt:number,time:number) {
    if(!campusEvents || !quests || !director || !npcs)return;
    const a=campusEvents.activity;
    if(a && (a.event.when!==sky.preset || (!eventPaused() && (questDistance(a.event.anchor)>(a.event.radius??25)+10 || !eventNpcAvailable(a.definition.host) ||
      (a.definition.prepare??[]).some(r=>r.kind==='move'&&!eventNpcAvailable(r.npc))))))cancelCampusActivity();
    const paused=eventPaused();
    eventWalkSeconds=paused?eventWalkSeconds:npcs.borrowedMoving?eventWalkSeconds+dt:0;
    if(eventMoveFailed || eventWalkSeconds>90) {eventMoveFailed=false;cancelCampusActivity();}
    eventQueue.flush(paused);
    eventQueue.push(campusEvents.update(dt,eventWorld(),paused || eventQueue.busy));eventQueue.flush(paused);
    if(eventMoveFailed){eventMoveFailed=false;cancelCampusActivity();return;}
    updateActivityPresentation(paused);
    if(!eventQueue.busy && !campusEvents.activity) {try{eventStorage?.commit();eventCommitted=campusEvents.snapshot();}catch{eventStorage?.discard();storageFailed();}}
    eventInvite.hidden=paused || campusEvents.activity?.phase!=='invited';
    host.classList.toggle('has-campus-event-invite',!eventInvite.hidden);
    director.ui.root.classList.toggle('event-paused',paused);
    void time;
  }
  function movementIntent() {
    return input.stick.lengthSq()>.01 || input.jump || ['w','a','s','d','arrowup','arrowdown','arrowleft','arrowright'].some(k=>input.keys.has(k)) || autoPath.length>0;
  }
  function updatePlayerPose() {
    const activity=campusEvents && activityPresentation(campusEvents),step=activity?.definition.steps[activity.step];
    const reach=step?.kind==='stay'?step.max:2;
    const near=!eventPose.target || questDistance(eventPose.target)<=reach;
    const moving=movementRequested||playerMoved||movementIntent()||!physics.onGround;
    eventPose.update(moving,near);
    if(rhythm && moving)cancelCampusActivity();
  }
  function startRhythm(command:RhythmCommand) {
    clearAuto();autoFollow=false;
    rhythmOwner=campusEvents?.activity?.instance;
    rhythm=sound.startRhythm(command);
    director?.ui.rhythm(rhythm.round.sample(),clapRhythm);
  }
  function stopRhythm() { sound.stopRhythm();rhythm=undefined;rhythmOwner=undefined;director?.ui.rhythm(null); }
  function clapRhythm(eventTimestamp?:number) {
    if(!rhythm)return;
    const at=rhythm.captureTime(eventTimestamp),paused=eventPaused();
    sound.prepareActivity();sound.updateRhythm(paused,at);
    if(!paused)rhythm.clap(at);
    director?.ui.rhythm(rhythm.round.sample(),clapRhythm);
  }
  function updateActivityPresentation(paused:boolean) {
    const activity=campusEvents && activityPresentation(campusEvents);
    director?.ui.stayProgress(activity?.stepProgress);
    if(rhythm) {
      if(!activity || activity.instance!==rhythmOwner){stopRhythm();}
      else {
        const frame=sound.updateRhythm(paused)!;
        director?.ui.rhythm(frame,clapRhythm);
        if(frame.done&&!paused) {
          const id=rhythm.round.spec.id,hits=frame.hits;stopRhythm();
          eventQueue.push(submitRhythmResult(campusEvents!,id,hits));eventQueue.flush();
        }
      }
    }
    if(!campusEvents?.activity && !eventQueue.busy){eventPose.request('stand');sound.stopRhythm();director?.ui.stayProgress();}
  }

  function updateEventSpeech(time:number) {
    const bubbles:Parameters<NonNullable<typeof director>['ui']['npcSpeech']>[0][number][]=[];
    for(const [id,line] of eventSpeech) {
      if(time>line.until){eventSpeech.delete(id);continue;}
      const npc=npcs?.get(id);if(!npc || !npc.root.visible || eventPaused() || npc.position.distanceTo(physics.position)>35)continue;
      const p=npc.position.clone().add(new T.Vector3(0,npc.monkey?1.4:2.5,0)).project(camera);
      if(p.z>=-1&&p.z<1&&Math.abs(p.x)<1&&Math.abs(p.y)<1)bubbles.push({id,text:`${npcs?.displayName(id)??id}：${line.text}`,x:(p.x+1)/2*innerWidth,y:(1-p.y)/2*innerHeight});
    }
    director?.ui.npcSpeech(bubbles);
  }

  const trackedQuest = () => quests?.list().find(v => v.definition.id === quests?.progress.tracked);
  const questerName = (near: string) => npcDefinitions?.npcs.find(n => `npc:${n.id}` === near)?.name ?? '委託人';
  const trackedGuide = (): GuideOverride | undefined => { const v = trackedQuest(); if (!v) return undefined; const target = trackedTarget(v); return { target, point: questPoint(target), title: v.definition.title, text: v.step?.text ?? `到${questerName(v.definition.accept.near)}面前按 E 接取任務。`, floor: target.startsWith('dest:') ? floorLabel(findDestination(world.destinations, target.slice(5))?.floorId ?? '') : undefined }; };
  /** The side quests the switch cycles through, in journal order; a tracked offer not accepted yet counts too. */
  const sideLines = () => (quests?.list() ?? []).filter(v => v.state?.status === 'active' || v.definition.id === quests?.progress.tracked).map(v => v.definition.id);
  const sideSummary = () => { const active = (quests?.list() ?? []).filter(v => v.state?.status === 'active'); return !active.length ? '' : active.length === 1 ? active[0].definition.title : `${active[0].definition.title} 等 ${active.length} 件`; };
  function focusLine(id: string | undefined) {
    if (!quests || id === quests.progress.tracked) return;
    if (!quests.track(id, questWorld())) return;
    clearAuto(); autoFollow = false; selectedInteraction = undefined; sound.cue('page');
    const v = trackedQuest();
    say(v ? `專注支線：${v.definition.title}。主線暫停，切回後接續。` : '回到主線。', 3000);
    syncFocus(); refreshNotebook();
  }
  /** Q: main → each side quest in progress → main. With nothing on the side there is nothing to switch to: the journal lists what can be taken. */
  function switchLine() {
    if (!quests || director?.blocking) return;
    const lines = sideLines();
    if (!lines.length) { say('目前沒有進行中的支線，可以在手帳挑一件。', 3500); openNotebook(); return; }
    focusLine(nextFocus(lines, quests.progress.tracked));
  }
  /** Tapping 主線｜支線 on the card; tapping 支線 again moves on to the next side quest. */
  function pickLine(which: 'main' | 'side') {
    if (director?.blocking) return; // Q waits for the end of a dialogue or chapter card; so does the card
    if (which === 'main') { focusLine(undefined); return; }
    if (!quests) return;
    const lines = sideLines();
    if (!lines.length) { say('目前沒有進行中的支線，可以在手帳挑一件。', 3500); openNotebook(); return; }
    focusLine(nextFocus(lines, quests.progress.tracked) ?? lines[0]);
  }
  /** Active-step objects and completed works share one field, once collision can resolve their floor. */
  function syncSpots() { if (routesValidated && quests && spotField) syncQuestWorks(spotField, activeSpotIds(quests.list()), quests, questWorld()); }
  let activityGuideTarget:string|undefined;
  function syncFocus() {
    const activityGuide=campusActivityGuide(campusEvents?.activity,questPoint);
    if(activityGuide?.target!==activityGuideTarget && autoFollow && (activityGuide || autoTarget===activityGuideTarget)){clearAuto();autoFollow=false;}
    activityGuideTarget=activityGuide?.target;
    guideOverride = activityGuide ?? trackedGuide(); director?.setGuideOverride(guideOverride, sideSummary());
    const tracked = trackedQuest();
    director?.ui.waitReason(!activityGuide && tracked && quests ? questWaitReason(quests, tracked.definition, questWorld()) : '');
    director?.ui.eventGuidance(activityGuide?toggleFollow:undefined,autoFollow&&autoTarget===activityGuide?.target,!!activityGuide&&questDistance(activityGuide.target)<=activityGuide.max);
    const target = guideOverride?.target ?? director?.goalTarget;
    npcs?.setFocus(target?.startsWith('npc:') ? target.slice(4) : undefined);
  }
  function questPoint(target: string): T.Vector3 | undefined {
    const [kind, id] = target.split(':');
    if (kind === 'npc') return npcs && !npcs.isAbsent(id) ? npcs.get(id)?.position.clone() : undefined;
    if (kind === 'spot') return spotField?.point(id);
    if (kind === 'dest') { const d = findDestination(world.destinations, id); return d ? new T.Vector3(...d.position) : undefined; }
    return npcs?.anchorPoint(id) ?? routes?.anchor(id);
  }
  const questDistance = (t: string) => {
    if (t.startsWith('dest:')) { const d = findDestination(world.destinations, t.slice(5)); return d ? destinationDistance(d.position, physics.position) : Infinity; }
    const p = questPoint(t); return p ? physics.position.distanceTo(p) : Infinity;
  };
  function questWorld(): QuestWorld & Facts & { npcPresent(npcId: string): boolean; questChoice(quest: string, step: string): string | undefined } {
    return { questChoice,
      flag: id => talk?.facts.flag(id) ?? (quests?.flag?.(id) === true || campus.progress.flags.includes(id) || director?.engine.progress.flags.includes(id) === true),
      hasItem: id => talk?.facts.hasItem(id) ?? (campus.progress.items.includes(id) || questGrants(quests).some(g => g.itemId === id)),
      stamps: () => talk?.facts.stamps() ?? campus.progress.stamps.length,
      count: id => campus.progress.counters[id] ?? 0,
      npcPresent: id => !!npcs && !npcs.isAbsent(id), npcPresentAt:(id,time)=>npcPresentAt(npcDefinitions?.npcs??[],id,time), distanceTo: questDistance, timeOfDay: () => sky.preset, photoCount: campus.progress.counters['photo.saved'] ?? 0, chapterDone: id => director?.engine.progress.done.includes(id) ?? false };
  }
  function notebookModel(): JournalModel {
    const names = new Map((npcDefinitions?.npcs ?? []).map(n => [n.id, n.name]));
    return {
      notice: storageNotice,
      clues: director ? campusClues(director.engine.progress.sideQuests, campusUi?.collectedStoryIds ?? [], director.engine.data) : [],
      tasks: (quests?.list() ?? []).map(v => {
        const availability = questAvailability(quests!, v.definition, questWorld());
        const unlocked = availability.state !== 'locked';
        const chapter = director?.engine.data.chapters.find(c => c.id === v.definition.accept.chapterDone)?.title;
        const target = v.step?.target ?? v.definition.accept.near;
        const missing = target.startsWith('npc:') && !questPoint(target);
        const qw = questWorld();
        const unavailable = availability.state === 'wrong-time' || availability.state === 'npc-away';
        const timeHint = questWaitReason(quests!, v.definition, qw);
        const name = names.get(target.slice(4)) ?? names.get(v.definition.npc) ?? v.definition.npc;
        return { id: v.definition.id, title: v.definition.title,
          subtitle: `${v.state?.status === 'completed' ? '已完成' : v.state ? '進行中' : unlocked ? unavailable ? '等待可接時段' : '可接任務' : '尚未解鎖'}・${zoneLabels[v.definition.zone] ?? '校園'}`,
          text: v.definition.description + '\n\n' + (v.step?.text ?? (v.state ? '這段故事已收進手帳。' : unlocked ? `到${name}面前按 E 接取任務。` : `完成「${chapter ?? '新生導覽'}」後，才能向${name}接取任務。`)) + (timeHint ? `\n\n${timeHint}` : ''),
          meta: `委託人物：${names.get(v.definition.npc) ?? v.definition.npc}\n紀念：${v.definition.reward}`,
          actions: v.state?.status === 'completed' ? [] : [...(unlocked || v.state ? [v.definition.id === quests?.progress.tracked ? { id: 'untrack', label: '追蹤中・切回主線' } : { id: 'track', label: '追蹤這件事' }] : []), { id: 'go', label: `帶我去找${v.step && !target.startsWith('npc:') ? '任務地點' : name}` },
            ...((v.step?.when || missing || timeHint) ? [{ id: 'time', label: '切換至人物出現時段' }] : [])] };
      }),
      events: [...(quests?.progress.journal ?? [])].reverse().map(e => ({ id: e.id, title: e.title, subtitle: `${new Date(e.at).toLocaleString('zh-TW')} · ${zoneLabels[e.zone] ?? '校園'}`, text: [e.text, e.choice && `我的選擇：${e.choice}`, e.result, e.reward && `獲得紀念：${e.reward}`].filter(Boolean).join('\n\n'), meta: names.get(e.npc) })),
      people: (npcDefinitions?.npcs ?? []).filter(n => campus.progress.talked.includes(n.id)).map(n => ({ id: n.id, title: n.name, subtitle: n.role, text: `在校園裡認識了${n.name}。\n\n${(quests?.progress.journal ?? []).filter(e => e.npc === n.id).map(e => e.result ?? e.text).join('\n\n') || '還有更多故事，等下次相遇慢慢聊。'}` })),
    };
  }
  function openNotebook() {
    if (director?.blocking || photo.active || quiz?.open) return;
    if (!quests) { say('校園手帳正在準備中。'); return; }
    setMenu(false); clearAuto(); autoFollow = false; notebook?.show(notebookModel());
  }
  notebook = new JournalView(host, (id, action) => {
    const v = quests?.list().find(v => v.definition.id === id); if (!v || !quests) return;
    if (action === 'track') focusLine(id);
    if (action === 'untrack') focusLine(undefined);
    if (action === 'time') {
      const target = v.step?.target ?? v.definition.accept.near;
      const npc = npcDefinitions?.npcs.find(n => `npc:${n.id}` === target);
      const preset = v.step?.when ?? (!v.state ? questAvailability(quests,v.definition,questWorld()).times[0] : undefined) ?? (['day','sunset','night'] as const).find(p => npc?.schedule[p]);
      if (preset && ['day','sunset','night'].includes(preset)) { sky.set(preset as Preset); get('[data-action=sky]').textContent = `${PRESET_LABEL[preset as Preset]} N`; scheduleNpcs(true); }
    }
    if (action === 'go' && v.state?.status !== 'completed') {
      notebook?.close();
      // A locked quest's giver can be visited, but not tracked: walking there does not make it the focus.
      if (quests.track(id, questWorld())) followQuest();
      else { const point = questPoint(v.definition.accept.near); if (point) walkToPoint(point, v.definition.title); else say('這位人物目前不在校園；請切換時段再來。', 5000); }
    }
    refreshNotebook();
  }, open => { input.release(); if (open) clearAuto(); });
  const pocketDistance = (point: T.Vector3 | undefined) => point ? `${Math.round(physics.position.distanceTo(point))} m` : '不在校園';
  refreshNotebook = () => {
    notebook?.update(notebookModel());
    syncFocus(); scheduleNpcs(true);
    const v = trackedQuest();
    pocket.hidden = !v?.step;
    if (v?.step) pocket.innerHTML = `<strong>${safe(v.definition.title)} <em data-pocket-distance>${pocketDistance(guideOverride?.point)}</em></strong><small>${safe(v.step.text)} · J 手帳</small>`;
  };
  /** Said once the step is really done: the card has already moved on, so a tap of feedback is all that is left. */
  function questStepDone(q: QuestDefinition, next: QuestStep | undefined) {
    if (next) { director?.ui.toast('item', `${q.title}：完成一步`, `接下來：${next.text}`); sound.cue('chime'); return; }
    autoFollow = false;
    director?.ui.toast('recommendation', `完成支線「${q.title}」`, `${q.reward}。${quests ? nextQuestRecommendation(q, quests, questWorld(), z => zoneLabels[z] ?? z) : ''}`); sound.cue('fanfare');
    // The queued toast waits for the result dialogue; it never changes time or accepts a quest.
  }
  async function acceptSideQuest(id: string) {
    const ui = director?.ui;
    if (!quests || !ui || director?.blocking || !quests.accept(id, questWorld())) return;
    const q = quests.data.quests.find(q => q.id === id)!;
    // The NPC asks first: a first step at this NPC is the request itself, otherwise accept.lines carries it.
    if (q.steps[0].target === q.accept.near) { await sideQuestDialogue(id); return; }
    clearAuto(); npcs?.setTalking(q.npc); campus.talked(q.npc); ui.begin();
    try { await ui.say(q.accept.lines ?? [{ who: q.npc, text: q.description }]); }
    finally { npcs?.setTalking(undefined); ui.end(); refreshNotebook(); }
  }
  async function sideQuestDialogue(id: string) {
    let v = quests?.list().find(v => v.definition.id === id);
    const ui = director?.ui;
    if (!v?.step || !quests || !ui || director?.blocking || questDistance(v.step.target) > (v.step.radius ?? 4) || (v.step.when && v.step.when !== sky.preset)) return;
    // Pause only the NPC this step actually targets; retain its path and story ownership.
    const targetNpc = v.step.target.startsWith('npc:') ? v.step.target.slice(4) : undefined;
    if (targetNpc) { npcs?.setTalking(targetNpc); campus.talked(targetNpc); }
    clearAuto(); ui.begin();
    try {
      while(v?.step) {
        const previousStep=v.step;
        let advanced=false;
        await ui.say(v.step.lines ?? [{ who: targetNpc ?? 'player', text: v.step.text }], !!v.step.choices?.length);
        if (v.step.choices?.length) {
          const options = v.step.choices;
          const choice = await ui.choose(options.map(c => ({ text: c.label, next: c.id })));
          const c = options[choice];
          if (c) {
            advanced=quests.choose(id,c.id,questWorld());
            if (advanced) await ui.say([{who:targetNpc ?? 'player',text:c.result}]);
            else say('對象已離開互動範圍，這次選擇尚未提交；請靠近後再按 E 繼續。',6000);
          }
        } else { advanced=quests.interact(id,questWorld()); if(!advanced)say(v.step.kind === 'photo' ? '請在這個地點拍一張照片，再繼續。' : '請再靠近目標，或切換至指定時段。'); }
        const next=quests.list().find(v=>v.definition.id===id);
        if(!advanced || !continueQuestAtTarget(previousStep,next?.step,questWorld()))break;
        v=next;
      }
    } finally { if (targetNpc) npcs?.setTalking(undefined); ui.end(); refreshNotebook(); }
  }

  // ---- story, NPCs and outdoor routes --------------------------------------------------------
  let routes: OutdoorRoutes | undefined, npcs: NpcManager | undefined, director: StoryDirector | undefined, storyStarted = false, talk: TalkDirector | undefined;
  let scheduledKey = '', album: Album | undefined;
  /** Re-place NPCs when the light preset or story progress changes (spec-v4 §15.1). */
  function scheduleNpcs(force = false) {
    if (!npcs || !director || !routesValidated) return;
    const p = director.engine.progress, key = `${sky.preset}|${p.done.length}|${JSON.stringify(p.npcAt)}`;
    if (!force && key === scheduledKey) return;
    scheduledKey = key;
    npcs.schedule(sky.preset as Preset, director.engine.finished, p.npcAt, physics.position, questWorld());
    syncSpots();
    album?.evaluate(); // chapters count toward achievements
  }
  function startStoryWhenReady() {
    if(sceneLoading || !director || storyStarted || !routesValidated || !(opts.story || (walking && !overview)))return;
    storyStarted=true;director.start(placeTour);scheduleNpcs(true);
  }
  /** Once both the path network and the landmark collision exist, remove path edges the real world blocks. */
  let routesValidated = false;
  function validateRoutes() {
    if (!alive || routesValidated || !routes || !landmarksReady || !propsReady || !legacyPropsReady || !bikeStandReady) return;
    const removed = validatePaths(routes, (p, q, r) => physics.sweep(p, q, r), (x, z) => terrainRef ? terrainRef.heightAt(x, z) : -1e9);
    routesValidated = true;
    console.info('outdoor paths blocked by geometry:', removed);
    syncSpots();
    startStoryWhenReady();
  }
  const planRoute = (to: T.Vector3) => {
    if (!routesValidated) return [];
    const clear = sightLine((a, b, r) => physics.sweep(a, b, r)), around = (path: T.Vector3[]) => obstacleField.route(path, bike.riding ? {radius:.38,halfLength:.57} : .30, clear, (x,z,referenceY) => physics.supportAt(x,z,referenceY));
    const direct = around(plan(physics.position, to, navigation, routes, clear));
    if (direct.length) return direct;
    // A long navmesh leg across a planted plaza can exhaust the local detour; the path network has shorter legs.
    const outdoor = routes?.path(physics.position, to) ?? [];
    const network = outdoor.length ? around(outdoor) : [];
    if (network.length || !routes || !navigation) return network;
    // Either end may sit off the network with no straight link to it (a door beside a building): navmesh to and from the nearest stops, network between.
    for (const start of routes.stopsNear(physics.position, 3)) for (const stop of routes.stopsNear(to, 3)) {
      const lead = navigation.findPath(physics.position, start), middle = lead.length ? routes.path(start, stop) : [], tail = middle.length ? navigation.findPath(stop, to) : [];
      const joined = tail.length ? around([...lead, ...middle.slice(1, -1), ...tail]) : [];
      if (joined.length) return joined;
    }
    return [];
  };
  /** Auto-walk to the current quest goal: indoor navmesh where it reaches, else the outdoor path network. */
  function followQuest() {
    if(!routesValidated) { say('場景碰撞與步道仍在準備，請稍候再開始帶路。');return; }
    syncFocus(); // A G press can arrive between respond() and the next animation frame.
    routes?.avoid.splice(0); // stuck spots only matter within one auto-walk
    const activityGuide=campusActivityGuide(campusEvents?.activity,questPoint);
    if(activityGuide && questDistance(activityGuide.target)<=activityGuide.max){clearAuto();autoFollow=false;say('已抵達活動地點。',2500);return;}
    const tracked = trackedQuest(), target = activityGuide?.target ?? (tracked ? trackedTarget(tracked) : director?.goalTarget ?? undefined);
    const goal = target ? walkGoal(target) : undefined;
    if(tracked && !goal) { autoFollow = false; say(target?.startsWith('npc:') ? '這位人物目前不在校園；請在手帳選擇『切換至人物出現時段』後再前往。' : '這個地點目前還沒有路線。',6000);return; }
    if (!goal || director?.blocking) { autoFollow = false; say('目前沒有需要前往的地點。', 2500); return; }
    autoFollow = walkToPoint(goal, activityGuide?.title ?? tracked?.definition.title ?? (director!.objectiveText || '任務地點'));
    if (autoFollow) autoTarget = target;
  }
  /** G and the objective card: set off, or call off the walk under way. */
  function toggleFollow() {
    if (autoPath.length && autoDestination?.id === 'quest' && autoFollow) { clearAuto(); autoFollow = false; say('已停止帶路；再按一次可繼續。', 2500); return; }
    followQuest();
  }
  /** Where a walk heads for a target: a walking person's destination, or the target itself. */
  function walkGoal(target: string) {
    const [kind, id] = target.split(':');
    if (kind === 'spot') return spotField?.stand(id);
    if (kind !== 'npc') return questPoint(target) ?? director?.pointOf(target);
    const n = npcs && !npcs.isAbsent(id) ? npcs.get(id) : undefined;
    return n ? (n.path.at(-1) ?? n.position).clone() : undefined;
  }
  function walkToPoint(goal: T.Vector3, label: string) {
    const p = planRoute(goal);
    if (!p.length) { say('找不到通往任務地點的路，請跟著金色箭頭走。', 4000); return false; }
    clearAuto(); autoPath = p; pathIndex = 0; replans = 0; progressTime = performance.now(); progressPosition.copy(physics.position);
    autoDestination = { id: 'quest', label, position: goal.toArray() as [number, number, number], buildingId: 'quest', floorId: 'quest' } as WalkDestination;
    chooseMode(false); drawRoute(p); say(`自動前往：${autoDestination.label}（再按 G 或方向鍵可中斷）`, 4000);
    return true;
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
  startupJobs.push((async () => {
    try {
      const [graph, zones, story, npcData, collection, quizData] = await Promise.all([
        OutdoorRoutes.load(asset('data/walkthrough/outdoor-graph.json')),
        loadJson<StoryZones>('data/story-zones.json', '故事地點'),
        loadJson<StoryData>('data/chapters.json', '故事章節'),
        loadJson<NpcData>('data/npcs.json', '校園人物').catch(e => { console.warn('npcs', e); return undefined; }),
        loadJson<CollectionData>('data/collection.json', '收集資料').catch(e => { console.warn('collection', e); return undefined; }),
        loadJson<{ questions: Question[] }>('data/quiz.json', '校史題庫').catch(e => { console.warn('quiz', e); return undefined; }),
      ]);
      collectionData = collection;
      if (!alive) return;
      routes = graph;
      zoneLabels = Object.fromEntries(Object.entries(zones.zones).map(([id,z]) => [id,z.label]));
      validateRoutes();
      npcs = new NpcManager(zones, routes, terrainRef, asset, npcData); scene.add(npcs.group);
      const characterWarmupAt=performance.now();
      startupJobs.push(npcs.prepareWarmupSamples().then(samples=>{
        characterWarmupPrepareMs=performance.now()-characterWarmupAt;
        if(!alive){samples.dispose();return;}characterWarmup=samples;
      }));
      startupJobs.push((async()=>{try {
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
      finally { propsReady=true;validateRoutes(); } })());
      npcDefinitions = npcData;
      npcs.setCollision((id,a,b,r,h) => physics.sweepActor(id,a,b,r,h), (x,z,y) => physics.supportAt(x,z,y));
      npcs.cap = NPC_CAP[tier];
      await npcs.load();
      if (!alive) return;
      director = new StoryDirector({
        host, scene, camera, player: () => physics.position, destinations: world.destinations,
        navPath: (_a, b) => planRoute(b), routeSurface, routes, npcs, zones,
        timeOfDay: () => sky.preset, setSky: p => { if (p === 'day' || p === 'sunset' || p === 'night') { sky.set(p); get('[data-action=sky]').textContent = `${PRESET_LABEL[p]} N`; } },
        cue: id => sound.cue(id), say, teleport: teleportTo, autoWalking: () => autoPath.length > 0, questsLoading: () => featureStatus.quests === 'loading',
      }, story);
      director.ui.onObjectiveClick(toggleFollow, pickLine);
      director.ui.player = () => {
        const l = look(), pal = PALETTES[l.body][l.palette].look;
        return { name: l.nickname || '新生', portrait: { hair: pal.hair, hairStyle: l.body === 'f' ? 'ponytail' : 'messy', top: pal.top, topStyle: l.body === 'f' ? 'hoodie' : 'tee', accessory: l.body === 'f' ? 'hairclip' : undefined } };
      };
      if (npcData && collection) {
        const n = npcs;
        talk = new TalkDirector(npcData, collection, director.ui, campus, director.engine, {
          nearest: (p, r) => n.nearest(p, r), position: id => n.get(id)?.position, present: id => !n.isAbsent(id) && !n.isBorrowed(id), playerPosition: () => physics.position, setTalking: id => n.setTalking(id),
          timeOfDay: () => sky.preset, cue: id => sound.cue(id), toast: t => director!.ui.toast('item', t),
          play: async game => {
            miniGameActive=true;
            try {
              const won = await (game === 'history-quiz' ? playQuiz(quizData?.questions ?? []) : game === 'monkey-chase' ? playChase() : playSunset());
              campus.game(game, won ? 1 : 0, won); album?.evaluate();return won;
            } finally { miniGameActive=false; }
          },
        }, () => quests);
      }
      if (collection) {
        const ui = director.ui, eng = director.engine, n = npcs;
        album = new Album(collection, npcData, campus, {
          place: at => n.anchorPoint(at), chaptersDone: () => eng.progress.done.length,
          toast: (k, t, sub) => ui.toast(k, t, sub), cue: id => sound.cue(id),
          storiesFound: () => campusUi?.storyProgress ?? { found: 0, total: 8 },
        }, () => quests);
        album.evaluate();
        renderAlbum = () => { get('[data-pane=album]').innerHTML = album!.html(); };
      }
      scheduleNpcs(true);
      const questReady = (async()=>{
        try {
          const questData = await loadJson<QuestData>('data/quests.json','支線任務').catch(e=>{ featureStatus.quests='degraded';console.warn('quests',e); return bundledQuests as QuestData; });
          if(!alive)return;
          quests=new QuestEngine(questData,{onChange:()=>refreshNotebook(),onStep:questStepDone,onStorageError:()=>{storageNotice='目前無法保存進度；請勿關閉此頁，並檢查瀏覽器儲存空間。';say(storageNotice,9000);}});
          try { eventStorage=new EventCompletionStorage(localStorage); } catch { storageFailed(); }
          campusEvents=new CampusEventEngine(npcDefinitions?.events??[],{storage:eventStorage,onStorageError:storageFailed});
          eventCommitted=campusEvents.snapshot();
          quests.importLegacy(director!.engine.progress.done,campus.progress.talked);
          quests.settle(questWorld());
          spotField=new QuestSpotField({spots:questData.spots??{},support:(x,z,y)=>physics.supportAt(x,z,y),terrain:(x,z)=>terrainRef?terrainRef.heightAt(x,z):-.055,alive:()=>alive,loadProp:kind=>loadPropGeometry(new GLTFLoader().setMeshoptDecoder(MeshoptDecoder),asset,kind)});
          scene.add(spotField.group);
          if(featureStatus.quests!=='degraded')featureStatus.quests='ready';refreshNotebook();
          if(lockedSaves().length){storageNotice='這份進度來自較新的版本，已安全保留；請重新整理頁面。在那之前，這次的變更不會保存。';say(storageNotice,0);}
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
      await questReady;startStoryWhenReady();
    } catch (e) { if (!alive) return; console.warn('story', e); say('故事模式暫時無法載入；仍可自由探索。', 4000); }
  })());

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
  async function playChase() {
    cancelCampusActivity();npcs?.reserveForGame('m3-thief',true);
    try { return await chase.play(); }
    finally { npcs?.reserveForGame('m3-thief',false);scheduleNpcs(true); }
  }
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
  let journalAt = 0, journalKey = '', qaRing: ActorBody[] = [];
  let lastTime = performance.now(), frameId = 0, lastUi = 0, lastShadowOverview: boolean | undefined, jumped = false;
  /** A walking person's destination moved: plan again rather than walk to where they used to be headed. Checked about once a second. */
  function followMovedTarget(time: number) {
    if (!autoTarget?.startsWith('npc:') || time - autoCheckAt < 1000) return;
    autoCheckAt = time;
    if (npcs?.isAbsent(autoTarget.slice(4))) { clearAuto(); autoFollow = false; say('這位人物目前不在校園；請在手帳選擇『切換至人物出現時段』後再前往。', 5000); return; }
    const goal = walkGoal(autoTarget), end = autoPath.at(-1);
    if (!goal || !end || Math.hypot(goal.x - end.x, goal.z - end.z) <= 2) return;
    const p = planRoute(goal);
    if (p.length) { autoPath = p; pathIndex = 0; drawRoute(p); }
  }
  /** Close enough to talk to the person being walked to: stop short rather than lean on them. */
  const atAutoPerson = () => { if (!autoTarget?.startsWith('npc:')) return false; const n = npcs?.get(autoTarget.slice(4)); return !!n && Math.hypot(n.position.x - physics.position.x, n.position.z - physics.position.z) < NPC_ARRIVE && Math.abs(n.position.y - physics.position.y) < 1.2; };
  /** At the end of a walk, turn to what the walk was for, so it is in the picture without the player hunting for it. */
  function faceTarget(target: string | undefined) {
    if (!target) return;
    const [kind, id] = target.split(':'), door = kind === 'dest' ? world.doors.find(d => d.id === findDestination(world.destinations, id)?.doorId) : undefined;
    const at = kind === 'spot' ? spotField?.look(id) : door?.position ?? questPoint(target);
    if (!at) return;
    // A little off-centre for anything close, or the player's own back would hide it; a far view stays square on.
    const p = physics.position, yaw = Math.atan2(-(at.x - p.x), -(at.z - p.z)) + (Math.hypot(at.x - p.x, at.z - p.z) < 6 ? ARRIVAL_OFFSET : 0);
    avatar.face(yaw); rig.yaw = yaw;
  }
  function steer(time: number) {
    input.direction(rig.forward, direction);
    if (autoPath.length && pathIndex < autoPath.length) {
      followMovedTarget(time);
      const step = followRoute(autoPath, pathIndex, physics.position, direction);
      pathIndex = step.index;
      if (atAutoPerson()) { step.arrived = true; direction.set(0, 0, 0); }
      if (step.arrived) {
        if (trackedQuest()?.step?.kind === 'photo') autoFollow = false; // the walk ends at the viewpoint: the shot is the player's
        const arrivalId=autoDestination?.id;
        faceTarget(autoTarget);
        const label = autoDestination?.label, indoor = !['quest', 'outdoor'].includes(autoDestination?.floorId ?? ''); clearAuto(); direction.set(0, 0, 0);
        if ((arrivalId==='tunnel-west'||arrivalId==='TUNNEL'||arrivalId==='tunnel-east') && uiPlacements?.tunnel && terrainRef) {
          const profile=fullTunnelProfile(uiPlacements.tunnel,(x,z)=>terrainRef!.heightAt(x,z));
          rig.yaw=arrivalId==='tunnel-east'?profile.eastYaw:profile.westYaw;rig.pitch=-.08;rig.distance=4.6;rig.snap(physics.position);
        }
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
            else { clearAuto(); autoFollow = false; say('人物暫時無法前進，已停止帶路；可手動調整位置後再試。'); }
          } else { clearAuto(); autoFollow = false; say('人物暫時無法前進，已停止帶路；可手動調整位置後再試。'); }
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
    guide.update(); input.mode = director?.ui.dialogueOpen ? 'dialogue' : guide.open || notebook?.open || menuOpen() || quiz?.open ? 'menu' : photo.active ? 'photo' : 'walk';
    scheduleNpcs();
    const pausedEvents = !walking || overview || !!notebook?.open || menuOpen() || !!director?.blocking || photo.active || !!quiz?.open || chase.active || autoPath.length > 0;
    encounters?.update(dt, encounterWorld(), pausedEvents || !!campusEvents?.activity || eventQueue.busy);
    animateEncounter(dt, time, pausedEvents);
    if (!notebook?.open && !menuOpen() && !director?.blocking) quests?.update(questWorld());
    if (walking && !overview && !recoveryFailed) {
      if (photo.active || notebook?.open || menuOpen()) direction.set(0, 0, 0); else steer(time);
      // Dialogue and chapter cards hold the player; Space advances like E.
      if (director?.blocking) { direction.set(0, 0, 0); if (input.takeJump()) director.press(); }
      // A dialogue ends the walk under way (its goal may be out of date by the end); G's walk resumes to whatever is next.
      if (director?.blocking && autoPath.length) clearAuto();
      if (walkResumes({ wasBlocking, blocking: !!director?.blocking, follow: autoFollow, walking: autoPath.length > 0 })) followQuest();
      wasBlocking = !!director?.blocking;
      const jump = input.takeJump() && !bike.riding; if (jump) {movementRequested=true;clearAuto(true);}
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
    playerMoved=speed>.05 || Math.abs(physics.position.y-previous.y)>.03;
    updatePlayerPose();
    avatar.update(dt, { foot: physics.position, onGround: physics.onGround, airborneFor: physics.airborneFor, speed, intendedSpeed: physics.intendedSpeed, heading: direction, jumped, runSpeed: RUN_SPEED, surfaceHeight, supportAt: routeSurface.support });
    if (bike.riding && !avatar.riding) { bike.riding = false; physics.setRiding(false, avatar.heading); say('前後輪無法同時貼住路面，已下車步行。', 2500); }
    animateDoors(world.doors, physics.position, dt);
    physics.setCameraObstacles(doorCameraObstacles(world.doors,physics.position));
    if(routesValidated)npcs?.update(dt, physics.position,eventPaused());
    physics.setActors([...(npcs?.bodies(physics.position) ?? []),...encounterScene.bodies(),...(spotField?.bodies() ?? []),...qaRing]);
    tufts?.update(physics.position);
    chase.update(dt, physics.position);
    // Waits for the tour placement: the player still stands on the default spawn (the arcade) until then.
    if (!overview && walking && storyStarted) album?.update(time, physics.position);
    updateCampusActivity(dt,time);movementRequested=false;
    syncFocus();
    if (guideOverride && !pocket.hidden && time - pocketAt > 500) {
      pocketAt = time;
      const label = pocket.querySelector<HTMLElement>('[data-pocket-distance]');
      if (label) setText(label, pocketDistance(guideOverride.point));
    }
    // The journal keeps up while it is open: a change of time or of the chapters changes what it says. Rebuilt only on a real change.
    if (notebook?.open && time - journalAt > 1000) {
      journalAt = time;
      const model = notebookModel(), key = JSON.stringify(model);
      if (key !== journalKey) { journalKey = key; notebook.update(model); }
    }
    if (!overview && storyStarted && !photo.active && !notebook?.open && !menuOpen()) director?.update(time, dt);
    else director?.ui.badge(null);
    if(eventPose.sitting || rhythm){director?.ui.badge(null);director?.ui.pointer(null);}
    updateEventSpeech(time);
    // This is exactly the candidate that E and the touch button will execute.
    if (director) {
      const candidates=interactionCandidates();
      if(pickedByHand && !candidates.some(c=>c.id===selectedInteraction))pickedByHand=false;
      const chosen=selectInteraction(candidates,selectedInteraction,pickedByHand);
      shownInteractions=candidates; selectedInteraction=chosen?.id;
      const badges:Parameters<typeof director.ui.npcBadges>[0][number][]=[];
      if(quests && npcs && !eventPose.sitting && !rhythm && !overview && walking && !director.blocking && !menuOpen() && !notebook?.open && !photo.active && !guide.open) {
        for(const [id,status] of npcQuestStatuses(quests,questWorld())) {
          const npc=npcs.get(id);if(!npc || npcs.isAbsent(id) || !npc.root.visible || npc.position.distanceTo(physics.position)>25)continue;
          const point=npc.position.clone().add(new T.Vector3(0,2.5,0)).project(camera);
          if(point.z>=-1 && point.z<1 && Math.abs(point.x)<1 && Math.abs(point.y)<1)badges.push({id,status,name:npcs.displayName(id)??id,x:(point.x+1)/2*innerWidth+((guideOverride?.target??director.goalTarget)===`npc:${id}`?28:0),y:(1-point.y)/2*innerHeight});
        }
      }
      director.ui.npcBadges(badges);
      const wanted: TipId[] = [];
      if (candidates.some(c => c.id.startsWith('accept:'))) wanted.push('accept');
      if (candidates.length > 1) wanted.push('switch');
      if (candidates.some(c => c.id === 'bike')) wanted.push('bike');
      if (trackedQuest()?.step?.kind === 'photo') wanted.push('photo');
      if (time > tipsFrom && (guideOverride?.point ?? director.goal())) wanted.push('goal');
      if (time > tipsFrom && sideLines().length) wanted.push('line');
      tips.update(time, overview || !walking || !get('.walk-welcome').hidden || guide.open || !!director.blocking || menuOpen() || !!notebook?.open || photo.active || !!quiz?.open, wanted);
      const anchor = chosen ?? candidates[0];
      if(anchor && !director.blocking) {
        const projected=anchor.point.clone();projected.y+=2;projected.project(camera);
        director.ui.hint({x:projected.z<1?(projected.x+1)/2*innerWidth:innerWidth/2,y:projected.z<1?(1-projected.y)/2*innerHeight:innerHeight*.55,text:chosen ? `E ${chosen.label}` : anchor.label,
          choices:candidates.length>1 || candidates.some(c=>c.disabled)?candidates:undefined,selectedId:chosen?.id ?? '',onSelect:id=>{const row=candidates.find(c=>c.id===id);if(row)executeInteraction(row);}});
      } else director.ui.hint(null);
      setText(get('[data-action=door]'),chosen?`${chosen.label} E`:'互動 E');

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
    npcs?.updateCamera(camera.position);
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
    /** Names what the camera sees at a screen point (NDC), including back faces. QA only. */
    qaPick: (nx: number, ny: number) => {
      if (!QA) return [];
      const ray = new T.Raycaster(); ray.setFromCamera(new T.Vector2(nx, ny), camera);
      const hulls: T.Intersection[] = [];
      scene.traverseVisible(o => { if (o.userData.outlineHull) T.Mesh.prototype.raycast.call(o as T.Mesh, ray, hulls); });
      return [...hulls.sort((a, b) => a.distance - b.distance).slice(0, 3), ...ray.intersectObjects(scene.children, true).filter(h => h.object.visible && !(h.object instanceof T.Sprite)).slice(0, 3)].map(h => {
        let top: T.Object3D = h.object; const trail = [h.object.name]; while (top.parent && top.parent !== scene) { top = top.parent; if (top.name) trail.push(top.name); }
        const m = [h.object as T.Mesh].flatMap(o => o.material as T.Material)[0];
        return { trail: trail.slice(0, 4), landmark: top.userData.landmarkId, distance: +h.distance.toFixed(2), point: h.point.toArray().map(v => +v.toFixed(2)), hull: !!h.object.userData.outlineHull, side: m?.side, color: (m as T.MeshBasicMaterial)?.color?.getHexString?.(), triangle: h.face ? [h.face.a, h.face.b, h.face.c].map(i => new T.Vector3().fromBufferAttribute((h.object as T.Mesh).geometry.getAttribute('position') as T.BufferAttribute, i).applyMatrix4(h.object.matrixWorld).toArray().map(v => +v.toFixed(1))) : undefined };
      });
    },
    qaObstacles: (x: number, z: number, r: number) => QA ? obstacleField.obstacles.filter(o => Math.hypot(o.center[0] - x, o.center[2] - z) < r + Math.max(o.half[0], o.half[2])).map(o => ({ id: o.id, shape: o.shape, center: o.center, half: o.half, yaw: o.yaw ?? 0 })) : [],
    /** QA only: the navmesh path between two points, as [x, y, z] triples. */
    qaNavPath: (a: number[], b: number[]) => QA && navigation ? navigation.findPath(new T.Vector3(a[0], a[1], a[2]), new T.Vector3(b[0], b[1], b[2])).map(p => p.toArray()) : [],
    qaPlace: (x: number, z: number, y?: number, face?: [number, number]) => QA ? teleportTo(new T.Vector3(x, y ?? 0, z), face && new T.Vector3(face[0], y ?? 0, face[1]), y !== undefined) : false,
    plan(to?: string) {
      const g = to ? walkGoal(to) : director?.goal(); const nav = g && navigation ? navigation.findPath(physics.position, g).length : -1; const out = g && routes ? routes.path(physics.position, g).length : -1;
      const clear = sightLine((a, b, r) => physics.sweep(a, b, r)), raw = g ? plan(physics.position, g, navigation, routes, clear) : [], support = (x: number, z: number, y: number) => physics.supportAt(x, z, y);
      let failsAt = -1; for (let k = 2; k <= raw.length && failsAt < 0; k++) if (!obstacleField.route(raw.slice(0, k), .30, clear, support).length) failsAt = k - 1;
      return { goal: g?.toArray(), plan: g ? planRoute(g).length : -1, nav, outdoor: out, nearest: routes ? routes.nearest(physics.position) : -1, raw: raw.length, failsAt, failing: failsAt > 0 ? [raw[failsAt - 1].toArray(), raw[failsAt].toArray()] : undefined };
    },
    get autoFollow() { return autoFollow; },
    /** QA only: a ring of colliders round the player, to force an auto-walk to give up; false lifts it. */
    qaRing: (on: boolean) => {
      if (!QA) return false;
      qaRing = on ? Array.from({ length: 10 }, (_, i) => ({ id: `qa-ring:${i}`, position: physics.position.clone().add(new T.Vector3(Math.cos(i / 10 * Math.PI * 2) * 1.5, 0, Math.sin(i / 10 * Math.PI * 2) * 1.5)), radius: .55, height: 2.4 })) : [];
      return true;
    },
    /** QA only: put the save on one step of one quest, nothing else active (sets the scene; playing it needs real input). */
    qaSetQuest: (id: string, step: number) => {
      if (!QA || !quests) return false;
      for (const key of Object.keys(quests.progress.quests)) delete quests.progress.quests[key];
      quests.progress.quests[id] = { status: 'active', step, choices: {}, photoBaseline: 0 };
      return quests.track(id);
    },
    get questSpots() { return spotField?.shown.map(id => ({ id, position: spotField!.point(id)!.toArray(), stand: spotField!.stand(id)!.toArray(), bodies: spotField!.bodies().filter(b => b.id.startsWith(`spot:${id}:`)).length })) ?? []; },
    /** QA only: is what this target means on screen and unobstructed? Rays at three heights; nothing but it may come before it. */
    qaTargetView: (target: string) => {
      if (!QA) return undefined;
      const [kind, id] = target.split(':');
      const object: T.Object3D | undefined = kind === 'spot' ? spotField?.mesh(id) : kind === 'npc' ? npcs?.get(id)?.root : kind === 'dest' ? world.doors.find(d => d.id === findDestination(world.destinations, id)?.doorId)?.group : undefined;
      const point = kind === 'npc' ? npcs?.get(id)?.position.clone() : questPoint(target);
      if (!point) return { found: false, reason: 'no point' };
      const shown = (o: T.Object3D | null) => { for (; o; o = o.parent) if (!o.visible) return false; return true; };
      const box = object ? new T.Box3().setFromObject(object) : undefined, heights = box && !box.isEmpty() ? [.2, .5, .8].map(t => box.min.y + (box.max.y - box.min.y) * t) : [point.y + 1];
      const rays = heights.map(y => {
        const at = new T.Vector3(box && !box.isEmpty() ? (box.min.x + box.max.x) / 2 : point.x, y, box && !box.isEmpty() ? (box.min.z + box.max.z) / 2 : point.z), ndc = at.clone().project(camera);
        const inFrame = ndc.z < 1 && Math.abs(ndc.x) < .98 && Math.abs(ndc.y) < .98;
        const ray = new T.Raycaster(camera.position, at.clone().sub(camera.position).normalize());
        const isAvatar = (o: T.Object3D | null) => { for (; o; o = o.parent) if (o === avatar.root) return true; return false; };
        const hits = ray.intersectObjects(scene.children, true).filter(h => shown(h.object) && !h.object.userData.outlineHull && !(h.object instanceof T.Sprite) && !isAvatar(h.object) && ![(h.object as T.Mesh).material].flat().some(m => m?.transparent) && !h.object.name.startsWith('Story route'));
        const first = hits[0], targetDistance = camera.position.distanceTo(at); let mine = !first || first.distance > targetDistance - .15; if (first && object) for (let o: T.Object3D | null = first.object; o; o = o.parent) if (o === object) mine = true;
        let top: T.Object3D | null = first?.object ?? null; const trail: string[] = []; for (; top && trail.length < 3; top = top.parent) if (top.name) trail.push(top.name);
        return { ndc: [+ndc.x.toFixed(3), +ndc.y.toFixed(3)], inFrame, mine, first: trail.join(' < '), firstDistance: first ? +first.distance.toFixed(2) : null, targetDistance: +camera.position.distanceTo(at).toFixed(2) };
      });
      return { found: !!object, visibleFlag: object ? shown(object) : false, rays, seen: rays.some(r => r.inFrame && r.mine), inFrame: rays.some(r => r.inFrame), distance: +physics.position.distanceTo(point).toFixed(2) };
    },
    get steering() { return { direction: direction.toArray(), intended: physics.intendedSpeed, pathIndex, target: autoPath[pathIndex]?.toArray(), onGround: physics.onGround, blocking: director?.blocking ?? false }; },
    get story() { return director ? { active: director.engine.active?.id, done: director.engine.progress.done, flags: director.engine.progress.flags, fired: director.engine.progress.fired, dialogue: director.ui.dialogueOpen, blocking: director.blocking } : undefined; },
    get npcs() { return npcs ? npcs.ids().map(id => ({ id, position: npcs!.get(id)?.position.toArray(), absent: npcs!.isAbsent(id), visible: npcs!.get(id)?.root.visible, target: npcs!.targets.get(id)?.toArray() })) : []; },
    get talk() { return talk ? { busy: talk.talking, mode: input.mode, choices: [...host.querySelectorAll('.q-choices:not([hidden]) button')].map(b => b.textContent), line: host.querySelector('.q-dialog:not([hidden]) .text')?.textContent ?? null, name: host.querySelector('.q-dialog:not([hidden]) .name')?.textContent ?? null } : undefined; },
    get campus() { return campus.progress; },
    get encounterClock() { return encounters?.diagnostics; },
    get encounter() { const a = encounters?.active; return a ? { id:a.definition.id,phase:a.phase,remaining:a.remaining,target:encounterTarget().toArray(),hits:encounterHits } : undefined; },
    qaEncounter: (id:string,failScene=false) => { if(!QA)return false;failEncounterScene=failScene;return encounters?.offer(id); },
    get journal() { return quests?.progress; },
    get interaction() { const c=selectedCandidate();return {selected:c?.id,label:c?.label,candidates:interactionCandidates().map(x=>({id:x.id,label:x.label,distance:x.distance}))}; },
    get questList() { return quests?.list(); },
    get guideBeacon() { return director?.beaconState; },
    get guide() { return guideOverride && { target: guideOverride.target, point: guideOverride.point?.toArray() }; },
    get focus() { const e = host.querySelector('.q-objective'); return { line: guideOverride ? 'side' : 'main', quest: quests?.progress.tracked, shown: !!e && !(e as HTMLElement).hidden, small: e?.querySelector('small')?.textContent, text: e?.querySelector('strong')?.textContent, distance: e?.querySelector('.q-dist')?.textContent, other: e?.querySelector('.q-other')?.textContent, hint: e?.querySelector('em')?.textContent, goal: (guideOverride?.point ?? director?.goal())?.toArray() }; },
    /** QA only: hide scene groups by name prefix to measure their draw cost. */
    qaHide: (prefix: string, hidden = true) => { if (!QA) return 0; let n = 0; scene.traverse(o => { if (o.name.startsWith(prefix)) { o.visible = !hidden; n++; } }); return n; },
    get photo() { return { active: photo.active, yaw: photo.yaw, pitch: photo.pitch, goal: host.querySelector('.photo-goal:not([hidden])')?.textContent ?? null, sun: sky.sunDir.toArray() }; },
    get campusEvents() { return {seated:eventPose.sitting,rhythm:rhythm?.round.sample(),activity:campusEvents?.activity,progress:campusEvents?.snapshot(),commandsPending:eventQueue.busy}; },
    get game() { return { quiz: quiz?.open ?? false, chase: chase.active, timer: host.querySelector('.q-timer:not([hidden])')?.textContent ?? null, monkey: npcs?.get('m3-thief')?.position.toArray() }; },
    get sound() { return { enabled: sound.enabled, state: sound.state, music: sound.musicPlaying }; },
    get destinations() { return world.destinations; },
    get doors() { return world.doors.map(d => ({ id: d.id, label: d.label, position: d.position.toArray(), open: d.open })); },
    goTo: (code: string) => { const d = world.destinations.find(d => d.label === code); if (d) goTo(d); },
    get route() { return autoPath.map(p => p.toArray()); },
    get chapterCard() { return !!host.querySelector('.q-chapter'); },
    get navReady() { return !sceneLoading && !!navigation && routesValidated; },
    get worldReady() { return !sceneLoading && routesValidated; },
    get shaderWarmup() { return {status:featureStatus.warmup,ms:shaderWarmupMs,loading:sceneLoading,...shaderWarmupStages,postMs:shaderWarmupPostMs,
      characterPrepareMs:characterWarmupPrepareMs,characterModels:characterWarmup?.modelIds??[],characterVariants:characterWarmup?.variants.length??0,characterMissing:characterWarmup?.failedModels??[],characterSamplesAttached:!!characterWarmup?.group.parent}; },
    get featureStatus() { return {...featureStatus}; },
    get landmarkUi() { return QA ? campusUi?.landmarkDiagnostics : undefined; },
    get tunnelProfile() { if (!QA || !uiPlacements?.tunnel || !terrainRef) return undefined; const p=fullTunnelProfile(uiPlacements.tunnel,(x,z)=>terrainRef!.heightAt(x,z)); return {length:p.length,sections:p.sections.map(s=>({position:s.position.toArray(),tangent:s.tangent.toArray(),right:s.right.toArray(),distance:s.distance}))}; },
    get tunnel() { if (!QA || !uiPlacements?.tunnel || !terrainRef) return undefined; const p=fullTunnelProfile(uiPlacements.tunnel,(x,z)=>terrainRef!.heightAt(x,z)); return {length:p.length,west:p.west.toArray(),east:p.east.toArray(),westYaw:p.westYaw,eastYaw:p.eastYaw}; },
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
  // Keep the loading cover until all existing concurrent scene jobs (including nested props) settle.
  await waitForSceneAssets(startupJobs);
  if(!alive)return;
  const warmupAt=performance.now();
  try {
    lod.update(physics.position,{overview,buildingId:inspectedBuilding,floorId:floorSelect.value});
    scene.add(warmupSamples());
    if(characterWarmup)scene.add(characterWarmup.group);
    shaderWarmupStages=await warmupWalkScene(renderer,scene,camera,TIERS[tier].post);
    characterWarmup?.removeFromScene();
    if(!alive)return;
    if(TIERS[tier].post){
      // Warm the small post-processing shader set as well, behind the loading cover.
      post.setSize(1,1);const postAt=performance.now();
      try {post.render(scene,camera);} finally {shaderWarmupPostMs=performance.now()-postAt;post.setSize(innerWidth*renderer.getPixelRatio(),innerHeight*renderer.getPixelRatio());}
    }
    featureStatus.warmup=characterWarmup?.failedModels.length?'degraded':'ready';
    if(characterWarmup?.failedModels.length)console.warn('character shader warmup: unavailable models',characterWarmup.failedModels);
  } catch(error) {featureStatus.warmup='degraded';console.warn('shader warmup',error);}
  finally {characterWarmup?.removeFromScene();shaderWarmupMs=performance.now()-warmupAt;}
  if(!alive)return;
  sceneLoading=false;stopLoadingTips();get('.walk-loading').hidden=true;input.release();input.mode='walk';
  lastTime=performance.now();
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
}
