// js/acrophobia.js
// — Acrophobia Demo up to 20s, with .jpg/.jpeg fallback —

let scene, camera, renderer, sphereGroup, clock;
let startTime, flightShown = false, crossFadeStarted = false;
let flightText, fadeOverlay;
let cityColorTex, cityDepthTex;

function loadTextureWithFallback(baseName) {
  const loader = new THREE.TextureLoader();
  return loader.load(
    `media/${baseName}.jpg`,
    undefined,
    undefined,
    () => loader.load(`media/${baseName}.jpeg`)
  );
}

window.addEventListener('load', () => {
  initThreeScene();
  flightText  = document.getElementById('flightText');
  fadeOverlay = document.getElementById('fadeOverlay');
  document.getElementById('beginBtn')
    .addEventListener('click', onReadyClicked);
});

function onReadyClicked() {
  const intro = document.getElementById('beginOverlay');
  intro.style.transition     = 'opacity 1s ease';
  intro.style.opacity        = 0;
  intro.style.pointerEvents  = 'none';
  setTimeout(() => { intro.style.display = 'none'; }, 1000);

  const canvas = document.getElementById('threeCanvas');
  canvas.style.transition = 'filter 1s ease';
  requestAnimationFrame(() => {
    canvas.style.filter = 'brightness(100%)';
  });

  setTimeout(() => {
    startTime = performance.now();
    requestAnimationFrame(tick);
  }, 1000);
}

function initThreeScene() {
  const canvas = document.getElementById('threeCanvas');
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);

  scene  = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(
    75, window.innerWidth/window.innerHeight, 0.1, 2000
  );
  camera.position.set(0, 0, 0.1);
  scene.add(new THREE.AmbientLight(0xffffff, 1));

  const mermaidColor = loadTextureWithFallback('Dark_mermaid_scene');
  const mermaidDepth = loadTextureWithFallback('Dark_mermaid_depth_map');
  mermaidDepth.minFilter     = THREE.LinearFilter;
  mermaidDepth.generateMipmaps = false;

  cityColorTex = loadTextureWithFallback('Color_Cityscape');
  cityDepthTex = loadTextureWithFallback('Depth_Cityscape');
  cityDepthTex.minFilter     = THREE.LinearFilter;
  cityDepthTex.generateMipmaps = false;

  const geo = new THREE.SphereBufferGeometry(500, 200, 100);
  geo.scale(-1, 1, 1);
  const mat = new THREE.MeshStandardMaterial({
    map: mermaidColor,
    displacementMap: mermaidDepth,
    displacementScale: 20,
    displacementBias: -10,
    roughness: 1,
    metalness: 0
  });

  sphereGroup = new THREE.Group();
  sphereGroup.add(new THREE.Mesh(geo, mat));
  scene.add(sphereGroup);

  let targetX = 0, targetY = 0;
  window.addEventListener('mousemove', e => {
    targetX = (e.clientY / window.innerHeight - 0.5) * 0.05;
    targetY = (e.clientX / window.innerWidth  - 0.5) * 0.05;
  });
  window.addEventListener('mouseout', () => {
    targetX = targetY = 0;
  });

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth/window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  clock = new THREE.Clock();
  (function animate() {
    requestAnimationFrame(animate);
    const t = clock.getElapsedTime();
    sphereGroup.rotation.y += 0.0002;
    sphereGroup.position.y   = Math.sin(t * 0.5) * 0.5;
    sphereGroup.rotation.z   = Math.sin(t * 0.2) * 0.02;
    sphereGroup.rotation.x += (targetX - sphereGroup.rotation.x) * 0.05;
    sphereGroup.rotation.y += (targetY - sphereGroup.rotation.y) * 0.05;
    renderer.render(scene, camera);
  })();
}

function tick(now) {
  const elapsed = (now - startTime) / 1000;

  if (elapsed >= 10 && !flightShown) {
    flightShown = true;
    flightText.style.display    = 'flex';
    flightText.style.opacity    = 0;
    flightText.style.transition = 'opacity 1s ease';
    requestAnimationFrame(() => { flightText.style.opacity = 1; });
    setTimeout(() => {
      flightText.style.opacity = 0;
      setTimeout(() => { flightText.style.display = 'none'; }, 1000);
    }, 5000);
  }

  if (elapsed >= 15 && !crossFadeStarted) {
    crossFadeStarted = true;
    fadeOverlay.style.transition = 'opacity 2.5s ease';
    fadeOverlay.style.opacity    = 1;
    setTimeout(() => {
      const mesh = sphereGroup.children[0];
      mesh.material.map             = cityColorTex;
      mesh.material.displacementMap = cityDepthTex;
      mesh.material.needsUpdate     = true;
      fadeOverlay.style.opacity     = 0;
    }, 2500);
  }

  if (elapsed < 20) {
    requestAnimationFrame(tick);
  }
}
