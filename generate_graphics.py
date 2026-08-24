"""
ClearGlassInc Animated Intelligence Background Generator
Generates browser-ready HTML canvas graphics from Python.
"""

from pathlib import Path

HTML = r'''<canvas id="bg"></canvas>
<style>
html, body {
    margin: 0;
    overflow: hidden;
    background: #050816;
}
#bg {
    position: fixed;
    inset: 0;
    width: 100%;
    height: 100%;
}
</style>
<script>
const canvas = document.getElementById("bg");
const ctx = canvas.getContext("2d");
const particles = [];

function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}
resize();
window.addEventListener("resize", resize);

for (let i = 0; i < 150; i++) {
    particles.push({
        x: Math.random() * innerWidth,
        y: Math.random() * innerHeight,
        vx: (Math.random() - .5) * 1.5,
        vy: (Math.random() - .5) * 1.5,
        r: Math.random() * 3 + 1
    });
}

function animate() {
    ctx.fillStyle = "#050816";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    particles.forEach(p => {
        p.x += p.vx;
        p.y += p.vy;

        if (p.x < 0 || p.x > canvas.width) p.vx *= -1;
        if (p.y < 0 || p.y > canvas.height) p.vy *= -1;

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = "#00d4ff";
        ctx.fill();

        particles.forEach(o => {
            const dx = p.x - o.x;
            const dy = p.y - o.y;
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (dist < 150) {
                ctx.beginPath();
                ctx.moveTo(p.x, p.y);
                ctx.lineTo(o.x, o.y);
                ctx.strokeStyle = `rgba(0,212,255,${1 - dist / 150})`;
                ctx.stroke();
            }
        });
    });

    requestAnimationFrame(animate);
}

animate();
</script>'''

Path("advanced-background.html").write_text(HTML, encoding="utf-8")
print("Generated advanced-background.html")
