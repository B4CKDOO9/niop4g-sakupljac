(function() {
    const canvas = document.getElementById('bg-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const POINT_COUNT = 38;
    const CONNECTION_DIST = 160;
    const COLORS_LIGHT = { dot: ['#dc3545', '#007bff'], line: ['rgba(220,53,69,', 'rgba(0,123,255,'] };
    const COLORS_DARK  = { dot: ['#ff6b7a', '#4da6ff'], line: ['rgba(255,107,122,', 'rgba(77,166,255,'] };

    let pts = [];
    let W, H;

    function resize() {
        W = canvas.width  = window.innerWidth;
        H = canvas.height = window.innerHeight;
    }

    function initPoints() {
        pts = [];
        for (let i = 0; i < POINT_COUNT; i++) {
            pts.push({
                x: Math.random() * W,
                y: Math.random() * H,
                vx: (Math.random() - 0.5) * 0.5,
                vy: (Math.random() - 0.5) * 0.5,
                r: Math.random() * 5 + 4,
                col: i % 2
            });
        }
    }

    function draw() {
        const dark = document.body.classList.contains('dark-mode');
        const C = dark ? COLORS_DARK : COLORS_LIGHT;
        ctx.fillStyle = dark ? '#121212' : '#ffffff';
        ctx.fillRect(0, 0, W, H);

        for (let i = 0; i < pts.length; i++) {
            for (let j = i + 1; j < pts.length; j++) {
                const dx = pts[i].x - pts[j].x;
                const dy = pts[i].y - pts[j].y;
                const d  = Math.sqrt(dx*dx + dy*dy);
                if (d < CONNECTION_DIST) {
                    const alpha = (1 - d / CONNECTION_DIST) * 0.35;
                    ctx.beginPath();
                    ctx.strokeStyle = C.line[pts[i].col] + alpha + ')';
                    ctx.lineWidth = 2;
                    ctx.moveTo(pts[i].x, pts[i].y);
                    ctx.lineTo(pts[j].x, pts[j].y);
                    ctx.stroke();
                }
            }
        }

        for (let p of pts) {
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
            ctx.fillStyle = C.dot[p.col];
            ctx.globalAlpha = 0.7;
            ctx.fill();
            ctx.globalAlpha = 1;
        }
    }

    function update() {
        for (let p of pts) {
            p.x += p.vx;
            p.y += p.vy;
            if (p.x < 0 || p.x > W) p.vx *= -1;
            if (p.y < 0 || p.y > H) p.vy *= -1;
        }
    }

    function loop() {
        update();
        draw();
        requestAnimationFrame(loop);
    }

    resize();
    initPoints();
    loop();
    window.addEventListener('resize', () => { resize(); initPoints(); });
})();