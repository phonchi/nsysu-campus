import type {P3,SourceBinding} from '../world/v12-types';
export interface BusStopSpec extends SourceBinding {id:string;name:string;aliases:string[];sign:P3;berth:{position:P3;yaw:number};boardingPoint:P3;alightingPoints:P3[];pedestrianAnchorId:string}
export interface BusLeg {
 fromOccurrenceId:string;toOccurrenceId:string;path:P3[];sourceEdgeIds:string[];cruiseMpsGame:number;narrowSectionIds?:string[];
 departurePath?:P3[];
}
export interface BusRouteSpec extends SourceBinding {
 id:'campus-bus'|'orange-1-ext';vehicleId:string;stopOccurrences:{occurrenceId:string;stopId:string}[];
 legs:BusLeg[];
 schedule:{kind:'schematic';gameSecondsPerRealSecond:5;initialPhaseGameSeconds:number;terminalLayoverRealSeconds:number;minDwellRealSeconds:6};
 vehicle:{lengthM:number;widthM:number;heightM:number;minTurnRadiusM:number};surfaceVersion:string;graphRevision:string;
}
export interface BusData {stops:BusStopSpec[];routes:BusRouteSpec[];forecourt?:{polygon:[number,number][];levelY:number;id:string}}
