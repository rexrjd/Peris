import { FIELD_H, FIELD_W, seeded, WORLD_H, WORLD_W } from './rules'
import type { BuildingType, Terrain } from '../types/game'

export const palette={grass:'#888d5c',dark:'#28302c',gold:'#ddc48b',own:'#c95143',enemy:'#688bab'}
function ellipse(c:CanvasRenderingContext2D,x:number,y:number,rx:number,ry:number,color:string){c.fillStyle=color;c.beginPath();c.ellipse(x,y,rx,ry,0,0,Math.PI*2);c.fill()}
export function tree(c:CanvasRenderingContext2D,x:number,y:number,size=1,pine=false){
  c.save();c.translate(x,y);c.scale(size,size);ellipse(c,4,5,10,5,'#202c2545')
  c.strokeStyle='#65563a';c.lineWidth=3;c.beginPath();c.moveTo(0,2);c.lineTo(0,-9);c.stroke()
  if(pine){c.fillStyle='#354933';c.beginPath();c.moveTo(0,-25);c.lineTo(-9,-5);c.lineTo(10,-5);c.closePath();c.fill();c.fillStyle='#4e6240';c.beginPath();c.moveTo(0,-25);c.lineTo(-6,-7);c.lineTo(0,-7);c.closePath();c.fill()}
  else{ellipse(c,0,-10,10,11,'#3e5438');ellipse(c,-4,-14,7,7,'#526740');ellipse(c,-5,-16,4,4,'#6c7a4c')}
  c.restore()
}
export function house(c:CanvasRenderingContext2D,x:number,y:number,scale=1,kind='house',accent='#a14d37'){
  c.save();c.translate(x,y);c.scale(scale,scale)
  ellipse(c,5,4,19,7,'#20231d4a')
  c.fillStyle='#b9ae8b';c.fillRect(-13,-17,25,21);c.fillStyle='#938e75';c.fillRect(6,-17,6,21)
  c.fillStyle=accent;c.beginPath();c.moveTo(-17,-17);c.lineTo(-3,-29);c.lineTo(16,-19);c.lineTo(2,-11);c.closePath();c.fill()
  c.fillStyle='#ca8054';c.beginPath();c.moveTo(-17,-17);c.lineTo(-3,-29);c.lineTo(2,-11);c.closePath();c.fill()
  c.fillStyle='#4e493b';c.fillRect(-7,-7,5,11);c.fillRect(4,-10,4,5)
  if(kind==='keep'){
    c.fillStyle='#c2bda0';c.fillRect(-18,-37,11,38);c.fillRect(12,-35,10,38)
    c.fillStyle='#8e947f';c.fillRect(-10,-37,3,38);c.fillRect(19,-35,3,38)
    c.fillStyle='#d2c9ab';for(let i=0;i<3;i++){c.fillRect(-19+i*5,-41,3,7);c.fillRect(11+i*5,-39,3,7)}
    c.strokeStyle='#5e563b';c.lineWidth=1;c.beginPath();c.moveTo(0,-30);c.lineTo(0,-57);c.stroke()
    c.fillStyle=accent;c.beginPath();c.moveTo(0,-56);c.lineTo(16,-52);c.lineTo(0,-46);c.closePath();c.fill()
  }
  c.restore()
}
function path(c:CanvasRenderingContext2D,points:number[][],width:number,color:string){
  c.strokeStyle=color;c.lineWidth=width;c.lineCap='round';c.lineJoin='round';c.beginPath();points.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.stroke()
}
export function makeTerrain(mode:'world'|'battle',terrain:Terrain='plains'):HTMLCanvasElement{
  const canvas=document.createElement('canvas');canvas.width=mode==='world'?WORLD_W:FIELD_W;canvas.height=mode==='world'?WORLD_H:FIELD_H
  const c=canvas.getContext('2d')!,w=canvas.width,h=canvas.height,rng=seeded(mode==='world'?98213:7230+terrain.length)
  c.fillStyle=mode==='world'?'#aaa879':'#969568';c.fillRect(0,0,w,h)
  const grad=c.createLinearGradient(0,0,w,h);grad.addColorStop(0,'#d0bd8025');grad.addColorStop(.5,'#61704738');grad.addColorStop(1,'#c2ad613a');c.fillStyle=grad;c.fillRect(0,0,w,h)
  for(let i=0;i<6000;i++){
    const x=rng()*w,y=rng()*h,r=rng()*13+1
    ellipse(c,x,y,r,r*.42,rng()>.5?'#e5d6950c':'#263c2709')
  }
  for(let i=0;i<1400;i++){
    const x=rng()*w,y=rng()*h;c.strokeStyle=rng()>.6?'#656f4128':'#cfbd7735';c.lineWidth=.8;c.beginPath();c.moveTo(x,y);c.lineTo(x+2,y-3);c.stroke()
  }
  if(mode==='world'){
    // Roads, irrigated fields, coastal ridges, and individually shaded tree clusters.
    path(c,[[155,285],[305,405],[420,445],[655,485],[910,550],[1050,660]],23,'#56573b22')
    path(c,[[155,285],[305,405],[420,445],[655,485],[910,550],[1050,660]],11,'#c3b585')
    path(c,[[305,405],[460,155],[605,280],[790,160],[1050,280]],9,'#c4b385')
    path(c,[[655,485],[605,280]],8,'#c9b689')
    for(let i=0;i<22;i++){
      const x=160+rng()*220,y=490+rng()*150;c.save();c.translate(x,y);c.rotate(-.25);c.fillStyle=i%2?'#9c9b60':'#b7a069';c.fillRect(-16,-9,32,18)
      c.strokeStyle='#6e744744';c.lineWidth=1;for(let k=-12;k<15;k+=4){c.beginPath();c.moveTo(k,-8);c.lineTo(k,8);c.stroke()}c.restore()
    }
    const river=[];for(let y=-40;y<h+50;y+=25)river.push([565+Math.sin(y/115)*35,y])
    path(c,river,35,'#5a665947');path(c,river,24,'#658e95');path(c,river,18,'#769ba0');path(c,river.map(([x,y])=>[x-6,y]),2,'#c2d1ba66')
    c.save();c.translate(535,425);c.rotate(.08);c.fillStyle='#b4ac89';c.fillRect(-22,-9,75,20);c.strokeStyle='#676d56';c.lineWidth=3;c.strokeRect(-22,-9,75,20);c.restore()
    const forests=[[100,100,150,85],[390,105,125,90],[810,340,120,90],[1000,115,110,90],[410,670,100,45],[100,595,95,110]]
    for(const [cx,cy,rx,ry]of forests){for(let i=0;i<65;i++){const a=rng()*Math.PI*2,r=Math.sqrt(rng());tree(c,cx+Math.cos(a)*rx*r,cy+Math.sin(a)*ry*r,.55+rng()*.6)}}
    for(let i=0;i<30;i++){
      const x=680+rng()*170,y=25+rng()*90,size=20+rng()*30
      c.fillStyle='#898b71';c.beginPath();c.moveTo(x-size,y+size*.4);c.lineTo(x,y-size*.8);c.lineTo(x+size,y+size*.4);c.closePath();c.fill()
      c.fillStyle='#b6b59c';c.beginPath();c.moveTo(x-size,y+size*.4);c.lineTo(x,y-size*.8);c.lineTo(x+5,y+size*.4);c.closePath();c.fill()
    }
    const labels=[[260,85,'O A K W O O D'],[300,600,'THE WESTERN FIELDS'],[868,70,'THE HIGH COUNTRY'],[898,696,'ASHEN MARCHES'] ] as const
    for(const [x,y,label]of labels){c.font='italic 15px Georgia';c.fillStyle='#3f4a3f77';c.textAlign='center';c.fillText(label,x,y)}
    for(let i=0;i<10;i++)house(c,585+rng()*45,278+rng()*25,.55,'house','#6e6553')
  }else{
    if(terrain==='highlands'){
      for(let i=6;i>0;i--){ellipse(c,650,285,190+i*14,135+i*9,`rgba(114,113,70,${.025+i*.007})`)}
      for(let i=3;i>=0;i--){c.strokeStyle='#d1c18c45';c.lineWidth=1;c.beginPath();c.ellipse(650,285,190-i*30,135-i*22,0,0,Math.PI*2);c.stroke()}
    }
    if(terrain==='river'){
      const river=[];for(let y=-30;y<h+40;y+=15)river.push([600+Math.sin(y/110)*32,y])
      path(c,river,89,'#687b6344');path(c,river,77,'#647f7e');path(c,river,62,'#789998');path(c,river.map(([x,y])=>[x-25,y]),2,'#c1ccb061')
      c.fillStyle='#9f9b7b';c.fillRect(515,305,175,91);c.fillStyle='#bcb18d';c.fillRect(515,313,175,73)
      c.strokeStyle='#696d59';c.lineWidth=4;c.strokeRect(515,305,175,91);c.lineWidth=1;for(let y=320;y<385;y+=10){c.beginPath();c.moveTo(515,y);c.lineTo(690,y);c.stroke()}
    }
    const woods=terrain==='woods'?[[525,185,99,115],[825,535,133,122]]:[[40,80,65,60],[1130,645,70,45]]
    for(const[cx,cy,rx,ry]of woods){const points=[];for(let i=0;i<(terrain==='woods'?130:40);i++){const a=rng()*Math.PI*2,r=Math.sqrt(rng());points.push([cx+Math.cos(a)*rx*r,cy+Math.sin(a)*ry*r])}points.sort((a,b)=>a[1]-b[1]);points.forEach(([x,y])=>tree(c,x,y,.5+rng()*.5))}
    path(c,[[0,350],[330,346],[800,348],[1200,352]],15,'#ccb98b32')
    for(let i=0;i<80;i++){ellipse(c,rng()*w,rng()*h,2+rng()*3,1+rng()*2,'#5b65584b')}
  }
  const vignette=c.createRadialGradient(w/2,h/2,h*.15,w/2,h/2,w*.65);vignette.addColorStop(0,'#151e1700');vignette.addColorStop(1,'#19241b50');c.fillStyle=vignette;c.fillRect(0,0,w,h)
  c.strokeStyle='#37443866';c.lineWidth=3;c.strokeRect(12,12,w-24,h-24)
  return canvas
}

export const CITY_NODES: {type:BuildingType;x:number;y:number}[]=[{type:'lumber',x:140,y:210},{type:'quarry',x:755,y:155},{type:'farm',x:140,y:420},{type:'market',x:480,y:340},{type:'barracks',x:655,y:330},{type:'stables',x:705,y:450},{type:'wall',x:405,y:190},{type:'storehouse',x:375,y:450}]
