"""Build a labeled contact sheet and local gallery from actual WebGL captures."""
import argparse,json,pathlib,html,os
from urllib.parse import quote
from PIL import Image,ImageDraw,ImageFont
p=argparse.ArgumentParser();p.add_argument('--captures',required=True);p.add_argument('--title',required=True);p.add_argument('--out',required=True);p.add_argument('--stage-bounds',nargs=4,type=int);p.add_argument('--capture-kind',choices=['webgl','blender'],default='webgl');args=p.parse_args()
capture_path=pathlib.Path(args.captures);record=json.loads(capture_path.read_text(encoding='utf8'));captures=record.get('captures',[]) if isinstance(record,dict) else record
out=pathlib.Path(args.out);out.mkdir(parents=True,exist_ok=True)
font_path=pathlib.Path('C:/Windows/Fonts/segoeui.ttf');font=ImageFont.truetype(str(font_path),22);small=ImageFont.truetype(str(font_path),15);title=ImageFont.truetype(str(font_path),30)
source_label='Live WebGL' if args.capture_kind=='webgl' else 'Blender source render'
source_description='screenshots from the Peris Three.js unit gallery' if args.capture_kind=='webgl' else 'renders of the saved Blender source; these are not in-game screenshots'
width=1200;tile_w=400;tile_h=400;rows=(len(captures)+2)//3;board=Image.new('RGB',(width,90+rows*tile_h),(20,43,34));draw=ImageDraw.Draw(board);draw.text((22,15),args.title,font=title,fill=(239,220,167));draw.text((22,56),source_label+' · Prototype review · Full images linked in gallery',font=small,fill=(163,190,164))
cards=[]
for index,capture in enumerate(captures):
    src=capture_path.parent/capture['file'];im=Image.open(src).convert('RGB')
    bounds=capture.get('stageBounds') or args.stage_bounds
    if bounds:
        x,y,w,h=bounds
        if x<0 or y<0 or x+w>im.width or y+h>im.height:raise ValueError('Stage bounds must stay inside original screenshot')
        # The gallery stage is panoramic; its centered model fits a tighter
        # portrait crop while the original full screenshot remains linked.
        target_w=min(w,round(h*1.28));x+=round((w-target_w)/2);w=target_w
        im=im.crop((x,y,x+w,y+h))
    im.thumbnail((386,335),Image.Resampling.LANCZOS);col=index%3;row=index//3;x=col*tile_w+7;y=90+row*tile_h
    board.paste(im,(x+(386-im.width)//2,y));draw.text((x+6,y+340),capture['label'],font=font,fill=(239,220,167));draw.text((x+6,y+370),source_label+' · '+capture.get('detail','near'),font=small,fill=(165,189,164))
    link=quote(os.path.relpath(src.resolve(),out.resolve()).replace('\\','/'),safe='/');cards.append('<article><a href="'+html.escape(link,quote=True)+'"><img src="'+html.escape(link,quote=True)+'" alt="'+html.escape(capture['label'],quote=True)+'"></a><h2>'+html.escape(capture['label'])+'</h2><p>'+html.escape(capture.get('status',source_label))+'</p></article>')
board.save(out/'contact-sheet.jpg',quality=94)
(out/'index.html').write_text('<!doctype html><meta charset="utf-8"><title>'+html.escape(args.title)+'</title><style>body{background:#142b22;color:#efdda8;font:16px system-ui;margin:28px}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:20px}article{background:#20382e;padding:12px;border:1px solid #61775e}img{width:100%;display:block}h2{font-size:20px}p{font-size:13px;color:#b8cbb3}</style><h1>'+html.escape(args.title)+'</h1><p>Actual '+source_description+'. Click a unit to see the complete image. These are visual prototypes; siege roles are inspection studies.</p><main>'+''.join(cards)+'</main>',encoding='utf8')
print(json.dumps({'captures':len(captures),'contactSheet':str((out/'contact-sheet.jpg').resolve()),'gallery':str((out/'index.html').resolve()),'originalScreenshotsPreserved':True}))
