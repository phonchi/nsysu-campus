import type { Basis, Point2 } from '../walk-types';
export type P3 = [number, number, number];
export interface Evidence { sourceId:string; locator:string; basis:Basis; note?:string }
export interface RoomV12Fields { aliases?:string[]; splitFrom?:string; designNote?:string }
export interface RestroomFields {
 kind:'restroom'; gender:'male'|'female'|'unisex'; accessible:boolean; displayName:string;
 planSymbol?:'mf'|'m'|'f'|'accessible'|'text'; evidence:Evidence; locationEvidence?:Evidence;
}
export interface DestinationV12Fields { aliases?:string[]; category:'room'|'restroom'|'entrance'; gender?:RestroomFields['gender']; accessible?:boolean }
export interface LiftStopV12 {
 floorId:string; level:number; storey:number; approach:Point2;
 landingDoor:{center:Point2;tangent:Point2;clearWidth:number}; evidence:Evidence;
}
export interface LiftGeometryV12 {
 id:string; buildingId:string; center:Point2; angle:number; size:number; cabinSize:Point2;
 shaftPolygon:Point2[]; replacesServiceIds:string[]; stops:LiftStopV12[]; basis:Basis; evidence:Evidence;
}
export type LiftPhase='idle'|'opening'|'open'|'closing'|'moving'|'arrived';
export interface LiftSnapshot {
 id:string;phase:LiftPhase;atFloorId:string|null;targetFloorId:string|null;requestedFloorIds:string[];
 doorOpen01:number;carPositionWorld:P3;
}
export type GestureId='wave'|'bow'|'thumbsUp'|'clap';
export interface GestureReaction { npcId:string;kind:'wave'|'bow'|'clap'|'nod';role:'primary'|'secondary' }
/** v12.0 implements walk, bike and lift-carried; other modes reserve the frozen v12.1 contract. */
export type MotionMode={kind:'walk'}|{kind:'bike'}|{kind:'swim';waterId:string}|
 {kind:'watercraft';craftId:string;type:'sup'|'kayak'}|
 {kind:'carried';carrier:'lift'|'bus';id:string;localAnchor:P3}|
 {kind:'rescue';waterId:string}|{kind:'exercise';equipmentId:string};

export type SourceId='S1'|'S2'|'S3'|'S4'|'S5'|'S6'|'S7'|'S8'|'S9'|'S10'|'S11'|'S12'|'S13'|'S14';
export interface SourceBinding { sources:string[]; sourceIds:SourceId[] }
export interface WaterBodySpec extends SourceBinding {id:string;kind:'sea'|'pool';polygon:Point2[];surfaceY:number;entryPoints:P3[];exitPoints:P3[];rescuePaths:P3[][];safeReturnPoints:P3[];basis:Basis;designNote?:string;open?:boolean}
export interface WaterRouteSpec extends SourceBinding {id:string;waterId:string;craft:'sup'|'kayak';launchPoint:P3;returnPoint:P3;waypoints:Point2[];corridor:Point2[];exclusions:Point2[][]}
export interface SeaConditions {date:string;waveHeightM:number;period:'day'|'sunset'|'night';typhoonWarning:boolean;thunder:boolean;operatorClosed:boolean;qaOverride:boolean}
export type SeaActivity='swim'|'sup'|'kayak'|'surf-class'|'supervised-training'|'sailing-show';
export interface WaterDecision {allowed:boolean;recall:boolean;reasons:('night'|'wave-1'|'wave-2'|'typhoon'|'thunder'|'operator')[]}
export interface TimedCourse {id:string;mode:'run'|'swim';waterId?:string;corridor:Point2[];gates:{id:string;a:P3;b:P3;direction:Point2}[];requiredGateSequence:string[]}
export interface FitnessPortal {id:string;exteriorTrigger:P3;exteriorReturnPoints:P3[];interiorSceneId:string;interiorSpawn:P3}
export interface EquipmentSpec {id:string;kind:'treadmill'|'stationary-bike';position:P3;yaw:number;approach:P3;exitPoints:P3[]}
export interface SailingShowSpec extends SourceBinding {id:string;waterId:string;viewingAnchorId:string;boats:{id:string;team:'nsysu'|'osaka';path:P3[];startProgress:number}[];teamLabels?:Record<'nsysu'|'osaka',string>}
export interface SportFacility {id:string;kind:string;polygon:Point2[];name?:string;name_zh?:string;courts?:Point2[][];surfaceY?:number;lanes?:number;center?:Point2;size?:Point2;angleDeg?:number;fence?:boolean}
export interface SeaRentalKiosk {position:P3;yaw:number;apron:Point2[]}
export interface SeaCenter {id?:string;position:P3;name?:string;rentalDesk?:P3;kiosk?:SeaRentalKiosk}
export interface SeaData {hazards?:{kind?:string;polygon:Point2[]}[];waterBodies:WaterBodySpec[];routes:WaterRouteSpec[];center?:SeaCenter;buoys?:P3[];lifeguardChair?:P3;surfZone?:{polygon:Point2[];position?:P3};sailingShow?:SailingShowSpec;viewingPoint?:P3;anchors?:Record<string,P3>}
export interface SportsData {facilities:SportFacility[];courses:TimedCourse[];portals:FitnessPortal[];equipment:EquipmentSpec[]}
export interface FitnessScene {id:string;polygon:Point2[];floorY:number;equipment:EquipmentSpec[];exitPoint:P3}
export interface FitnessData {scenes:FitnessScene[]}
export interface WaterAvatarFrame {renderRootWorld:P3;heading:number;clip:'Swim'|'Tread'|'PaddleStand'|'PaddleSit'}
