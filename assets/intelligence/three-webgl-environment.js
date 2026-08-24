// ClearGlass Intelligence WebGL Environment
// Lightweight Three.js module with graceful fallback support.

export function createIntelligenceEnvironment(canvas) {
  if (!window.THREE || !canvas) return null;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });

  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);

  camera.position.z = 5;

  const geometry = new THREE.BufferGeometry();
  const points = new Float32Array(900);
  for (let i = 0; i < points.length; i++) points[i] = (Math.random() - 0.5) * 12;
  geometry.setAttribute('position', new THREE.BufferAttribute(points, 3));

  const material = new THREE.PointsMaterial({ size: 0.02 });
  scene.add(new THREE.Points(geometry, material));

  function animate() {
    requestAnimationFrame(animate);
    renderer.render(scene, camera);
  }

  animate();
  return { scene, camera, renderer };
}
