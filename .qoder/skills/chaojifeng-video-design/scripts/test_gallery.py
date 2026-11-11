"""Portable gallery data and isolated interaction logic; not a browser layout test."""
import base64
import copy
import hashlib
from html.parser import HTMLParser
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from build_gallery import ROOT, gallery_data, image_url, build
from import_samples import import_samples, SILENT


class FooterText(HTMLParser):
    def __init__(self):super().__init__();self.footer=False;self.text=[]
    def handle_starttag(self,tag,attrs):
        if tag=='footer':self.footer=True
    def handle_endtag(self,tag):
        if tag=='footer':self.footer=False
    def handle_data(self,data):
        if self.footer:self.text.append(data)


class GalleryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):cls.data=gallery_data()

    def test_all_styles_and_reference_frames_are_portable(self):
        ids={x['id'] for x in self.data['styles']}
        self.assertEqual(len(ids),66)
        posters=[x for x in self.data['styles'] if x['poster']]
        self.assertEqual(len(posters),59)
        for item in posters:
            self.assertTrue(item['poster'].startswith('data:image/jpeg;base64,'),item['id'])
            self.assertTrue(base64.b64decode(item['poster'].split(',',1)[1],validate=True).startswith(b'\xff\xd8\xff'))
            self.assertEqual(item['video'],f'../../styles/{item["id"]}/sample.mp4')
            self.assertTrue((ROOT/'assets/gallery'/item['video']).resolve().is_file())
            self.assertEqual(item['attribution']['name'],'LemoLab · Lemo-Opuscar')
        self.assertTrue(all(x['attribution'] is None for x in self.data['styles'] if not x['poster']))
        self.assertTrue(set(self.data['featured'])<=ids)

    def test_media_input_rejects_disguised_html_and_stale_hash(self):
        with tempfile.TemporaryDirectory() as td:
            path=Path(td)/'image.jpg';path.write_bytes(b'<script>alert(1)</script>')
            with self.assertRaisesRegex(ValueError,'unsupported'):image_url(path)
            path.write_bytes(b'\xff\xd8\xffother')
            with self.assertRaisesRegex(ValueError,'hash mismatch'):image_url(path,'0'*64)

    def test_original_music_world_clips_keep_audio_and_local_files(self):
        works=self.data['originals']
        ids={x['id'] for x in works}
        self.assertTrue({'ink-landscape','porcelain-rain','math-world','pipa-moon-river'}<=ids)
        self.assertEqual(len(ids),len(works))
        for work in works:
            self.assertTrue(work['has_audio'])
            self.assertTrue(work['audio_preserved'])
            self.assertLess(abs(work['duration']-15),.1)
            self.assertTrue((ROOT/'assets/gallery'/work['video']).is_file())
            self.assertTrue(work['poster'].startswith('data:image/jpeg;base64,'))

    def test_generation_is_current_and_does_not_change_evidence(self):
        catalog=ROOT/'catalog/styles.json';before=catalog.read_bytes()
        result=build(check=True)
        self.assertTrue(result['portable_posters'])
        self.assertFalse(result['video_preload'])
        self.assertEqual(result['bundled_videos'],59)
        self.assertEqual(before,catalog.read_bytes())
        self.assertTrue((ROOT/'assets/gallery/expressions.html').is_file())

    def test_requested_footer_copy_is_removed(self):
        parsed=FooterText();parsed.feed((ROOT/'assets/gallery/index.html').read_text())
        footer=''.join(parsed.text)
        self.assertNotIn('来源代表画面与样片来自',footer)
        self.assertNotIn('画面可离线浏览',footer)
        self.assertNotIn('来源与许可',footer)
        html=(ROOT/'assets/gallery/index.html').read_text()
        self.assertNotIn('来源样片',html)
        self.assertNotIn('在来源页观看',html)
        self.assertNotIn('source-badge',html)
        self.assertNotIn('https://lemomo-ai.github.io/lemo-opuscar/films/',html)

    def test_bundled_samples_cover_every_style_and_excluded_audio_is_removed(self):
        manifest=json.loads((ROOT/'assets/gallery/samples.json').read_text())
        samples=manifest['samples']
        self.assertEqual(len(samples),59)
        self.assertEqual({s['style_id'] for s in samples},{s['id'] for s in self.data['styles'] if s['poster']})
        for sample in samples:
            self.assertGreater(sample['duration'],0)
            self.assertGreater(sample['width'],0)
            self.assertLess(sample['bytes'],50_000_000)
            if sample['style_id'].removeprefix('opuscar-') in SILENT:
                self.assertFalse(sample['has_audio'])
                self.assertEqual(sample['changes'],'audio removed')
                self.assertNotEqual(sample['source_asset']['digest'],'sha256:'+sample['sha256'])
            else:
                self.assertEqual(sample['changes'],'none')
                self.assertEqual(sample['source_asset']['digest'],'sha256:'+sample['sha256'])

    def test_import_rejects_unreviewed_urls_and_missing_release_hashes(self):
        with tempfile.TemporaryDirectory() as td:
            root=Path(td);manifest=root/'assets.json'
            data=dict(repository='lemomo-ai/lemo-opuscar',tag='web',assets=[dict(name='ink-wash.mp4',download_url='http://localhost/private',size=10,digest='sha256:'+'a'*64)])
            manifest.write_text(json.dumps(data))
            with self.assertRaisesRegex(ValueError,'unexpected release download URL'):
                import_samples(manifest,root/'cache')
            data['assets'][0].update(download_url='https://github.com/lemomo-ai/lemo-opuscar/releases/download/web/ink-wash.mp4',digest=None)
            manifest.write_text(json.dumps(data))
            with self.assertRaisesRegex(ValueError,'SHA-256'):
                import_samples(manifest,root/'cache')
            self.assertFalse((root/'cache').exists())

    def test_isolated_filter_compare_copy_and_media_lifecycle(self):
        node=shutil.which('node')
        if not node:self.skipTest('Node.js unavailable for isolated interaction checks')
        source=(ROOT/'assets/gallery/index.html').read_text().split('<script>',1)[1].split('</script>',1)[0]
        harness=r'''
const elements=new Map(),events={},copied=[];let currentVideo=null,playCalls=0,pauseCalls=0;
class Element {
 constructor(id){this.id=id;this.tagName='DIV';this.hidden=false;this.open=false;this.value='';this.textContent='';this.disabled=false;this.isConnected=true;this.events={};this.style={setProperty(k,v){this[k]=v}}}
 set innerHTML(value){this.html=value;if(this.id==='detail-cover')currentVideo=value.includes('id="sample-video"')?new Element('sample-video'):null}
 get innerHTML(){return this.html||''}
 addEventListener(name,fn){this.events[name]=fn}
 showModal(){this.open=true}
 close(){this.open=false;this.events.close?.()}
 focus(){document.activeElement=this}
 select(){this.selection=true}
 pause(){pauseCalls++}
 play(){playCalls++;return Promise.resolve()}
 removeAttribute(k){delete this[k]}
 load(){}
}
const document={body:new Element('body'),activeElement:new Element('body'),hidden:false,getElementById(id){if(id==='sample-video')return currentVideo;if(!elements.has(id))elements.set(id,new Element(id));return elements.get(id)},addEventListener(k,f){events[k]=f}};
const navigator={clipboard:{async writeText(s){copied.push(s)}}},history={replaceState(){}},location={pathname:'/gallery/index.html',search:'',hash:''};
const setTimeout=()=>0,clearTimeout=()=>{};
function assert(value,message){if(!value)throw new Error(message)}
'''
        checks=r'''
(async()=>{
 assert((document.getElementById('grid').innerHTML.match(/<article /g)||[]).length===66,'initial style wall');
 assert(currentVideo===null,'no media loads before an explicit play');
 query='chinese ink wash';render();assert(filtered().length===1&&filtered()[0].id==='opuscar-ink-wash','English search');
 query='水墨';render();assert(filtered().some(x=>x.id==='opuscar-ink-wash'),'Chinese search');
 query='__no_such_style__';render();assert(filtered().length===0&&document.getElementById('grid').innerHTML.includes('没有找到匹配'),'empty search');
 reset();category='手绘与绘画';render();assert(filtered().length>0&&filtered().every(x=>x.category===category),'category selection');
 reset();scenario='knowledge-explainer';render();assert(filtered().length>0&&filtered().every(x=>x.scenario_ids.includes(scenario)),'scenario filter');
 reset();styles.slice(0,4).forEach(x=>toggleCompare(x.id));assert(comparison.length===3,'comparison limit');
 openComparison();assert(compare.open&&document.getElementById('compare-grid').innerHTML.includes(styles[0].name),'comparison opens');
 compare.close();openStyle('opuscar-ink-wash');assert(detail.open&&currentVideo===null,'detail opens without fetching video');
 assert(!document.getElementById('style-attribution').hidden,'imported style has a concise attribution');
 playSample();assert(playCalls===1&&currentVideo.src==='../../styles/opuscar-ink-wash/sample.mp4','explicit play uses the bundled film');
 detail.close();assert(pauseCalls>0&&currentVideo===null,'closing releases the player');
 openStyle('paper-editorial');await copy(prompt(selected));assert(copied.at(-1).includes('paper-editorial')&&copied.at(-1).includes('【主题】'),'copy creation instruction');
 assert(document.getElementById('style-attribution').hidden,'original styles have no imported attribution');
 openStyle('opuscar-game-show');assert(document.getElementById('film-note').textContent.includes('无声'),'silent samples are labeled for the viewer');
 assert(safeColor('red; background:url(https://example.com)','fallback')==='fallback','style tokens cannot inject external CSS resources');
 console.log(JSON.stringify({scope:'isolated-interaction-logic-only',checks:17,status:'passed',browser_layout_verified:false}));
})().catch(e=>{console.error(e);process.exitCode=1});
'''
        with tempfile.TemporaryDirectory() as td:
            path=Path(td)/'gallery-test.cjs';path.write_text(harness+source+checks)
            result=subprocess.run([node,str(path)],capture_output=True,text=True,timeout=30)
            self.assertEqual(result.returncode,0,result.stdout+result.stderr)
            self.assertEqual(json.loads(result.stdout)['status'],'passed')


if __name__=='__main__':unittest.main()
