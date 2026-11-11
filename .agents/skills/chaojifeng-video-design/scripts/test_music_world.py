"""Music-led projects: real generated audio, timing invalidation and deterministic state."""
import argparse
from array import array
import copy
import json
import math
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
import wave
from music_world import init, analyse, validate, read, write


@unittest.skipUnless(shutil.which('ffmpeg') and shutil.which('ffprobe'), 'media tools required')
class MusicWorldTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name);self.source=self.root/'song.wav'
        self.make_song(self.source, .5)
        self.project=self.root/'world'
        init(argparse.Namespace(into=str(self.project),music=str(self.source),theme='波的叠加',style='理论概念',
             duration=3,source_in=.2,fps=30,width=640,height=360,engine='auto'))
        self.args=argparse.Namespace(project=str(self.project))
        analyse(self.args)

    @staticmethod
    def make_song(path, period):
        sr=8000;data=array('h')
        for i in range(sr*4):
            t=i/sr;dt=t%period
            value=.65*math.exp(-dt*60)*math.sin(2*math.pi*90*t)+.1*math.sin(2*math.pi*440*t)
            data.append(round(value*25000))
        with wave.open(str(path),'wb') as f:
            f.setparams((1,2,sr,0,'NONE','not compressed'));f.writeframes(data.tobytes())

    def test_window_features_and_candidate_evidence(self):
        d=read(self.project/'music-analysis.json')
        self.assertEqual(len(d['features']['rms']),90)
        self.assertEqual(d['source_in'],.2)
        self.assertTrue(all(x['status']=='candidate' for x in d['anchors']))
        self.assertTrue(validate(self.args)['valid'])

    def test_starter_includes_build_and_both_render_routes(self):
        for name in ('tsconfig.json','remotion.config.ts','src/index.tsx','core/state.mjs','blender/render.py'):
            self.assertTrue((self.project/name).is_file(),name)
        self.assertEqual(read(self.project/'tsconfig.json')['compilerOptions']['jsx'],'react-jsx')

    def test_reanalysis_preserves_authored_score(self):
        p=self.project/'score.json';s=read(p);s['events'][0]['meaning']='向量合成结果落定';write(p,s)
        analyse(self.args)
        self.assertEqual(read(p)['events'][0]['meaning'],'向量合成结果落定')

    def test_cut_fps_and_source_changes_invalidate(self):
        p=self.project/'project.json';original=read(p)
        for key,value in [('duration',2),('fps',24)]:
            cfg=copy.deepcopy(original);cfg[key]=value;write(p,cfg)
            self.assertFalse(validate(self.args)['valid'])
        write(p,original);self.make_song(self.source,.4)
        self.assertFalse(validate(self.args)['valid'])

    def test_invalid_phases_duplicates_and_audio_tampering(self):
        p=self.project/'score.json';s=read(p);s['events'].append(copy.deepcopy(s['events'][0]));write(p,s)
        self.assertFalse(validate(self.args)['valid'])
        s['events'].pop();s['events'][0]['peak']=-1;write(p,s)
        self.assertFalse(validate(self.args)['valid'])
        (self.project/'public/music.wav').write_bytes(b'bad')
        self.assertFalse(validate(self.args)['valid'])

    @unittest.skipUnless(shutil.which('node'), 'node required')
    def test_state_is_independent_of_seek_order(self):
        validate(self.args)
        code="""import fs from 'node:fs';import {worldAt} from './core/state.mjs';
const job=JSON.parse(fs.readFileSync('public/job.json'));
const first=JSON.stringify(worldAt(40,job));
for(const f of [89,0,70,12,40]) worldAt(f,job);
if(first!==JSON.stringify(worldAt(40,job))) process.exit(1);
console.log('deterministic');"""
        r=subprocess.run(['node','--input-type=module','-e',code],cwd=self.project,capture_output=True,text=True)
        self.assertEqual(r.returncode,0,r.stderr)

    def test_second_music_and_style_use_new_data(self):
        other=self.root/'rain';src=self.root/'slow.wav';self.make_song(src,.8)
        init(argparse.Namespace(into=str(other),music=str(src),theme='雨过江南',style='烟雨',duration=2,
             source_in=0,fps=24,width=640,height=360,engine='auto'))
        a=argparse.Namespace(project=str(other));analyse(a)
        self.assertEqual(read(other/'project.json')['engine'],'blender')
        self.assertEqual(len(read(other/'music-analysis.json')['features']['low']),48)
        self.assertNotEqual(read(other/'music-analysis.json')['source_sha256'],read(self.project/'music-analysis.json')['source_sha256'])
        self.assertTrue(validate(a)['valid'])


if __name__=='__main__':unittest.main()
