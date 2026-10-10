"""Preserve the 99 verified browser captures outside disposable test results."""
import argparse
import html
import json
from pathlib import Path
import shutil
import subprocess
import sys

parser = argparse.ArgumentParser()
parser.add_argument('--captures-root', default='test-results')
parser.add_argument('--out', required=True)
parser.add_argument('--faction', help='Preserve one completed faction while the full capture run continues')
args = parser.parse_args()
root = Path.cwd()
out = Path(args.out)
out.mkdir(parents=True, exist_ok=True)
report = json.loads((root / 'public/models/battle/faction-rosters.json').read_text(encoding='utf8'))
roles = set(report['roles'])
records = []
cards = []
for faction, pack in report['factions'].items():
    if args.faction and faction != args.faction:
        continue
    candidates = sorted(Path(args.captures_root).rglob(f'{faction}-captures.json'), key=lambda p: p.stat().st_mtime, reverse=True)
    if not candidates:
        raise ValueError(f'Missing completed browser capture batch: {faction}')
    source = candidates[0]
    record = json.loads(source.read_text(encoding='utf8'))
    captures = record['captures']
    if len(captures) != 9 or {item['role'] for item in captures} != roles:
        raise ValueError(f'Incomplete role coverage: {faction}')
    target = out / faction
    target.mkdir(exist_ok=True)
    for capture in captures:
        if capture['faction'] != faction or capture['edition'] != pack['sourceEdition'] or capture['sha256'] != pack['near']['sha256']:
            raise ValueError(f'Capture does not match the current runtime: {faction}')
        shutil.copy2(source.parent / capture['file'], target / capture['file'])
    saved = target / 'captures.json'
    saved.write_text(json.dumps(record, indent=2) + '\n', encoding='utf8')
    subprocess.run([sys.executable, str(root / 'scripts/build-unit-screenshot-gallery.py'), '--captures', str(saved), '--title', faction.title() + ' · nine browser prototypes', '--out', str(target / 'gallery')], check=True)
    records.append({'faction': faction, 'edition': pack['sourceEdition'], 'sha256': pack['near']['sha256'], 'captures': 9})
    cards.append(f'<article><a href="{faction}/gallery/index.html"><img src="{faction}/gallery/contact-sheet.jpg" alt="{html.escape(faction)} unit screenshots"><h2>{html.escape(faction.title())}</h2></a></article>')
if len(records) != (1 if args.faction else 11):
    raise ValueError('Expected complete capture coverage for the selected factions')
unit_count = len(records) * 9
(out / 'index.html').write_text(f'<!doctype html><meta charset="utf-8"><title>Peris · {unit_count} browser prototypes</title><style>body{{background:#142b22;color:#efdda8;font:16px system-ui;margin:28px}}main{{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:24px}}article{{background:#20382e;padding:14px}}a{{color:inherit}}img{{width:100%;display:block}}p{{max-width:900px;line-height:1.6}}</style><h1>Peris · {unit_count} browser prototypes</h1><p>Actual screenshots of the final optimized models in the Three.js unit gallery. Each faction links to nine complete screenshots. Troop looks use existing combat rules; siege models are inspection studies. Final art review remains open.</p><main>' + ''.join(cards) + '</main>', encoding='utf8')
(out / 'review-manifest.json').write_text(json.dumps({'captureKind': 'actual WebGL browser screenshots', 'unitCount': unit_count, 'factions': records, 'originalScreenshotsPreserved': True}, indent=2) + '\n', encoding='utf8')
print(json.dumps({'unitCount': unit_count, 'gallery': str((out / 'index.html').resolve())}))
