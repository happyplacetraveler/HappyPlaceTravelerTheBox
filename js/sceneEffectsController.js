/*  sceneEffectsController.js – v1.0  (place inside js/ folder)
    Drives audio stems + camera-drop timeline for Cityscape Parallax.          */

let audioCtx, master, cameraRef;
let buffers = Object.create(null);
let ready   = false;
let basePath = '';

/* ────────────────────────────────────────────────────────────
   PUBLIC INITIALISER
   Called once from HTML after the camera exists.
────────────────────────────────────────────────────────────── */
export async function initEffects({ camera, audioPath = './media/Cityscape Sounds/' }) {
  if (ready) return;
  cameraRef = camera;
  // Store original field of view for zoom resets
  window._initialFov = cameraRef.fov;
  basePath  = audioPath.replace(/\/?$/, '/');
  audioCtx  = new (window.AudioContext || window.webkitAudioContext)();
  master    = audioCtx.createGain();
  master.connect(audioCtx.destination);
  await preloadAll();
  hookTriggers();
  ready = true;
  console.log('[Effects] initialised');
}

/* ────────────────────────────────────────────────────────────
   PUBLIC TRIGGER
   Fires build-up, drop, audio, and camera animation.
────────────────────────────────────────────────────────────── */
export async function triggerDropSequence() {
  if (!ready) { console.warn('[Effects] not ready'); return; }
  if (audioCtx.state === 'suspended') await audioCtx.resume();

  const T0 = audioCtx.currentTime + 0.15;   // small latency pad

  /* ambience ladder */
  cue('WIND_TRAFFIC-Level 1 wind and trafic.mp3',                        T0 +  0, { gain:-12, loop:true });
  cue('WIND_TRAFFIC-morning-traffic- level 2 with light wind i.mp3',     T0 + 26, { gain: -9, loop:true });
  cue('WIND_TRAFFIC-Level 3 traffic.mp3',                                T0 + 54, { gain: -6, loop:true });
  cue('WIND_TRAFFIC-level 5 traffic and maybe wind .mp3',                T0 + 73, { gain: -3, loop:true });

  /* heartbeat */
  // cue('heartbeat-89bpm-34936.mp3',               T0 +  5, { gain:-15, loop:true });
  // cue('heart-and-breath-suspense-196083.mp3',    T0 + 40, { gain:-18             });

  /* creak escalation */
  cue('CREAK-ship-creaking-24b-30119- level 2.mp3',                      T0 + 10, { gain:-12 });
  cue('CREAK-door-creak-02-79920 level 3.mp3',                           T0 + 18, { gain: -9 });
  cue('CREAK-creaking-wood-199971 - level 4.mp3',                        T0 + 32, { gain: -6 });
  cue('CREAK-scary creaking - level 5 - or maybe right before drop.mp3', T0 + 46, { gain: -3 });
  cue('CREAK-level 6 creaking - tension building .mp3',                  T0 + 60, { gain:  0 });
  cue('CREAK-level 7- about to drop .mp3',                               T0 + 68, { gain: +3 });
  // Start dynamic heartbeat that ramps rate and volume toward the drop and syncs sine-wave sway
  startHeartbeat(T0 + 5, T0 + 71);

  /* impact & fall */
  cue('TRAP-DOOR-door-slam-1-100245.mp3',      T0 + 72,    { gain:  0 });
  cue('terminal-velosity-17803.mp3',           T0 + 72.05, { gain: -3 });
  cue('shepard_tone_seamless-19159.mp3',       T0 + 72.10, { gain:-12, loop:true });
  cue('HANGING-hanging4-73491.mp3',            T0 + 84,    { gain:  0 });
  cue('052663_man-falling-85712.mp3',          T0 + 84,    { gain: -6 });

  /* global fade-out @ two-minute mark */
  master.gain.setValueAtTime(1,          T0 + 110);
  master.gain.linearRampToValueAtTime(0, T0 + 120);

  /* camera */
  dropCameraAt(audioCtx.currentTime, T0 + 71);
}

/* ─── internal helpers ───────────────────────────────────── */
function hookTriggers() {
  window.triggerDropSequence = triggerDropSequence;
  window.addEventListener('TRIGGER_DROP', triggerDropSequence);
}

const FILES = [
  'WIND_TRAFFIC-Level 1 wind and trafic.mp3',
  'WIND_TRAFFIC-morning-traffic- level 2 with light wind i.mp3',
  'WIND_TRAFFIC-Level 3 traffic.mp3',
  'WIND_TRAFFIC-level 5 traffic and maybe wind .mp3',
  'heartbeat-89bpm-34936.mp3',
  'heart-and-breath-suspense-196083.mp3',
  'CREAK-ship-creaking-24b-30119- level 2.mp3',
  'CREAK-door-creak-02-79920 level 3.mp3',
  'CREAK-creaking-wood-199971 - level 4.mp3',
  'CREAK-scary creaking - level 5 - or maybe right before drop.mp3',
  'CREAK-level 6 creaking - tension building .mp3',
  'CREAK-level 7- about to drop .mp3',
  'TRAP-DOOR-door-slam-1-100245.mp3',
  'HANGING-hanging4-73491.mp3',
  '052663_man-falling-85712.mp3',
  'terminal-velosity-17803.mp3',
  'shepard_tone_seamless-19159.mp3'
];

