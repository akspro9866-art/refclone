"""Regression checks for misleading or detached video annotations."""
import copy, unittest
from pathlib import Path
from _contracts import load_json
from validate_annotation_track import check,interpolate,project

TEMPLATE=Path(__file__).resolve().parents[1]/'templates/annotation-track.json'

class AnnotationChecks(unittest.TestCase):
    def setUp(self):self.d=load_json(TEMPLATE)
    def codes(self):return {x['code'] for x in check(self.d).get('errors',[])}
    def test_example_is_pending_visual(self):
        r=check(self.d);self.assertEqual(r['status'],'awaiting_visual_review');self.assertEqual(r['visual_status'],'not_run');self.assertFalse(r['tracking_implemented'])
    def test_camera_reprojects_original_target(self):
        r=check(self.d);k=next(x for x in r['resolved_keyframes'] if x['time']==2)
        self.assertAlmostEqual(k['target_rect'][0],840);self.assertAlmostEqual(k['target_rect'][1],462)
    def test_label_crosses_background_text(self):
        self.d['tracks'][0]['label']['keyframes']=[{'time':1,'rect':[830,480,1100,550]},{'time':5,'rect':[830,480,1100,550]}]
        self.assertIn('label_protected',self.codes())
    def test_motion_collision_between_keyframes(self):
        self.d['screen_protected_regions'].append({'id':'middle-label-path','rect':[850,740,1250,800]})
        self.d['tracks'][0]['label']['keyframes']=[{'time':1,'rect':[850,650,1190,710]},{'time':5,'rect':[850,820,1190,880]}]
        self.assertIn('label_protected',self.codes())
    def test_frame_stroke_must_not_cut_button_text(self):
        self.d['sources'][0]['protected_regions'].append({'id':'near-border-copy','rect':[550,395,580,420]})
        self.assertIn('frame_protected',self.codes())
    def test_full_operation_unit_required(self):
        self.d['tracks'][0]['target_rect']=[580,380,740,450]
        self.assertIn('incomplete_target',self.codes())
    def test_excludes_neighbor_button(self):
        self.d['tracks'][0]['target_rect'][2]=850
        self.assertIn('unrelated_target',self.codes())
    def test_crop_cannot_erase_target(self):
        self.d['sources'][0]['crop_rect']=[0,0,600,800]
        self.assertIn('target_crop',self.codes())
    def test_offscreen_target_hidden_or_replanned(self):
        for f in self.d['sources'][0]['source_to_screen']['keyframes']:f['translate_x']=-1000
        self.assertIn('target_offscreen',self.codes())
    def test_single_point_cannot_be_forced_numbered(self):
        self.d['tracks'][0]['marker']={'kind':'number','value':'1','rect':[820,620,850,650]}
        self.assertIn('marker_semantics',self.codes())
    def test_sequence_cannot_be_lettered(self):
        self.d['tracks'][0].update(semantic_role='sequence',group_id='flow',index=1,marker={'kind':'letter','value':'A','rect':[820,620,850,650]})
        self.assertIn('marker_semantics',self.codes())
    def test_sequence_has_no_missing_index(self):
        self.d['tracks'][0].update(semantic_role='sequence',group_id='flow',index=2,marker={'kind':'number','value':'2','rect':[820,620,850,650]})
        self.assertIn('marker_sequence',self.codes())
    def test_rotation_not_misrepresented_as_checked(self):
        self.d['sources'][0]['source_to_screen']['keyframes'][1]['rotation']=30
        self.assertIn('unsupported_transform',self.codes())
    def test_no_implicit_label_extrapolation(self):
        self.d['tracks'][0]['label']['keyframes'][0]['time']=2
        self.assertIn('keyframe_coverage',self.codes())
    def test_unreadable_at_actual_display_width(self):
        self.d['readability']['view_width_px']=480
        self.assertIn('readability',self.codes())
    def test_keyframe_times_cannot_reverse(self):
        self.d['tracks'][0]['label']['keyframes'][1]['time']=.5
        self.assertIn('keyframe_time',self.codes())
    def test_sample_budget_not_silently_exceeded(self):
        self.assertIn('sample_budget',{x['code'] for x in check(self.d,step=.00001,max_samples=100)['errors']})
    def test_caption_not_detached(self):
        for f in self.d['tracks'][0]['label']['keyframes']:f['rect']=[1450,650,1750,710]
        self.assertIn('detached_label',self.codes())
    def test_leader_line_avoids_protected_content(self):
        self.d['screen_protected_regions'].append({'id':'line-obstacle','rect':[985,600,995,615]})
        self.assertIn('connector_protected',self.codes())
    def test_annotations_cannot_cover_each_other(self):
        other=copy.deepcopy(self.d['tracks'][0]);other['id']='second-focus';self.d['tracks'].append(other)
        self.assertIn('callout_collision',self.codes())
    def test_unannotated_visible_source_still_protects_its_text(self):
        s=copy.deepcopy(self.d['sources'][0]);s['id']='other-visible-panel';s['protected_regions']=[{'id':'other-text','rect':[600,550,850,610]}]
        self.d['sources'].append(s)
        self.assertIn('label_protected',self.codes())
    def test_source_outside_visibility_does_not_block(self):
        s=copy.deepcopy(self.d['sources'][0]);s['id']='other-visible-panel';s['visible_end']=.5;s['protected_regions']=[{'id':'other-text','rect':[600,550,850,610]}]
        self.d['sources'].append(s)
        self.assertEqual(check(self.d)['status'],'awaiting_visual_review')
    def test_track_cannot_outlive_source(self):
        self.d['sources'][0]['visible_end']=2
        self.assertIn('source_visibility',self.codes())
    def test_plan_reference_must_resolve(self):
        p={'project_id':self.d['project_id'],'output':{'width':1920,'height':1080,'duration_seconds':6},'scenes':[]}
        self.assertIn('plan_ref',{x['code'] for x in check(self.d,plan=p)['errors']})
    def test_nan_and_boolean_coordinate_rejected(self):
        self.d['tracks'][0]['target_rect'][0]=float('nan');self.assertIn('target_rect',self.codes())
        self.d=load_json(TEMPLATE);self.d['tracks'][0]['target_rect'][0]=True;self.assertIn('target_rect',self.codes())
    def test_malformed_nested_input_fails_cleanly(self):
        self.d['canvas']=[];self.assertEqual(check(self.d)['status'],'failed')

if __name__=='__main__':unittest.main()
