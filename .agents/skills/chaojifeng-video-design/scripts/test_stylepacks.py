"""Observable extension, compatibility and provenance checks; no renderer starts."""
import copy
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from _stylepacks import ROOT, load_registry, fresh_verification, resolve, style_lock
from _contracts import catalog
from validate_plan import validate_plan
from _source_integrity import verify_sources


class StylePackageTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.collection=Path(self.temp.name)

    def package(self, ident='my-ink', **changes):
        folder=self.collection/ident;folder.mkdir(exist_ok=True)
        data=dict(pack_version=1,id=ident,name=ident,intent='Explain one relationship.',guide='STYLE.md',extends='opuscar-ink-wash',aliases=[],borrows=[],verification=fresh_verification())
        data.update(changes)
        (folder/'STYLE.md').write_text('# Style\nUse the declared material and hold for reading.\n')
        (folder/'style.json').write_text(json.dumps(data))
        return data,folder

    def test_existing_ids_and_original_plans_remain_usable(self):
        styles=catalog('style',style_roots=[])
        self.assertTrue({'product-minimal','paper-editorial','dark-tech','mono-diagram','vivid-collage','cinematic-photo','dual-ground-launch'}<=styles.keys())
        for path in sorted((ROOT/'examples').glob('*.plan.json')):
            report=validate_plan(json.loads(path.read_text()),path,style_roots=[])
            self.assertTrue(report['valid'], (path,report['errors']))

    def test_new_package_loads_in_query_and_plan_without_editing_entry(self):
        entry=(ROOT/'SKILL.md').read_bytes()
        self.package(tokens={'accent':'#aa0000'})
        registry,_,_=load_registry([self.collection])
        self.assertIn('my-ink',registry)
        self.assertEqual(registry['my-ink']['tokens']['accent'],'#aa0000')
        plan=json.loads((ROOT/'templates/plan.json').read_text())
        plan['design']['style_id']='my-ink'
        self.assertTrue(validate_plan(plan,ROOT/'templates/plan.json',style_roots=[self.collection])['valid'])
        out=subprocess.run([sys.executable,str(ROOT/'scripts/catalog.py'),'--kind','style','list','--style-root',str(self.collection),'--json'],capture_output=True,text=True,check=True)
        self.assertIn('my-ink',{x['id'] for x in json.loads(out.stdout)['items']})
        self.assertEqual(entry,(ROOT/'SKILL.md').read_bytes())

    def test_precise_names_and_case_insensitive_english(self):
        for name in ('中国水墨','ink-wash','CHINESE INK WASH','opuscar-ink-wash'):
            self.assertEqual(resolve(name,extra=[])[0]['id'],'opuscar-ink-wash')
        with self.assertRaisesRegex(ValueError,'unknown style'):
            resolve('ink',extra=[])

    def test_id_and_alias_collisions_are_rejected(self):
        self.package('opuscar-ink-wash')
        with self.assertRaisesRegex(ValueError,'duplicate style ID'):
            load_registry([self.collection])
        (self.collection/'opuscar-ink-wash'/'style.json').unlink()
        self.package(aliases=['Chinese Ink Wash'])
        with self.assertRaisesRegex(ValueError,'ambiguous style name'):
            load_registry([self.collection])

    def test_cycles_include_borrows_and_missing_dependencies(self):
        self.package('first',extends='second')
        self.package('second',borrows=['first'])
        with self.assertRaisesRegex(ValueError,'cycle'):
            load_registry([self.collection])
        self.package('second',extends='missing')
        with self.assertRaisesRegex(ValueError,'unknown style dependency'):
            load_registry([self.collection])

    def test_evidence_and_identity_are_not_inherited(self):
        self.package('first',verification={'design':{'status':'reviewed','evidence':[]},'preview':{'status':'passed','evidence':['frame'],'environment':'e','scope':'s','artifact':'a'},'exported':{'status':'not_run','evidence':[]}})
        self.package('second',extends='first')
        registry,_,_=load_registry([self.collection])
        self.assertEqual(registry['second']['verification']['preview']['status'],'not_run')
        self.assertEqual(registry['second']['aliases'],[])
        self.assertNotIn('origin',registry['second'])
        d,f=self.package('third',extends='first');d.pop('verification');(f/'style.json').write_text(json.dumps(d))
        with self.assertRaisesRegex(ValueError,'never inherited'):
            load_registry([self.collection])

    def test_files_cannot_escape_package(self):
        self.package(guide='../outside.md')
        (self.collection/'outside.md').write_text('not a package file')
        with self.assertRaisesRegex(ValueError,'escaping'):
            load_registry([self.collection])

    def test_loading_never_executes_declared_source(self):
        _,folder=self.package(implementation={'entrypoints':['danger.py']})
        marker=self.collection/'ran'
        (folder/'danger.py').write_text(f"from pathlib import Path\nPath({str(marker)!r}).touch()\nraise RuntimeError('not executable during lookup')\n")
        load_registry([self.collection])
        self.assertFalse(marker.exists())

    def test_nonfinite_and_duplicate_manifest_keys_are_rejected(self):
        _,folder=self.package()
        raw=(folder/'style.json').read_text()
        (folder/'style.json').write_text(raw[:-1]+',"tokens":{"x":1e999}}')
        with self.assertRaisesRegex(ValueError,'non-finite'):
            load_registry([self.collection])
        (folder/'style.json').write_text(raw[:-1]+',"id":"other"}')
        with self.assertRaisesRegex(ValueError,'duplicate JSON key'):
            load_registry([self.collection])

    def test_source_corruption_does_not_pass_integrity_check(self):
        common=self.collection/'vendor/lemo-opuscar';common.mkdir(parents=True)
        (common/'sample.js').write_text('changed')
        (common/'manifest.json').write_text(json.dumps(dict(common_files=[dict(path='sample.js',sha256='0'*64)],styles=[])))
        with self.assertRaisesRegex(ValueError,'hash mismatch'):
            verify_sources(self.collection)

    def test_optional_gallery_requires_local_poster_and_safe_video(self):
        self.package(gallery={'poster':'missing.jpg'})
        with self.assertRaisesRegex(ValueError,'missing or escaping'):
            load_registry([self.collection])
        self.package(gallery={'video':'javascript:alert(1)'})
        with self.assertRaisesRegex(ValueError,'HTTPS'):
            load_registry([self.collection])
        self.package(gallery={'attribution':{'name':'Author','url':'javascript:alert(1)'}})
        with self.assertRaisesRegex(ValueError,'HTTPS'):
            load_registry([self.collection])

    def test_ready_runtime_needs_actual_style_capabilities(self):
        plan=json.loads((ROOT/'templates/plan.json').read_text())
        plan['design']['style_id']='opuscar-glass-product'
        plan['runtime'].update(status='ready',capabilities=['time-control','opacity','position'])
        r=validate_plan(plan,ROOT/'templates/plan.json',style_roots=[])
        self.assertIn('style_capabilities',{e['code'] for e in r['errors']})
        plan['runtime']['capabilities'].append('graphics-3d')
        self.assertTrue(validate_plan(plan,ROOT/'templates/plan.json',style_roots=[])['valid'])

    def test_lock_covers_transitive_base_and_borrowed_files(self):
        self.package('first')
        self.package('second',extends='first')
        self.package('third',extends='second',borrows=['paper-editorial'])
        lock=style_lock('third',[self.collection])
        self.assertEqual(set(lock['packages']),{'first','second','third','opuscar-ink-wash','paper-editorial'})
        plan=json.loads((ROOT/'templates/plan.json').read_text())
        plan['design'].update(style_id='third',style_lock=lock)
        self.assertTrue(validate_plan(plan,ROOT/'templates/plan.json',style_roots=[self.collection])['valid'])
        (self.collection/'first/STYLE.md').write_text('changed material')
        r=validate_plan(plan,ROOT/'templates/plan.json',style_roots=[self.collection])
        self.assertIn('style_lock',{e['code'] for e in r['errors']})

    def test_generation_excludes_private_roots(self):
        self.package()
        with patch.dict(os.environ,{'CJF_VIDEO_STYLE_PATH':str(self.collection)}):
            out=subprocess.run([sys.executable,str(ROOT/'scripts/stylepacks.py'),'build','--check'],capture_output=True,text=True)
        self.assertEqual(out.returncode,0,out.stdout+out.stderr)
        self.assertNotIn('my-ink',{x['id'] for x in json.loads((ROOT/'catalog/styles.json').read_text())['items']})

    def test_pinned_snapshot_contains_all_source_styles_and_matches_hashes(self):
        r=verify_sources()
        self.assertEqual(r['styles'],59)
        self.assertEqual(r['revision'],'413a6bd6d78ebd3bdd5abaec9538a26867f890df')
        self.assertGreater(r['files'],1000)
        upstream=json.loads((ROOT/'vendor/lemo-opuscar/styleboard/catalog.json').read_text())
        registry,_,_=load_registry(extra=[])
        self.assertEqual({v['id'][8:] for v in registry.values() if v.get('origin')},{v['slug'] for v in upstream})
        self.assertTrue(all(v['verification']['exported']['status']=='not_run' for v in registry.values() if v.get('origin')))


if __name__=='__main__':
    unittest.main()