async function preloadAll() {
  await Promise.all(FILES.map(async name => {
    const url = encodeURI(basePath + name);
    const ab  = await fetch(url).then(r => r.arrayBuffer());
    buffers[name] = await audioCtx.decodeAudioData(ab);
  }));
}

function cue(name, when, { gain=0, loop=false, rate=1, pan=0 } = {}) {
  const buf = buffers[name];
  if (!buf) { console.warn('missing buffer', name); return; }
  const src = audioCtx.createBufferSource();
  src.buffer = buf;
  src.loop   = loop;
  src.playbackRate.setValueAtTime(rate, when);

  const g = audioCtx.createGain();
  g.gain.setValueAtTime(dbToGain(gain), when);

  if (pan !== 0) {
    const p = audioCtx.createStereoPanner();
    p.pan.setValueAtTime(pan, when);
    src.connect(p).connect(g).connect(master);
  } else {
    src.connect(g).connect(master);
  }
  src.start(when);
}
const dbToGain = db => Math.pow(10, db / 20);

/**
 * Starts a looping heartbeat that gradually speeds up and grows louder
 * as dropTime approaches, and calls animateSineWave() on each beat.
 */
function startHeartbeat(startTime, dropTime) {
  const bufferName = 'heartbeat-89bpm-34936.mp3';
  const buf = buffers[bufferName];
  if (!buf) { console.warn('missing buffer', bufferName); return; }
  const src = audioCtx.createBufferSource();
  src.buffer = buf;
  src.loop = true;

  // Gain node for volume control
  const gainNode = audioCtx.createGain();
  // Start quieter and slower
  gainNode.gain.setValueAtTime(dbToGain(-20), startTime);
  src.playbackRate.setValueAtTime(0.75, startTime);

  src.connect(gainNode).connect(master);
  src.start(startTime);

  // Ramp to faster (1.5×) and louder (–6 dB) by dropTime
  src.playbackRate.linearRampToValueAtTime(1.5, dropTime);
  gainNode.gain.linearRampToValueAtTime(dbToGain(-6), dropTime);

  // Function to fire on each beat
  const fireBeat = () => {
    const currentRate = src.playbackRate.value;
    // 89 BPM = 1.4833 Hz; adjust by playbackRate
    const freq = (89 / 60) * currentRate;
    if (typeof animateSineWave === 'function') {
      animateSineWave(freq);
    }
  };

  // Schedule repeated beat callbacks
  let timeoutId;
  const scheduleNext = () => {
    fireBeat();
    // Calculate milliseconds until next beat
    const ms = 60000 / (89 * src.playbackRate.value);
    timeoutId = setTimeout(scheduleNext, ms);
  };
  scheduleNext();

  // Stop scheduling after drop
  setTimeout(() => clearTimeout(timeoutId), (dropTime - startTime) * 1000);
}

/* ────────────────────────────────────────────────────────────
   DROP-CAMERA: now drives window.dropOffset instead of fighting render loop
────────────────────────────────────────────────────────────── */
function dropCameraAt(now, dropTime) {
  const delayMs = Math.max(0, (dropTime - now) * 1000);
  setTimeout(() => {
    // How far down to drop in world units
    const dropDistance = 8000;

    // Ensure THREE is in scope
    const THREE = window.THREE;

    if (typeof gsap !== 'undefined') {
      gsap.timeline()
        // Tilt the view down to 75° just before the drop
        .to(cameraRef.rotation, {
          x: THREE.MathUtils.degToRad(-40),
          duration: 0.5,
          ease: 'power2.inOut'
        }, 0)
        // Begin zoom-out as the drop starts (1.5× original FOV over 1s)
        .to(cameraRef, {
          fov: window._initialFov * 1.5,
          duration: 1,
          ease: 'power2.out',
          onUpdate: () => cameraRef.updateProjectionMatrix()
        }, 0.6)
        // Perform the drop offset animation
        .to(window, {
          dropOffset: -dropDistance,
          duration: 0.8,
          ease: 'power2.in'
        }, 0.6)
        .to(window, {
          dropOffset: -dropDistance * 0.85,
          duration: 0.4,
          ease: 'bounce.out'
        }, 1.4)
        // After landing, slowly restore zoom to original FOV over 1.5s
        .to(cameraRef, {
          fov: window._initialFov,
          duration: 1.5,
          ease: 'power2.inOut',
          onUpdate: () => cameraRef.updateProjectionMatrix()
        }, 1.8);
    } else {
      // Fallback: immediate static drop
      window.dropOffset = -dropDistance * 0.85;
    }
  }, delayMs);
}

// Expose trigger function globally in case hookTriggers wasn't called yet
window.initEffects = initEffects;
window.triggerDropSequence = triggerDropSequence;
