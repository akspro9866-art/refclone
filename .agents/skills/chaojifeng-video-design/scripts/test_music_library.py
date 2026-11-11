"""Check dangerous edit mistakes rather than music taste or generated labels."""
import copy, json, tempfile, unittest
from pathlib import Path
from music_library import ROOT,load,validate_catalog,validate_sheet,digest

class EditChecks(unittest.TestCase):
    @classmethod
    def setUpClass(cls):cls.c=load(ROOT/'catalog/music.json')
    def sheet(self):
        t=self.c['items'][0];cue=t['cues'][0];s=cue['source_in']
        return dict(schema_version=1,library_id=self.c['library_id'],duration_seconds=30,cues=[dict(
            id='place-1',track_id=t['id'],cue_id=cue['id'],source_sha256=t['sha256'],
            source_in=s,source_out=s+8,timeline_start=0,timeline_end=8,narrative_purpose='建立情境',audition_status='not_run')])
    def test_library_ranges(self):self.assertEqual(validate_catalog(self.c),[])
    def test_valid_structure_is_not_audio_pass(self):
        out=validate_sheet(self.sheet(),self.c)
        self.assertEqual(out['status'],'structure_valid');self.assertFalse(out['audio_aesthetic_verified']);self.assertFalse(out['rights_cleared_for_render'])
    def test_source_and_film_clock_mismatch(self):
        s=self.sheet();s['cues'][0]['timeline_end']=7
        self.assertTrue(any('duration mismatch' in x for x in validate_sheet(s,self.c)['errors']))
    def test_source_beyond_track(self):
        s=self.sheet();s['cues'][0]['source_out']=10000
        self.assertTrue(any('outside song' in x for x in validate_sheet(s,self.c)['errors']))
    def test_nan_rejected(self):
        s=self.sheet();s['cues'][0]['source_in']=float('nan')
        self.assertEqual(validate_sheet(s,self.c)['status'],'failed')
    def test_unknown_track(self):
        s=self.sheet();s['cues'][0]['track_id']='unknown'
        self.assertTrue(any('unknown track' in x for x in validate_sheet(s,self.c)['errors']))
    def test_crossfade_needs_reason(self):
        s=self.sheet();b=copy.deepcopy(s['cues'][0]);b.update(id='place-2',timeline_start=7,timeline_end=15);s['cues'].append(b)
        self.assertTrue(any('overlap needs' in x for x in validate_sheet(s,self.c)['errors']))
        b['transition_reason']='叙事接桥，重叠1秒';self.assertEqual(validate_sheet(s,self.c)['errors'],[])
    def test_rights_claim_needs_evidence(self):
        s=self.sheet();s['cues'][0]['rights']={'status':'verified_for_project'}
        self.assertTrue(any('rights verification' in x for x in validate_sheet(s,self.c)['errors']))
    def test_stale_source(self):
        s=self.sheet();s['cues'][0]['source_sha256']='0'*64
        self.assertTrue(any('source hash' in x for x in validate_sheet(s,self.c)['errors']))
    def test_actual_asset_changed(self):
        with tempfile.TemporaryDirectory() as temp:
            f=Path(temp)/'changed.bin';f.write_bytes(b'changed audio')
            s=self.sheet();r={'assets':{s['cues'][0]['track_id']:{'path':str(f)}}}
            self.assertTrue(any('actual source file' in x for x in validate_sheet(s,self.c,r)['errors']))
    def test_no_phantom_success_from_empty_sheet(self):
        s=self.sheet();s['cues']=[];self.assertEqual(validate_sheet(s,self.c)['status'],'failed')

if __name__=='__main__':unittest.main()
