import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Html, OrbitControls, RoundedBox } from '@react-three/drei';
import * as THREE from 'three';
import type { StationLive } from '../../types';
import { STATE_COLOR } from '../../types';
import { DEPOT as P } from './depotPlan';
import './warehouse.css';

type V3 = [number, number, number];
type Part = { p: V3; s: V3; q?: THREE.Quaternion };
type Batch = Record<string, Part[]>;
type View = 'overview' | 'plan' | 'gangway' | 'racks' | 'mezzanine' | 'docks';
type Floor = 'both' | 'ground' | 'upper';
const C = { steel: '#e0d5b6', blue: '#12638b', beam: '#ba4c29', carton: '#b89059',
  lightBox: '#d1b587', darkBox: '#987247', tote: '#175495', floor: '#98988d', green: '#408f83', yellow: '#edc442' };
function add(b: Batch, c: string, p: V3, s: V3, q?: THREE.Quaternion) { (b[c] ||= []).push({p:[-p[0],p[1],p[2]],s,q:q ? new THREE.Quaternion(q.x,-q.y,-q.z,q.w) : undefined}); }
function beam(b: Batch, c: string, a: V3, z: V3, thick = .12) {
  const from = new THREE.Vector3(...a), to = new THREE.Vector3(...z), delta = to.clone().sub(from);
  add(b,c,from.add(to).multiplyScalar(.5).toArray() as V3,[thick,delta.length(),thick],
    new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),delta.normalize()));
}
function Instances({color, parts}: {color:string; parts:Part[]}) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const matrix = new THREE.Matrix4();
    parts.forEach((v,i) => ref.current?.setMatrixAt(i,matrix.compose(new THREE.Vector3(...v.p),v.q || new THREE.Quaternion(),new THREE.Vector3(...v.s))));
    if(ref.current) { ref.current.instanceMatrix.needsUpdate = true; ref.current.computeBoundingSphere(); }
  },[parts]);
  return <instancedMesh ref={ref} args={[undefined,undefined,parts.length]} castShadow receiveShadow>
    <boxGeometry/><meshStandardMaterial color={color} roughness={.77} metalness={color===C.blue || color===C.steel ? .25 : .03}/>
  </instancedMesh>;
}
function Batches({data}:{data:Batch}) { return <>{Object.entries(data).map(([c,p]) => <Instances key={c} color={c} parts={p}/>)}</>; }
function Box({p,s,c,metal=.1}: {p:V3;s:V3;c:string;metal?:number}) {
  return <mesh position={p} castShadow receiveShadow><boxGeometry args={s}/><meshStandardMaterial color={c} roughness={.65} metalness={metal}/></mesh>;
}
function Sign({text,p,width=12,size=1.2,flat=false}: {text:string;p:V3;width?:number;size?:number;flat?:boolean}) {
  const texture=useMemo(()=>{
    const cv=document.createElement('canvas'); cv.width=1024;cv.height=128;
    const ctx=cv.getContext('2d')!;ctx.fillStyle='#f3eddb';ctx.fillRect(0,0,1024,128);
    ctx.fillStyle='#263b3b';ctx.font='bold 46px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.fillText(text,512,64,980);const t=new THREE.CanvasTexture(cv);t.colorSpace=THREE.SRGBColorSpace;return t;
  },[text]);
  useEffect(()=>()=>texture.dispose(),[texture]);
  return <group position={p} rotation={flat?[-Math.PI/2,0,0]:[0,0,0]}>
    <mesh position={[0,0,.015]}><planeGeometry args={[width,size]}/><meshBasicMaterial map={texture}/></mesh>
    {!flat && <mesh position={[0,0,-.015]} rotation={[0,Math.PI,0]}><planeGeometry args={[width,size]}/><meshBasicMaterial map={texture}/></mesh>}
  </group>;
}

