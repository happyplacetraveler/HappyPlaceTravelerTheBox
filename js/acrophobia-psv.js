// js/acrophobia-psv.js

let viewer, startTime;
let flightShown = false, crossFadeStarted = false;
const flightText  = document.getElementById('flightText');
const fadeOverlay = document.getElementById('fadeOverlay');

window.addEventListener('load', () => {
  viewer = new PhotoSphereViewer.Viewer({
    container: document.querySelector('#viewer'),
    panorama:  'media/Dark_mermaid_scene.jpg',
    depthmap:  'media/Dark_mermaid_depth_map.jpg',
    autorotateSpeed: '0.05rpm',
    mousemove: true,
    navbar: false,
    loadingImg: 'assets/HAPPYPLACETRAVELER-LOGO-FOR-JUNE2025-WEBSITR.png'
  });

  document.getElementById('beginBtn')
    .addEventListener('click', onReadyClicked);
});

function onReadyClicked() {
  // Fade out overlay
  const intro = document.getElementById('beginOverlay');
  intro.style.transition     = 'opacity 1s ease';
  intro.style.opacity        = 0;
  intro.style.pointerEvents  = 'none';
  setTimeout(() => { intro.style.display = 'none'; }, 1000);

  // Bloom viewer
  const viewerEl = document.querySelector('.viewer');
  viewerEl.style.transition = 'filter 1s ease';
  requestAnimationFrame(() => {
    viewerEl.style.filter = 'brightness(100%)';
  });

  // Start timeline
  setTimeout(() => {
    startTime = performance.now();
    requestAnimationFrame(tick);
  }, 1000);
}

function tick(now) {
  const t = (now - startTime) / 1000;

  // 10s → flight prompt
  if (t >= 10 && !flightShown) {
    flightShown = true;
    flightText.style.display    = 'flex';
    flightText.style.opacity    = 0;
    flightText.style.transition = 'opacity 1s ease';
    requestAnimationFrame(() => flightText.style.opacity = 1);
    setTimeout(() => {
      flightText.style.opacity = 0;
      setTimeout(() => { flightText.style.display = 'none'; }, 1000);
    }, 5000);
  }

  // 15s → cross-fade to city
  if (t >= 15 && !crossFadeStarted) {
    crossFadeStarted = true;
    fadeOverlay.style.transition = 'opacity 2.5s ease';
    fadeOverlay.style.opacity    = 1;
    setTimeout(() => {
      viewer.setPanorama('media/Color_Cityscape.jpg', {
        depth: 'media/Depth_Cityscape.jpg'
      });
      fadeOverlay.style.opacity = 0;
    }, 2500);
  }

  if (t < 20) {
    requestAnimationFrame(tick);
  }
}
