#!/usr/bin/env python3
"""Synthetic geometry checks for contact portals, not source-outline replacement."""
import unittest
from build_floor_access import plan_floor_access as _plan_floor_access
def plan_floor_access(floor,**kwargs):
 kwargs.setdefault("clearance",0);kwargs.setdefault("gallery_width",0)
 return _plan_floor_access(floor,**kwargs)

def rect(a,b,c,d):return [[a,b],[c,b],[c,d],[a,d]]
def room(rid,p,door=None):
 d={'id':rid,'polygon':p,'kind':'room-candidate','basis':'map-derived'}
 if door:d['door']={'position':door,'basis':'map-derived','width':1.2}
 return d

def floor(rooms,outline=None,holes=None):return {'id':'TEST-1F','outline':outline or rect(0,0,20,12),'holes':holes or [],'rooms':rooms}

class ContactTests(unittest.TestCase):
 def test_shared_corridor_and_preserved_manual_door(self):
  f=floor([room('A',rect(2,2,8,6),[5,6]),room('B',rect(8,2,14,6))]);r=plan_floor_access(f)
  self.assertEqual(r['report']['reachableRoomCount'],2)
  self.assertTrue(any(p['basis']=='map-derived' and p['position']==[5,6] for p in r['portals']))
  self.assertTrue(all('code' not in p for p in r['portals']))
 def test_enclosed_room_requires_shared_room_portal(self):
  # Four ring rooms surround a centre room, leaving no direct public boundary for centre.
  rs=[room('L',rect(2,2,5,10)),room('R',rect(9,2,12,10)),room('T',rect(5,2,9,4)),room('B',rect(5,8,9,10)),room('C',rect(5,4,9,8))]
  r=plan_floor_access(floor(rs));self.assertEqual(r['report']['reachableRoomCount'],5)
  self.assertTrue(any('C' in p['roomIds'] and len(p['roomIds'])==2 for p in r['portals']))
 def test_overlapping_rooms_reported_not_false_adjacency(self):
  r=plan_floor_access(floor([room('A',rect(2,2,8,8)),room('B',rect(6,4,12,10))]))
  self.assertTrue(any(i['type']=='overlapping-room-polygons' for i in r['report']['issues']))
  self.assertFalse(any(set(p['roomIds'])=={'A','B'} for p in r['portals']))
 def test_corner_contact_cannot_be_a_door(self):
  # Room itself is too small to have a 1.2m door; do not invent one.
  r=plan_floor_access(floor([room('tiny',rect(2,2,2.9,2.9))]))
  self.assertEqual(r['report']['unreachableRoomIds'],['tiny']);self.assertFalse(any('tiny' in p['roomIds'] for p in r['portals']))
 def test_near_contact_wall_thickness_not_corner(self):
  from build_floor_access import _span_candidate
  from shapely.geometry import LineString
  c=_span_candidate(LineString([(0,0),(4,0)]),LineString([(0,.3),(4,.3)]),1.2,.4,[])
  self.assertIsNotNone(c);self.assertAlmostEqual(c['gap'],.3)
  self.assertIsNone(_span_candidate(LineString([(0,0),(4,0)]),LineString([(4,.3),(8,.3)]),1.2,.4,[]))
 def test_short_but_width_qualified_boundary_is_usable(self):
  r=plan_floor_access(floor([room('small',rect(2,2,3.24,3.24))]))
  self.assertEqual(r['report']['reachableRoomCount'],1)
  r=plan_floor_access(floor([room('narrow',rect(2,2,3.19,3.19))]))
  self.assertEqual(r['report']['reachableRoomCount'],0)
 def test_invalid_polygon_reported(self):
  r=plan_floor_access(floor([room('bad',[[2,2],[6,6],[2,6],[6,2]])]));self.assertEqual(r['report']['invalidRoomIds'],['bad'])
 def test_exterior_entry_projects_near_external_stair(self):
  r=plan_floor_access(floor([room('A',rect(2,2,8,6))]),service_stair=[21,9])
  self.assertAlmostEqual(r['entry'][0],20)
  self.assertAlmostEqual(r['entry'][1],9)
  self.assertEqual(next(p for p in r['portals'] if p.get('kind')=='exterior-entry')['roomIds'],[])
 def test_outer_room_may_receive_schematic_entry(self):
  rs=[room('L',rect(0,0,5,12)),room('R',rect(15,0,20,12)),room('T',rect(5,0,15,3)),room('B',rect(5,9,15,12))]
  r=plan_floor_access(floor(rs),service_stair=[-2,6]);self.assertEqual(r['entryRoomId'],'L')
  self.assertAlmostEqual(r['entry'][0],0)
 def test_narrow_neck_splits_body_components(self):
  # A half-metre channel over a source hole connects points, not a .84m-wide body.
  f=floor([room('A',rect(2,2,5,5)),room('B',rect(15,2,18,5))],holes=[rect(9,.01,11,11.5)])
  f['mapAnnotations']=[{'kind':'corridor','position':[1,1]}]
  point=plan_floor_access(f);body=plan_floor_access(f,clearance=.42)
  self.assertEqual(point['report']['reachableRoomCount'],2)
  self.assertEqual(body['report']['walkableCoreCount'],2)
  self.assertEqual(body['report']['reachableRoomCount'],1)
 def test_two_public_components_can_link_through_real_room(self):
  f=floor([room('bridge',rect(9,0,11,11.5)),room('A',rect(2,2,5,5)),room('B',rect(15,2,18,5))])
  r=plan_floor_access(f,clearance=.42)
  self.assertEqual(r['report']['walkableCoreCount'],2)
  self.assertEqual(r['report']['reachableRoomCount'],3)
  bridge=[p for p in r['portals'] if 'bridge' in p['roomIds']]
  self.assertGreaterEqual(len(bridge),2)
 def test_thin_finger_does_not_get_a_false_inside_door(self):
  r=room('finger',[[2,2],[15,2],[15,2.609],[8,2.609],[8,7],[2,7]])
  r['door']={'position':[11,2],'width':1.2,'basis':'schematic','note':'人工示意'}
  plan=plan_floor_access(floor([r]));self.assertEqual(plan['report']['reachableRoomCount'],1)
  chosen=next(p for p in plan['portals'] if 'finger' in p['roomIds'])
  self.assertTrue(chosen['insideClearanceChecks']['finger']['passed'])
  self.assertLess(chosen['perRoomPosition']['finger'][0],8)
 def test_vertical_service_is_obstacle_not_public_free_space(self):
  f=floor([room('A',rect(2,2,5,5)),room('B',rect(15,2,18,5))])
  f['verticalServices']=[{'id':'shaft','polygon':rect(9,0,11,12)}]
  plan=plan_floor_access(f,clearance=.42)
  self.assertEqual(plan['report']['verticalServiceObstacleCount'],1)
  self.assertEqual(plan['report']['reachableRoomCount'],1)
 def test_explicit_reviewed_override_is_local_not_global_force(self):
  a=room('A',[[2,2],[8,2],[8,7],[2,7],[2,5],[2.4,5],[2.4,4],[2,4]])
  b=room('B',rect(-3,2,1.5,7));tiny=room('tiny',rect(16,2,16.9,2.9))
  f=floor([a,b,tiny],outline=rect(-5,0,20,12))
  override={'roomId':'A','neighborRoomId':'B','sourceReview':{'report':'unit-reviewed-source','entryId':'A-B'},'suggestedPortal':{'width':1.0,'perRoomPosition':{'A':[2,4.5],'B':[1.5,4.5]}}}
  plan=plan_floor_access(f,portal_overrides=[override])
  portal=next(p for p in plan['portals'] if p.get('sourceReview'))
  self.assertEqual(portal['basis'],'schematic');self.assertEqual(portal['cutDepth'],.65)
  self.assertTrue(portal['insideClearanceChecks']['A']['traceCorrection'])
  self.assertEqual(set(portal['clearancePositions']),{'A','B'})
  self.assertIn('tiny',plan['report']['unreachableRoomIds'])
  invalid={**override,'sourceReview':None};rejected=plan_floor_access(f,portal_overrides=[invalid])
  self.assertTrue(any(i['type']=='reviewed-portal-override-rejected' for i in rejected['report']['issues']))
 def test_acute_outline_entry_has_no_mitre_spike_and_reaches_core(self):
  f=floor([],outline=[[0,0],[20,0],[.1,2]])
  plan=plan_floor_access(f,clearance=.42,gallery_width=1.4,service_stair=[22,-1])
  self.assertLessEqual(max(p[0] for p in plan['walkOutline']),21.4)
  self.assertIsNotNone(plan['entry'])
  self.assertIn('entryClearancePosition',plan)
  from math import dist
  self.assertLessEqual(dist(plan['entry'],plan['entryClearancePosition']),1.2)
 def test_room_with_disconnected_body_lobes_never_becomes_teleport_node(self):
  r=room('lobes',[[2,2],[7,2],[7,4.75],[10,4.75],[10,2],[14,2],[14,8],[10,8],[10,5.25],[7,5.25],[7,8],[2,8]])
  plan=plan_floor_access(floor([r]),clearance=.42)
  self.assertEqual(plan['report']['roomCoreSelections']['lobes']['componentCount'],2)
  self.assertEqual(plan['report']['reachableRoomCount'],1)
  positions=[p['clearancePositions']['lobes'] for p in plan['portals'] if 'lobes' in p.get('clearancePositions',{})]
  self.assertTrue(positions)
  self.assertTrue(all(point[0]<7 for point in positions))
 def test_source_immutable(self):
  import copy
  f=floor([room('unknown',rect(2,2,8,6))]);original=copy.deepcopy(f);plan_floor_access(f);self.assertEqual(f,original)
 def test_hole_stays_a_hole(self):
  r=plan_floor_access(floor([room('A',rect(2,2,6,6))],holes=[rect(8,3,12,8)]))
  self.assertEqual(r['report']['reachableRoomCount'],1)

if __name__=='__main__':unittest.main()
