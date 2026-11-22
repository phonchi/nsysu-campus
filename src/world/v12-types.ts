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