// Each rack is a row of bays. local u is the row length; vertical rows run back-to-front.
function rack(b:Batch,x:number,z:number,bays:number,tiers:number,base:number,horizontal=false,small=false) {
  const pitch=small?4.6:3.1, depth=small?1.1:2.1, rise=small?.78:(!horizontal && tiers===3 ? 1.35 : 1.8);
  const point=(u:number,y:number,v:number):V3=>horizontal?[x+u,base+y,z+v]:[x+v,base+y,z+u];
  const dims=(u:number,y:number,v:number):V3=>horizontal?[u,y,v]:[v,y,u];
  for(let i=0;i<=bays;i++) {
    const u=(i-bays/2)*pitch;
    for(const v of [-depth/2,depth/2]) add(b,C.steel,point(u,(tiers*rise+.35)/2,v),dims(.10,tiers*rise+.35,.10));
    // End-frame cross bracing is visible in the photo reference.
    for(let t=0;t<tiers;t++) beam(b,'#b2b8ab',point(u,t*rise+.2,-depth/2),point(u,(t+1)*rise,depth/2),.065);
  }
  for(let i=0;i<bays;i++) for(let t=0;t<tiers;t++) {
    const u=(i+.5-bays/2)*pitch, y=.25+t*rise;
    for(const v of [-depth/2,depth/2]) add(b,C.beam,point(u,y,v),dims(pitch,.12,.1));
    add(b,'#8c8c78',point(u,y-.07,0),dims(pitch-.1,.06,depth));
    const seed=(i*17+t*13+Math.round(x*7+z*11))>>>0;
    if(seed%11===0) continue;
    const n=small?5:2;
    for(let j=0;j<n;j++) {
      const uu=u-pitch*.43+(j+.5)*pitch*.86/n, ht=small?.46:.6+(seed+j)%4*.22;
      const color=small ? ((seed+j)%3===0?C.lightBox:C.tote) : [C.carton,C.lightBox,C.darkBox][(seed+j)%3];
      add(b,color,point(uu,y+.1+ht/2,0),dims(pitch*.78/n,ht,depth*.84));
      // Tape seams and paper labels break up the carton surfaces without texture downloads.
      if(!small) add(b,'#d8c194',point(uu,y+.105+ht,0),dims(.08,.018,depth*.84));
      add(b,'#ece5cf',point(uu,y+.25,depth*.43),dims(small?.16:.25,.12,.012));
    }
  }
}
function storage(floor:Floor):Batch {
  const b:Batch={};
  if(floor!=='upper') {
    for(let r=0;r<P.racks.lower.rows;r++) for(let k=0;k<3;k++)
      rack(b,-121+r*7.1,-43+k*30,P.racks.lower.bays,3,0);
  }
  if(floor!=='ground') {
    for(let r=0;r<P.racks.mezzanine.rows;r++)
      rack(b,-76.5,-54+r*5.6,P.racks.mezzanine.bays,3,P.mezzanine.elevation+.2,true,true);
  }
  for(let r=0;r<P.racks.rnr.rows;r++) for(let k=0;k<3;k++) rack(b,-19+r*5.7,-43+k*30,P.racks.rnr.bays,P.racks.rnr.tiers,0);
  for(let r=0;r<P.racks.primary.rows;r++) for(let k=0;k<2;k++) rack(b,49+r*6.8,-20+k*32,P.racks.primary.bays,4,0);
  for(let r=0;r<P.racks.reserve.rows;r++) for(let k=0;k<2;k++) rack(b,108+r*7.5,-20+k*32,P.racks.reserve.bays,4,0);
  for(let r=0;r<P.racks.pmsp.rows;r++) rack(b,86,-56+r*4.2,P.racks.pmsp.bays,3,0,true);
  return b;
}
function shell(floor:Floor,roof:boolean):Batch {
  const b:Batch={};
  // Full 255 × 120 building, with a separate 30 m canopy.
  add(b,C.floor,[0,-.2,0],[255,.4,120]);add(b,'#aaa79c',[0,-.23,75],[255,.36,30]);
  add(b,C.green,[0,.012,39],[255,.025,8]);
  for(const z of [35.2,42.8]) add(b,C.yellow,[0,.04,z],[255,.035,.13]);
  for(let x=-124;x<127;x+=8) add(b,'#e6dcc0',[x,.045,39],[3,.035,.12]);
  // Floor joints, safety outlines and pedestrian strip.
  for(let x=-127;x<=127;x+=8.5) add(b,'#898b81',[x,.015,0],[.035,.018,120]);
  for(let z=-60;z<=60;z+=10) add(b,'#898b81',[0,.017,z],[255,.018,.035]);
  add(b,'#547f6b',[0,.025,44],[255,.035,1.1]);
  // Rear corrugated wall and blue structural columns.
  add(b,'#b7b8ae',[0,6.5,-60],[255,13,.25]);
  for(let x=-126;x<128;x+=1.6) add(b,'#a5a99e',[x,6.5,-59.8],[.065,13,.1]);
  for(let x=-125;x<=125;x+=25) {
    for(const z of [-59,34,59,89]) add(b,C.blue,[x,6.5,z],[.45,13,.45]);
    add(b,C.steel,[x,12.6,15],[.25,.45,150]);
    if(roof) for(let z=-59;z<89;z+=10) {
      beam(b,C.steel,[x,11.8,z],[x,12.7,z+5],.13);beam(b,C.steel,[x,12.7,z+5],[x,11.8,z+10],.13);
    }
  }
  if(roof) {
    for(let z=-59;z<=89;z+=10) {
      add(b,C.steel,[0,12.7,z],[255,.22,.22]);
      add(b,'#c5c4b5',[0,13.15,z],[255,.1,6.8]); // daylight slots between roof panels
    }
    for(let x=-115;x<127;x+=20) for(let z=-45;z<80;z+=25) {
      add(b,'#f9f6d6',[x,11.3,z],[2.4,.12,.45]);beam(b,C.steel,[x,11.3,z],[x,12.7,z],.04);
    }
  }
  // Red fire main runs above the receiving zone.
  add(b,'#a14331',[0,9.9,55],[255,.16,.16]);
  for(let x=-120;x<126;x+=12) {
    // Blue rolling shutters at the canopy: an open lower 4.5 metres.
    add(b,C.blue,[x,7,60],[9,5,.18]);
    for(let y=4.6;y<9.5;y+=.32) add(b,'#227da4',[x,y,60.15],[9,.035,.08]);
  }
  // Mezzanine occupies the SAME footprint as the lower floor.
  if(floor!=='ground') {
    // Three slabs leave a genuine 6 × 6 m shaft at the goods lift.
    add(b,'#b7b29d',[-79.25,4.65,-12.5],[96.5,.3,95]);
    add(b,'#b7b29d',[-28.25,4.65,-16.5],[5.5,.3,87]);
    add(b,'#b7b29d',[-28.25,4.65,34],[5.5,.3,2]);
    for(let step=0;step<24;step++) add(b,'#aeb7a4',[-24,.1+step*.2,20+step*.35],[2,.12,.38]);
    for(const x of [-25,-23]) beam(b,C.yellow,[x,1.1,19.8],[x,5.9,28.4],.07);
    for(let x=-126;x<-25;x+=10) {
      add(b,C.steel,[x,2.3,32],[.22,4.6,.22]);
      add(b,C.yellow,[x,5.5,34.5],[.07,1.5,.07]);
    }
    for(const y of [5,5.65,6.2]) add(b,C.yellow,[-76.5,y,34.5],[102,.06,.06]);
    for(let z=-58;z<33;z+=10) {
      add(b,C.steel,[-26,2.3,z],[.22,4.6,.22]);
      add(b,C.yellow,[-26,5.5,z],[.07,1.5,.07]);
    }
    add(b,C.yellow,[-26,6.2,-12.5],[.07,.07,95]);
  }
  return b;
}
function staging():Batch {
  const b:Batch={};
  for(let section=0;section<9;section++) {
    const x=-115+section*28;
    for(let lane=0;lane<5;lane++) {
      const xx=x+lane*4;
      for(const edge of [-1.7,1.7]) add(b,C.yellow,[xx+edge,.04,51],[.08,.04,11]);
      add(b,C.yellow,[xx,.04,56.5],[3.4,.04,.08]);
      // Photo-reference blue cage dollies, parked nose-to-tail in sorting lanes.
      for(let k=0;k<2;k++) {
        const z=48+k*4.3;
        add(b,C.tote,[xx,.38,z],[2.6,.16,3]);
        for(const dx of [-1.22,1.22]) for(const dz of [-1.4,1.4]) {
          add(b,C.tote,[xx+dx,1.4,z+dz],[.065,2.05,.065]);
          add(b,'#343b39',[xx+dx,.15,z+dz],[.22,.3,.24]);
        }
        for(const y of [.85,1.45,2.25]) for(const dz of [-1.4,1.4]) add(b,C.tote,[xx,y,z+dz],[2.5,.05,.05]);
        const ht=.6+((lane+k+section)%3)*.45;
        add(b,[C.carton,C.lightBox,C.darkBox][(lane+section)%3],[xx,.5+ht/2,z],[2.25,ht,2.7]);
        add(b,'#e2ca96',[xx,.51+ht,z],[.1,.015,2.7]);
      }
    }
    // A cream packing bench with blue totes and yellow barrier.
    add(b,C.steel,[x+9,1,58],[7,.14,1.4]);
    for(const dx of [-3,0,3]) add(b,C.steel,[x+9+dx,.5,58],[.12,1,.12]);
    for(let k=0;k<5;k++) add(b,C.tote,[x+6+k*1.4,1.35,58],[1,.55,.8]);
  }
  return b;
}
function Wheel({p,r=.28}: {p:V3;r?:number}) {
  return <mesh position={p} rotation={[0,0,Math.PI/2]}><cylinderGeometry args={[r,r,.19,12]}/><meshStandardMaterial color="#262d2c" roughness={.9}/></mesh>;
}
function Dolly({z=0}: {z?:number}) {
  return <group position={[0,0,z]}>
    <Box p={[0,.35,0]} s={[1.25,.13,1.65]} c={C.tote}/>
    {[-.57,.57].flatMap(x=>[-.72,.72].map(z=><group key={`${x},${z}`}><Box p={[x,1,z]} s={[.045,1.35,.045]} c={C.tote}/><Wheel p={[x,.18,z]} r={.17}/></group>))}
    {[.7,1.05,1.6].map(y=><Box key={y} p={[0,y,-.73]} s={[1.2,.045,.045]} c={C.tote}/>)}
    <Box p={[0,.75,0]} s={[1.08,.65,1.4]} c={C.lightBox}/>
  </group>;
}
function Kururu() {
  return <group>
    <RoundedBox args={[1.05,.65,1.35]} radius={.22} position={[0,.65,-.25]}><meshStandardMaterial color="#83ae9d" roughness={.36} metalness={.25}/></RoundedBox>
    <Box p={[0,.27,.5]} s={[.95,.14,1.05]} c="#263c36"/>
    <RoundedBox args={[.76,1.25,.23]} radius={.08} position={[0,.95,.94]} rotation={[-.13,0,0]}><meshStandardMaterial color="#e9e5d4" roughness={.45}/></RoundedBox>
    <Box p={[0,1.58,.82]} s={[.85,.08,.12]} c="#242b2a"/>
    <Box p={[0,1.25,-.15]} s={[.68,.12,.5]} c="#29312f"/>
    <Wheel p={[0,.28,.83]}/><Wheel p={[-.46,.28,-.5]}/><Wheel p={[.46,.28,-.5]}/>
    <Sign text="TOYOTA" p={[0,1.24,1.08]} width={.55} size={.12}/>
    <Box p={[0,.3,-1.15]} s={[.08,.07,1.2]} c="#4e574e"/>
    <Dolly z={-2.4}/><Dolly z={-4.4}/>
  </group>;
}
function Forklift({p}: {p:V3}) {
  return <group position={[-p[0],p[1],p[2]]} rotation={[0,Math.PI/2,0]}>
    <RoundedBox args={[1.5,.85,2.1]} radius={.15} position={[0,.65,0]}><meshStandardMaterial color="#6f9d8b" roughness={.45}/></RoundedBox>
    {[-.7,.7].flatMap(x=>[-.65,.65].map(z=><Wheel key={`${x},${z}`} p={[x,.4,z]} r={.38}/>))}
    <Box p={[0,1.25,-.2]} s={[.7,.2,.65]} c="#252e2c"/>
    {[-.65,.65].flatMap(x=>[-.7,.7].map(z=><Box key={`${x},${z}`} p={[x,2,z]} s={[.075,2.3,.075]} c="#2d3633"/>))}
    <Box p={[0,3.1,0]} s={[1.45,.13,1.8]} c="#35443b"/>
    {[-.48,.48].map(x=><group key={x}><Box p={[x,2.2,1.18]} s={[.16,4.4,.18]} c="#303c37"/><Box p={[x,.5,2]} s={[.18,.09,1.9]} c="#a4aaa2"/></group>)}
    <Box p={[0,1.8,1.3]} s={[1.2,.14,.14]} c="#303c37"/>
  </group>;
}
function Traffic({playing}:{playing:boolean}) {
  const refs=useRef<(THREE.Group|null)[]>([]);const elapsed=useRef(0);
  useFrame((_,dt)=>{
    if(playing) elapsed.current+=Math.min(dt,.1);
    refs.current.forEach((g,i)=>{if(!g)return;const t=(elapsed.current*2.3+i*55)%238;
      g.position.x=i%2 ? 119-t : t-119; g.rotation.y=i%2?-Math.PI/2:Math.PI/2;});
  });
  return <>{[0,1,2,3].map(i=><group key={i} ref={el=>refs.current[i]=el} position={[-110+i*55,0,i%2?40.7:37.1]}><Kururu/></group>)}</>;
}
function Truck({x,color}:{x:number;color:string}) {
  return <group position={[x,0,73]}>
    <Box p={[0,1,0]} s={[3.1,.3,12]} c="#323d3c"/>
    <Box p={[0,3,0]} s={[3.5,3.8,10]} c={color}/>
    {Array.from({length:20},(_,i)=><Box key={i} p={[1.78,3,-4.75+i*.5]} s={[.06,3.7,.10]} c={color}/>)}
    <Box p={[0,2.05,6.15]} s={[3.4,3.1,2.6]} c={color}/>
    <Box p={[0,2.65,7.47]} s={[2.9,1.05,.035]} c="#477078"/>
    <Box p={[0,.9,7.55]} s={[3.5,.25,.15]} c="#d0cfc0"/>
    {[-1.55,1.55].flatMap(xx=>[-3,-1.6,6].map(z=><Wheel key={`${xx},${z}`} p={[xx,.75,z]} r={.65}/>))}
    <Box p={[0,2.65,-5.06]} s={[3.15,3,.04]} c="#2c3430"/>
    <Box p={[0,1.5,-4.9]} s={[2.7,.7,.15]} c={C.carton}/>
    <Box p={[0,.6,-8]} s={[3.4,.2,5.9]} c="#777f75"/>
  </group>;
}
function Lift({playing}:{playing:boolean}) {
  const ref=useRef<THREE.Group>(null);const time=useRef(0);
  useFrame((_,dt)=>{if(playing)time.current+=Math.min(dt,.1);if(ref.current)ref.current.position.y=(.5-.5*Math.cos(time.current*.32))*4.8;});
  return <group position={[28,0,30]}>
    {[-2,2].flatMap(x=>[-2,2].map(z=><Box key={`${x},${z}`} p={[x,3,z]} s={[.16,6,.16]} c={C.yellow}/>))}
    <group ref={ref}><Box p={[0,.2,0]} s={[4,.2,4]} c="#667c75"/><Dolly/></group>
    <Sign text="GOODS LIFT" p={[0,6.3,2.1]} width={5}/>
  </group>;
}
function Worker({p,turn=0}:{p:V3;turn?:number}) {
  return <group position={p} rotation={[0,turn,0]}>
    <Box p={[-.15,.48,0]} s={[.22,.85,.25]} c="#35423e"/><Box p={[.15,.48,0]} s={[.22,.85,.25]} c="#35423e"/>
    <Box p={[0,1.15,0]} s={[.64,.65,.35]} c="#263f4d"/>
    <Box p={[0,1.2,.19]} s={[.64,.055,.02]} c="#d9df94"/>
    <mesh position={[0,1.7,0]}><sphereGeometry args={[.19,12,10]}/><meshStandardMaterial color="#a77755"/></mesh>
    <mesh position={[0,1.84,0]}><sphereGeometry args={[.205,12,8,0,Math.PI*2,0,Math.PI/2]}/><meshStandardMaterial color="#e8e4d3"/></mesh>
    <Box p={[-.4,1.05,.15]} s={[.16,.52,.2]} c="#263f4d"/><Box p={[.4,1.05,.15]} s={[.16,.52,.2]} c="#263f4d"/>
    <Box p={[-.15,.09,.12]} s={[.24,.16,.4]} c="#272d2b"/><Box p={[.15,.09,.12]} s={[.24,.16,.4]} c="#272d2b"/>
  </group>;
}
function Fan({x,playing}:{x:number;playing:boolean}) {
  const spin=useRef<THREE.Group>(null);
  useFrame((_,dt)=>{if(playing&&spin.current)spin.current.rotation.z+=Math.min(dt,.1)*5;});
  return <group position={[x,7.8,48]}>
    <Box p={[0,2,0]} s={[.06,4,.06]} c={C.steel}/>
    <mesh><torusGeometry args={[.6,.045,8,32]}/><meshStandardMaterial color="#36433a"/></mesh>
    <group ref={spin}>{[0,1,2].map(i=><group key={i} rotation={[0,0,i*Math.PI*2/3]}><Box p={[0,.27,0]} s={[.18,.55,.04]} c="#4b5a4b"/></group>)}</group>
    {[0,1,2,3].map(i=><group key={i} rotation={[0,0,i*Math.PI/4]}><Box p={[0,0,.09]} s={[1.2,.015,.018]} c="#657266"/></group>)}
  </group>;
}
function MezzaninePickers({playing,detailed}:{playing:boolean;detailed:boolean}) {
  return <>{[0,1,2,3,4,5].map(i=><Picker key={i} index={i} playing={playing} detailed={detailed}/>)}</>;
}
function Picker({index,playing,detailed}:{index:number;playing:boolean;detailed:boolean}) {
  const group=useRef<THREE.Group>(null); const legs=useRef<THREE.Group>(null);const gun=useRef<THREE.Group>(null);const clock=useRef(index*6);
  const [phase,setPhase]=useState('Walking to bin'); const lastPhase=useRef('');
  const z=26.8-index*11.2;
  useFrame((_,dt)=>{
    if(playing)clock.current+=Math.min(dt,.1);
    const cycle=clock.current%36;const scanning=cycle>13&&cycle<19;
    const returning=cycle>=19;const progress=scanning?1:returning?1-(cycle-19)/17:cycle/13;
    if(group.current){group.current.position.x=48+progress*52;group.current.rotation.y=scanning?Math.PI:(returning?-Math.PI/2:Math.PI/2);}
    if(legs.current)legs.current.children.forEach((leg,i)=>leg.rotation.x=scanning?0:Math.sin(clock.current*6+i*Math.PI)*.4);
    if(gun.current)gun.current.rotation.x=scanning?-.3:.2;
    const next=scanning?'Scan confirmed':returning?'Taking parts to lift':'Walking to bin';
    if(next!==lastPhase.current){lastPhase.current=next;setPhase(next);}
  });
  return <group ref={group} position={[48,P.mezzanine.elevation+.2,z]}>
    <group ref={legs}>{[-.15,.15].map(x=><group key={x} position={[x,.9,0]}><Box p={[0,-.43,0]} s={[.23,.85,.26]} c="#283d48"/><Box p={[0,-.82,.1]} s={[.25,.16,.4]} c="#232c29"/></group>)}</group>
    <Box p={[0,1.22,0]} s={[.65,.7,.38]} c="#2e4956"/><Box p={[0,1.3,.2]} s={[.65,.07,.02]} c="#dce48f"/>
    <mesh position={[0,1.8,0]}><sphereGeometry args={[.2,12,10]}/><meshStandardMaterial color="#b37e58"/></mesh>
    <Box p={[-.4,1.04,.2]} s={[.17,.5,.2]} c="#2e4956"/>
    <group ref={gun} position={[.37,1.25,.22]}><Box p={[0,0,.12]} s={[.18,.19,.4]} c="#2e4956"/><Box p={[0,.1,.35]} s={[.21,.18,.35]} c="#222c2b"/><Box p={[0,-.06,.28]} s={[.12,.25,.12]} c="#222c2b"/><Box p={[0,.195,.34]} s={[.15,.012,.18]} c="#83dac7"/>
      {phase==='Scan confirmed'&&<mesh position={[0,.1,1]} rotation={[Math.PI/2,0,0]}><cylinderGeometry args={[.008,.008,1,5]}/><meshBasicMaterial color="#fa4c38"/></mesh>}
    </group>
    {detailed&&index===0&&<Html position={[0,2.65,0]} center style={{pointerEvents:'none'}}><div className="depot-picker"><b>RF PICKER {index+1}</b><span>A1 · Row {index+1} · Bin 018</span><strong>Pick {index+2} × filter kit</strong><small>{phase} · demo task</small></div></Html>}
  </group>;
}
function SafetyGates() {
  const data=useMemo(()=>{
    const b:Batch={};
    for(let x=-120;x<125;x+=12) {
      for(let i=0;i<10;i++) add(b,C.yellow,[x-4.5+i,1.1,62],[.045,1.8,.045]);
      for(const y of [.3,1.95])add(b,C.yellow,[x, y,62],[9,.05,.05]);
    }
    return b;
  },[]);
  return <Batches data={data}/>;
}
const CAMERAS:Record<View,{p:V3;t:V3}>= {
  overview:{p:[145,175,238],t:[0,0,10]}, plan:{p:[0,230,12],t:[0,0,11.9]},
  gangway:{p:[-11,4.2,42],t:[66,3.8,34]}, racks:{p:[-23.7,3.2,31],t:[-23.7,3,-35]},
  mezzanine:{p:[47,7.4,26.8],t:[90,6.5,26.8]}, docks:{p:[-22,4.7,57],t:[14,3,70]},
};
const INITIAL_CAMERA = {position: [145,175,238] as V3, fov:46,near:.1,far:2000};
function Camera({view,revision}:{view:View;revision:number}) {
  const {camera,controls,size}=useThree();
  useLayoutEffect(()=>{
    const target=CAMERAS[view];
    const center=new THREE.Vector3(...target.t);
    const pos=new THREE.Vector3(...target.p);
    // Fit the full footprint in narrow side-panels as well as expanded desktop views.
    if(view==='overview'||view==='plan') pos.sub(center).multiplyScalar(Math.max(1,1.65/(size.width/size.height))).add(center);
    camera.position.copy(pos); camera.lookAt(center);
    const ctrl=controls as unknown as {target:THREE.Vector3;update:()=>void}|undefined;
    if(ctrl){ctrl.target.copy(center);ctrl.update();}
    
  },[camera,controls,view,revision,size.width,size.height]);
  return null;
}
function DepotScene({floor,roof,playing,view,revision,stations,onSelect,selected}:{floor:Floor;roof:boolean;playing:boolean;view:View;revision:number;stations:StationLive[];onSelect:(id:string)=>void;selected:string|null}) {
  const racks=useMemo(()=>storage(floor),[floor]);const structure=useMemo(()=>shell(floor,roof),[floor,roof]);const staged=useMemo(staging,[]);
  const overhead=view==='overview'||view==='plan';
  return <>
    <color attach="background" args={['#d3dcd9']}/>
    <hemisphereLight args={['#eaf5ff','#79745c',2]}/><ambientLight intensity={.45}/>
    <directionalLight position={[45,110,70]} intensity={2.5} castShadow shadow-mapSize={[2048,2048]} shadow-camera-left={-155} shadow-camera-right={155} shadow-camera-top={110} shadow-camera-bottom={-110} shadow-camera-far={350} shadow-normalBias={.15}/>
    <Batches data={structure}/><Batches data={racks}/><Batches data={staged}/>
    <Traffic playing={playing}/><Lift playing={playing}/><SafetyGates/>
    {[-110,-78,-46,-14,18,50,82,114].map((x,i)=><group key={x}><Worker p={[x,0,57]} turn={i%2?0:Math.PI}/><Fan x={x} playing={playing}/></group>)}
    {floor!=='ground' && <MezzaninePickers playing={playing} detailed={view==='mezzanine'}/>}

    {[[-16.1,0,22],[45,0,-20],[103,0,10],[-65,0,31]].map((p,i)=><Forklift key={i} p={p as V3}/>)}
    {[-114,-91,-66,-39,-12,15,42,69,95,117].map((x,i)=><Truck key={x} x={x} color={['#ae5035','#3b6b91','#c09965'][i%3]}/>)}
    {[-117,-84,-51,-18,15,48,81,114].map((x,i)=><Sign key={x} text={['LOCAL RECEIVING','SORTING / PACKING','DEPOT SHIPPING','IN-HOUSE RECEIVING','R&R STAGING','D22 RECEIVING','D22 SORTING','D22 PACKING'][i]} p={[x,7.3,53]} width={23} size={1.6}/>)}
    <Sign text="GANGWAY  ·  TOW MOTORS / KURURUS / DOLLIES" p={[0,.07,39]} width={67} size={2.1} flat/>
    <Sign text="SMALL PARTS ONLY  ·  MEZZANINE" p={[77,6.6,35]} width={43} size={1.4}/>
    {overhead && P.zones.map(z=><Html key={z.name} position={[z.x,12,z.z]} center style={{pointerEvents:'none'}}><div className="depot-zone"><b>{z.name==='MEZZANINE' && floor==='ground'?'LOWER FLOOR':z.name}</b><span>{z.name==='MEZZANINE' && floor==='ground'?'Large parts · 3-tier racks':z.detail}</span></div></Html>)}
    {overhead && <><Html center position={[0,.2,91]}><div className="depot-dimension">255 m · TRUCK BAY CANOPY · 30 m deep</div></Html><Html center position={[132,0,0]}><div className="depot-dimension">120 m</div></Html></>}
    {stations.filter(s=>P.stationPositions[s.station_id]).map(s=>{
      const p=P.stationPositions[s.station_id]; if(floor==='ground'&&p[1]>4)return null;if(floor==='upper'&&['W4','W5'].includes(s.station_id))return null;
      return <mesh key={s.station_id} position={[p[0],p[1]+.4,p[2]]} onClick={e=>{e.stopPropagation();onSelect(s.station_id);}}>
        <cylinderGeometry args={[selected===s.station_id?1.5:.75,selected===s.station_id?1.5:.75,.12,20]}/><meshBasicMaterial color={STATE_COLOR[s.state]}/>
      </mesh>;
    })}
    <OrbitControls makeDefault minDistance={2} maxDistance={1100} maxPolarAngle={Math.PI*.495} enableDamping dampingFactor={.1}/>
    <Camera view={view} revision={revision}/>
  </>;
}
export function WarehouseDepot({stations,selected,onSelect,initialView='overview'}:{stations:StationLive[];selected:string|null;onSelect:(id:string)=>void;initialView?:View}) {
  const [view,setView]=useState<View>(initialView);const [floor,setFloor]=useState<Floor>('both');
  const [roof,setRoof]=useState(false);const [playing,setPlaying]=useState(true);const [revision,setRevision]=useState(0);
  const [expanded,setExpanded]=useState(false);
  useEffect(()=>{const close=(e:KeyboardEvent)=>{if(e.key==='Escape')setExpanded(false);};window.addEventListener('keydown',close);return()=>window.removeEventListener('keydown',close);},[]);
  const pick=(v:View)=>{setView(v);setRevision(n=>n+1);setRoof(!['overview','plan'].includes(v));if(v==='mezzanine')setFloor('upper');else if(v==='racks'||v==='gangway')setFloor('ground');};
  return <section className={'depot-view'+(expanded?' depot-expanded':'')} aria-label="Toyota depot warehouse model">
    <div className="depot-toolbar"><div><span className="depot-eyebrow">TOYOTA / BENGALURU</span><h3>Parts depot <span>Spatial twin</span></h3></div>
      <div className="depot-actions"><button onClick={()=>setPlaying(p=>!p)}>{playing?'Pause motion':'Resume motion'}</button><button onClick={()=>setExpanded(v=>!v)}>{expanded?'Close expanded view':'Expand view'}</button></div></div>
    <div className="depot-viewport">
      <Canvas shadows dpr={[1,1.5]} camera={INITIAL_CAMERA} gl={{antialias:true,powerPreference:'high-performance'}}>
        <DepotScene floor={floor} roof={roof} playing={playing} view={view} revision={revision} stations={stations} selected={selected} onSelect={onSelect}/>
      </Canvas>
      <nav className="depot-cameras" aria-label="Warehouse viewpoints">{([['overview','Overview'],['plan','Layout plan'],['gangway','Gangway'],['racks','Inside R&R'],['mezzanine','Mezzanine'],['docks','Truck bays']] as [View,string][]).map(([v,l])=><button key={v} aria-pressed={view===v} onClick={()=>pick(v)}>{l}</button>)}</nav>
      <div className="depot-layers"><span>STORAGE LEVEL</span>{([['both','Both floors'],['ground','Lower floor'],['upper','Mezzanine']] as [Floor,string][]).map(([f,l])=><button key={f} aria-pressed={floor===f} onClick={()=>setFloor(f)}>{l}</button>)}<label><input type="checkbox" checked={roof} onChange={e=>setRoof(e.target.checked)}/> Roof structure</label></div>
      <div className="depot-scale"><b>255 × 120 m</b><span>+ 30 m canopy · Mezzanine 102 × 95 m</span></div>
    </div>
    <div className="depot-caption"><span><i/> Reference-based layout · rack counts provisional</span><span>{stations.length?'Station markers use telemetry':'Layout preview · no station telemetry'} · Vehicle / picker activity illustrative</span><span>Drag to orbit · Scroll to zoom · Right-drag to pan</span></div>
  </section>;
}
