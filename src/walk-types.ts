export type Point2=[number,number];
export type Basis='map-derived'|'schematic';
export interface WalkPortal {id:string;position:Point2;width:number;roomIds:string[];nodeIds?:string[];clearancePositions?:Record<string,Point2>;basis:Basis;perRoomPosition?:Record<string,Point2>;cutDepth?:number;tangent?:Point2;}
export interface FloorAccess {walkOutline?:Point2[];portals:WalkPortal[];primaryPortalByRoom:Record<string,string>;entry:Point2;entryPortalId?:string;entryRoomId?:string;entryNodeId?:string;entryClearancePosition?:Point2;report?:unknown;}
export interface WalkRoom {id:string;code?:string;name?:string;kind:string;polygon:Point2[];door:{position:Point2;width:number;basis:Basis};basis:Basis;}
export interface WalkFloor {id:string;level:number;storeyIndex?:number;access?:FloorAccess;label:string;sourceId:string;page:number;crop:unknown;imageUrl?:string;imageWidth?:number;imageHeight?:number;bounds:[number,number,number,number];outline:Point2[];holes?:Point2[][];rooms:WalkRoom[];verticalServices?:{id?:string;kind:string;polygon:Point2[]}[];stairs:{id:string;position:Point2;basis:Basis}[];note?:string;transform?:unknown;reviewStatus?:string;detectionCoverage?:unknown;}
export interface WalkBuilding {id:string;name:string;floors:WalkFloor[];serviceStair?:{position:Point2;footprint?:Point2[];[key:string]:unknown};note?:string;}
export interface BuildingFrame {id:string;origin:Point2;rotation:number;scale:number;}
export interface SceneWaypoint {position:[number,number,number];buildingId?:string;floorId?:string;roomId?:string;basis:Basis;}
export interface SceneRoute {status:'ready'|'unavailable'|'loading';waypoints:SceneWaypoint[];basis:Basis;destination:string;note:string;}
export interface WalkDestination {id:string;label:string;buildingId:string;floorId:string;roomId?:string;doorId?:string;position:[number,number,number];level:number;}
export interface StructurePlacement {rotation:number;scale:number;x:number;z:number;basis:Basis;}
export interface StairCoreLevel {floorId:string;level:number;storey:number;basis:Basis;}
export interface StairCore {id:string;center:Point2;angle:number;length:number;width:number;apron:number;levels:StairCoreLevel[];basis:Basis;evidence?:string;}
export interface LiftSpec {id:string;center:Point2;angle:number;size:number;stops:{floorId:string;level:number;storey:number}[];basis:Basis;}
export interface JoinConnector {id:string;buildings:[string,string];floors:[string,string];storey:number;a:Point2;b:Point2;width:number;openings:Record<string,{p:Point2;width:number}[]>;rails:Point2[][];basis:Basis;}
export interface ContextBuilding {id:string;name:string|null;polygon:Point2[];storeys:number;tone?:string;}
export interface ContextRoad {id:string;kind:string;name?:string|null;width:number;tunnel?:boolean;bridge?:boolean;points:Point2[];}
export interface CampusStructure {
 version:number;placements:Record<string,StructurePlacement>;stairCores:Record<string,StairCore[]>;lifts:Record<string,LiftSpec[]>;
 roomOverrides:Record<string,Record<string,Point2[]|null>>;connectors:JoinConnector[];railGaps?:Record<string,{p:Point2;width:number}[]>;
 context:{landmarks:ContextBuilding[];background:ContextBuilding[];roads:ContextRoad[];water:{id:string;kind:string;points:Point2[]}[];sport:{id:string;kind:string;sport?:string;polygon:Point2[]}[]};
}
