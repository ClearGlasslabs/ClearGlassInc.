#!/usr/bin/env python3
"""
ClearGlass Inc. Web Visual Enhancement Injector

Injects a lightweight GPU-friendly visual layer into static HTML pages.
Features:
- Canvas particle network background
- Scroll reveal animations
- Glass UI support
- Pointer parallax
- GitHub Pages compatible output

No proprietary frameworks or restricted technology are used.
"""

from pathlib import Path

ANIMATION_SCRIPT = r'''
<script>
(() => {
if (document.getElementById('particle-layer')) return;

const css = document.createElement('style');
css.textContent = `
body { overflow-x:hidden; }
.fade-reveal { opacity:0; transform:translateY(40px); transition:.8s ease; }
.fade-reveal.visible { opacity:1; transform:none; }
.glass-card { backdrop-filter:blur(16px); background:rgba(255,255,255,.05); }
.float-animation { animation:cgFloat 6s ease-in-out infinite; }
@keyframes cgFloat {50% {transform:translateY(-12px)}}
#particle-layer {position:fixed;inset:0;pointer-events:none;z-index:-1;}
`;
document.head.appendChild(css);

const canvas=document.createElement('canvas');
canvas.id='particle-layer';
document.body.appendChild(canvas);
const ctx=canvas.getContext('2d');
let particles=[];
function resize(){canvas.width=innerWidth;canvas.height=innerHeight;}
resize(); addEventListener('resize',resize);
for(let i=0;i<120;i++) particles.push({x:Math.random()*innerWidth,y:Math.random()*innerHeight,vx:(Math.random()-.5),vy:(Math.random()-.5),r:Math.random()*2+1});
function loop(){
ctx.clearRect(0,0,canvas.width,canvas.height);
particles.forEach(p=>{
 p.x+=p.vx;p.y+=p.vy;
 if(p.x<0||p.x>canvas.width)p.vx*=-1;
 if(p.y<0||p.y>canvas.height)p.vy*=-1;
 ctx.beginPath();ctx.arc(p.x,p.y,p.r,0,Math.PI*2);ctx.fill();
});
requestAnimationFrame(loop);
}
loop();

const observer=new IntersectionObserver(entries=>entries.forEach(e=>e.isIntersecting&&e.target.classList.add('visible')),{threshold:.1});
document.querySelectorAll('section,div,h1,h2,h3,p,img').forEach(e=>{e.classList.add('fade-reveal');observer.observe(e);});
})();
</script>
'''


def inject(path: Path):
    html = path.read_text(encoding='utf-8')
    if 'particle-layer' in html:
        return
    if '</body>' not in html:
        return
    path.write_text(html.replace('</body>', ANIMATION_SCRIPT + '\n</body>'), encoding='utf-8')
    print(f'Enhanced: {path}')


def scan(root='.'): 
    for html in Path(root).rglob('*.html'):
        inject(html)


if __name__ == '__main__':
    scan()
    print('ClearGlass visual enhancement complete.')
