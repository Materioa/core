<script lang="ts">
  import { onMount } from "svelte";
  import { fade } from "svelte/transition";

  // A single continuous scene: one Bud face, props (book / laptop / cup / Zzz)
  // morph in and out around him. Nothing ever remounts, so blinks, breathing
  // and the cup glide carry across moments like one animated film.

  export type DayPhaseId = "idle" | "coffee" | "work" | "reading" | "nap";
  type Activity = "idle" | "drinking" | "working" | "reading" | "sleeping";

  export interface DayPhase {
    id: DayPhaseId;
    label: string;
    caption: string;
    activity: Activity;
    durFactor: number;
    speedFactor: number;
  }

  const PHASES: DayPhase[] = [
    { id: "idle", label: "Waking up", caption: "Gaze drifts, curious about your cursor.", activity: "idle", durFactor: 0.8, speedFactor: 0.8 },
    { id: "coffee", label: "Morning coffee", caption: "Bud eases in — warm cup, slow blinks.", activity: "drinking", durFactor: 1.0, speedFactor: 1.0 },
    { id: "work", label: "Deep work", caption: "Heads down — typing behind the lid, gaze on the screen.", activity: "working", durFactor: 1.4, speedFactor: 1.15 },
    { id: "reading", label: "Reading break", caption: "Pages turning, eyes sweeping line to line.", activity: "reading", durFactor: 1.5, speedFactor: 1.0 },
    { id: "nap", label: "Power nap", caption: "Head droops onto the desk, Zzz drifts up.", activity: "sleeping", durFactor: 1.3, speedFactor: 0.7 },
  ];

  let {
    class: className = "",
    autoPlay = true,
    phaseDuration = 5200,
    showTimeline = true,
    showCaption = true,
    showControls = true,
    speed = 1.0,
    interactive = true,
    onphasechange,
  }: {
    class?: string;
    autoPlay?: boolean;
    phaseDuration?: number;
    showTimeline?: boolean;
    showCaption?: boolean;
    showControls?: boolean;
    speed?: number;
    interactive?: boolean;
    onphasechange?: (phase: DayPhase) => void;
  } = $props();

  let index = $state(0);
  // svelte-ignore state_referenced_locally
  let playing = $state(autoPlay);
  let current = $derived(PHASES[index]);

  // Non-reactive bridge into the animation loop
  let pendingBlink = false;

  function clampSpeed(s: number) {
    return Math.max(0.2, Math.min(3.5, s));
  }

  function phaseMs(phase: DayPhase) {
    return Math.max(1500, (phaseDuration * phase.durFactor) / clampSpeed(speed));
  }

  let timeout: ReturnType<typeof setTimeout> | undefined;

  function clearTimer() {
    if (timeout) clearTimeout(timeout);
    timeout = undefined;
  }

  function schedule() {
    clearTimer();
    if (!playing) return;
    timeout = setTimeout(() => advance(1), phaseMs(PHASES[index]));
  }

  function setPhase(i: number) {
    index = (index + i + PHASES.length) % PHASES.length;
    pendingBlink = true; // attention-shift blink into the new moment
    onphasechange?.(PHASES[index]);
    schedule();
  }

  function advance(dir: number) {
    setPhase(dir);
  }

  export function next() {
    advance(1);
  }

  export function prev() {
    advance(-1);
  }

  export function goTo(id: DayPhaseId) {
    const i = PHASES.findIndex((p) => p.id === id);
    if (i >= 0 && i !== index) {
      const delta = (i - index + PHASES.length) % PHASES.length;
      setPhase(delta);
    }
  }

  export function getPhase() {
    return PHASES[index];
  }

  function togglePlay() {
    playing = !playing;
    if (playing) schedule();
    else clearTimer();
  }

  // ---------- shared Bud vectors (pristine, from bud.svg) ----------
  const NOSE_STEM_PATH =
    "M154.573 2C164.716 2.25175 172.946 6.6995 180.92 12.6555C183.102 14.2855 187.969 17.3385 188.265 20.299C188.334 20.997 188.148 21.637 187.692 22.1718C186.988 22.998 185.702 23.6418 184.612 23.2675C182.526 22.5518 180.597 20.491 178.829 19.198C172.375 14.4765 163.201 9.05075 154.954 9.686C150.546 10.0253 146.913 12.315 144.119 15.6573C126.677 36.5213 131.45 117.61 133.793 145.205L144.224 132.903C149.182 127.081 154.285 118.568 162.481 125.283C164.572 127.681 166.273 132.245 163.994 135.02C151.005 150.837 134.867 164.928 122.331 181.092C122.117 175.096 121.105 169.08 120.705 163.084C118.538 130.612 115.602 35.1083 137.279 10.6485C141.896 5.43851 147.62 2.38075 154.573 2Z";

  const LEFT_EYE_PATH =
    "M95.5129 66.4331C104.451 65.8273 106.496 69.4208 111.284 76.2528C116.699 82.5063 111.621 90.5116 107.237 81.2706C97.5494 60.8471 84.8746 84.5083 81.9534 95.8526C85.6414 90.8178 91.3236 85.9086 97.5069 91.2546C101.064 94.3301 101.307 99.8333 101.468 104.253C101.247 109.301 100.699 113.337 98.3891 118.038C96.3839 122.119 91.7436 126.619 87.3751 127.984C84.0891 129.016 80.5266 128.688 77.4841 127.074C63.6401 119.611 70.8529 94.6858 77.3034 84.2106C82.0294 76.5358 86.1959 69.0726 95.5129 66.4331Z";

  const RIGHT_EYE_PATH =
    "M167.025 44.4704C172.355 44.1429 175.969 46.6149 179.161 50.6439C181.069 53.0519 188.206 63.6356 180.965 63.4526C179.424 63.4139 176.871 57.9436 176.037 56.8029C173.966 53.7129 172.454 51.9826 168.556 51.0886C160.21 53.3166 154.759 66.2456 152.303 73.8451C154.795 70.8254 157.961 67.0404 162.19 67.1524C170.899 67.3834 171.782 76.9191 171.792 83.2724C171.551 88.8779 170.398 94.0674 167.162 98.7834C164.723 102.339 160.352 105.787 156.027 106.538C152.676 107.12 149.232 106.34 146.459 104.371C132.467 94.2824 143.909 65.2676 152.4 54.8404C156.484 49.8239 160.309 45.4891 167.025 44.4704Z";

  const LEFT_BROW_PATH =
    "M93.6561 22.4892C99.1249 21.7517 105.953 24.2347 110.326 27.3962C112.412 28.9042 116.383 32.2214 116.721 34.9364C117.313 39.6847 110.834 43.7487 107.124 40.0754C105.427 38.4307 103.996 36.3007 102.262 34.9142C99.5189 32.7524 96.0224 31.7834 92.5579 32.2252C83.2604 33.3494 75.0191 42.5322 69.6109 49.5404C65.6656 54.8812 62.9979 59.6997 60.0876 65.5967C59.4291 66.9309 58.9096 67.9312 57.5631 68.3199C57.0536 68.2497 56.6429 68.1509 56.2166 67.8459C55.7289 67.4967 55.4516 67.1182 55.3621 66.5182C54.9241 63.5837 63.3801 47.5589 65.1886 44.5614C66.9624 41.6139 68.9379 38.7924 71.1009 36.1174C77.0971 28.7369 83.8534 23.4872 93.6561 22.4892Z";

  const FULL_BOOK_PATH =
    "M84.8089 209.83C84.7639 209.713 84.7182 209.595 84.6719 209.477C83.2282 205.83 80.7767 202.165 78.6694 198.852C66.9827 180.478 48.8159 166.992 27.8927 161.002C25.1052 160.26 22.5244 159.639 19.7832 158.71C16.2669 157.519 16.8759 152.234 19.7044 151.751C23.1009 151.419 27.2227 153.072 30.4582 154.014C45.4212 158.349 59.8564 166.623 70.9597 177.579C85.6839 192.108 97.5197 214.513 102.557 234.518C104.083 232.305 108.091 228.05 110.049 225.933C120.738 214.378 131.876 203.735 144.601 194.46C165.983 178.879 189.468 170.153 215.793 168.087C219.841 167.769 228.448 167.121 232.263 167.723C233.691 169.263 235.076 171.309 233.586 173.273C231.743 175.704 224.903 175.103 222.131 175.212C217.978 175.351 213.838 175.698 209.721 176.249C178.219 180.648 155.771 192.825 132.295 214.227C129.002 217.227 121.372 224.25 118.846 227.595C125.306 224.635 131.538 221.162 137.991 218.167C160.752 207.6 184.962 198.418 209.891 194.673C214.986 193.908 242.001 191.115 245.858 194.382C246.671 195.07 246.841 196.78 246.981 197.775C247.906 204.448 247.953 211.48 248.393 218.213C249.341 232.723 250.208 247.253 251.353 261.745C250.218 262.663 245.658 264.36 244.236 264.347C244.076 263.69 243.936 263.028 243.813 262.36 C243.501 254.318 242.766 245.61 242.236 237.528L239.771 200.658C197.823 197.883 152.817 218.14 116.567 237.435C112.588 239.553 105.361 244.16 101.165 245.645C97.4217 246.973 96.4019 238.64 95.1512 236.02C82.5499 209.64 53.4677 194.853 26.7219 186.783C20.9992 185.053 15.4917 184.078 9.74591 182.833L17.1809 264.95L16.9847 265.32C16.0064 265.552 11.9077 264.075 10.7744 263.655C9.70442 263.258 9.75142 263.235 9.41542 262.44C8.98342 256.177 8.24041 249.45 7.67341 243.162L4.04516 203.257C3.36341 195.795 2.65217 188.345 2.09542 180.87C1.43767 174.612 4.20891 174.433 9.53116 175.317C36.4204 179.781 64.8402 190.95 84.8089 209.83Z";

  // Page easing lives inside pageStrokeD (cosine in-out, exact landings).

  // Page surface as a single morphing chalk stroke over the blue mass.
  // e = 0 → resting on the left, e = 1 → resting on the right, arc in between.
  // archP drives the lift. The same element bends through the whole turn:
  // the yellow still page converts into the green flyer, nothing swaps in.
  function pageStrokeD(u: number, archP: number): string {
    const c = Math.min(Math.max(u, 0), 1);
    const e = 0.5 - 0.5 * Math.cos(c * Math.PI);
    // Tip leads with a fast start (no lingering stalk); body follows on cosine
    const et = 1 - (1 - c) * (1 - c);
    const arch = Math.sin(Math.min(Math.max(archP, 0), 1) * Math.PI) * 30;
    const sx = 102.6, sy = 230.5;
    const tx = 19.7 + (232.3 - 19.7) * et;
    const ty = 147.8 + (163.7 - 147.8) * et - arch;
    const c1x = 71.0 + (144.6 - 71.0) * e;
    const c1y = 173.6 + (190.5 - 173.6) * e - arch * 0.6;
    const c2x = 30.5 + (215.8 - 30.5) * e;
    const c2y = 150.0 + (164.1 - 150.0) * e - arch * 0.9;
    return `M ${sx} ${sy} C ${c1x.toFixed(1)} ${c1y.toFixed(1)} ${c2x.toFixed(1)} ${c2y.toFixed(1)} ${tx.toFixed(1)} ${ty.toFixed(1)}`;
  }

  // Idle drift poses (from BudLogo's curious glance set)
  const IDLE_POSES = [
    { eyeX: -9.5, eyeY: -7.0, browX: -4.5, browY: -5.5, browRot: 2.8, stemRot: -3.2, stemX: -2.0, stemY: -2.5, bodyRot: -2.4, bodyX: -2.0, bodyY: -1.0, duration: 3000 },
    { eyeX: 10.5, eyeY: -2.0, browX: 5.0, browY: -2.0, browRot: -2.2, stemRot: 3.8, stemX: 2.5, stemY: -1.2, bodyRot: 2.8, bodyX: 2.0, bodyY: 0, duration: 2600 },
    { eyeX: 1.0, eyeY: 9.0, browX: 0.5, browY: 4.8, browRot: 0.5, stemRot: 0.8, stemX: 0.5, stemY: 3.2, bodyRot: 1.2, bodyX: 0, bodyY: 1.6, duration: 3200 },
    { eyeX: 0, eyeY: 0, browX: 0, browY: 0, browRot: 0, stemRot: 0, stemX: 0, stemY: 0, bodyRot: 0, bodyX: 0, bodyY: 0, duration: 3000 },
  ];

  const filterId = "day_with_bud_" + Math.random().toString(36).slice(2, 7);

  let svg: SVGSVGElement;
  let bodyGroup: SVGGElement;
  let stemGroup: SVGGElement;
  let eyesGroup: SVGGElement;
  let leftEye: SVGPathElement;
  let rightEye: SVGPathElement;
  let leftBrow: SVGGElement;
  let bookGroup: SVGGElement;
  let pageA: SVGPathElement;
  let pageB: SVGPathElement;
  let pageC: SVGPathElement;
  let laptopGroup: SVGGElement;
  let screenGlow: SVGRectElement;
  let cupGroup: SVGGElement;
  let saucerEllipse: SVGEllipseElement;
  let deskLine: SVGPathElement;
  let steamPath1: SVGPathElement;
  let steamPath2: SVGPathElement;
  let zzzGroup: SVGGElement;

  onMount(() => {
    // ---- continuous body state (never resets between moments) ----
    let eyeX = 0, eyeY = 0;
    let stemX = 0, stemY = 0, stemRotate = 0;
    let browX = 0, browY = 0, browRotate = 0;
    let bodyX = 0, bodyY = 0, bodyRotate = 0;

    let targetEyeX = 0, targetEyeY = 0;
    let targetStemRotate = 0, targetStemX = 0, targetStemY = 0;
    let targetBrowRotate = 0, targetBrowX = 0, targetBrowY = 0;
    let targetBodyRotate = 0, targetBodyX = 0, targetBodyY = 0;

    let cupX = 258, cupY = 240, cupRot = 0;
    let targetCupX = 258, targetCupY = 240, targetCupRot = 0;

    // Prop morph weights (1 = present). Lerped every frame => seamless morphs.
    // The mug only exists from the coffee moment through reading; it slides
    // in when coffee starts and is cleared away before the nap.
    let bookW = 0, laptopW = 0, cupW = 0, zW = 0, glowCur = 0.3;
    let bookBounceY = 0, bookBounceVel = 0;

    let pointerTargetEyeX = 0, pointerTargetEyeY = 0;
    let pointerTargetStemX = 0, pointerTargetStemY = 0, pointerTargetStemRotate = 0;
    let pointerTargetBrowX = 0, pointerTargetBrowY = 0, pointerTargetBrowRotate = 0;
    let pointerTargetBodyX = 0, pointerTargetBodyY = 0, pointerTargetBodyRotate = 0;

    let lastPointerMoveTime = 0;
    let isPointerNear = false;
    let pointerCuriosityWeight = 0;

    // Reading engine (living rhythm: variable lines, re-reads, pauses, skims)
    let lineDur = [1150, 1300, 1450];
    let pageDur = lineDur[0] + lineDur[1] + lineDur[2];
    let regressionsLeft = 1;
    let skimPage = false;
    let flipThreshold = pageDur;
    let pauseAfter = -1;
    let pauseLen = 0;
    let pauseDone = true;
    let pauseUntil = 0;
    let prevLineIdx = 0;
    let accumulatedReadingTime = 0;
    let isFlipping = false;
    let flipDirection: "next" | "prev" = "next";
    let flipStartTime = 0;
    let flipDur = 650; // ms, re-rolled every turn

    function newPage() {
      lineDur = [
        1050 + Math.random() * 350,
        1200 + Math.random() * 400,
        1300 + Math.random() * 450,
      ];
      pageDur = lineDur[0] + lineDur[1] + lineDur[2];
      regressionsLeft = 1;
      skimPage = Math.random() < 0.1;
      flipThreshold = skimPage ? lineDur[0] + 350 : pageDur;
      if (!skimPage && Math.random() < 0.14) {
        pauseAfter = lineDur[0] + lineDur[1];
        pauseLen = 650 + Math.random() * 500;
        pauseDone = false;
      } else {
        pauseAfter = -1;
        pauseDone = true;
      }
      pauseUntil = 0;
      prevLineIdx = 0;
      accumulatedReadingTime = 0;
    }

    function lineIndexFor(t: number): number {
      if (t < lineDur[0]) return 0;
      if (t < lineDur[0] + lineDur[1]) return 1;
      return 2;
    }

    function lineLocalTime(t: number, idx: number): number {
      const start = idx === 0 ? 0 : idx === 1 ? lineDur[0] : lineDur[0] + lineDur[1];
      return Math.min(1, Math.max(0, (t - start) / lineDur[idx]));
    }

    // Page-trading trio: the left stroke morphs into the flying page while the
    // right stroke slides down into the blue base and a spare slides up out of
    // it on the left. No opacity fades anywhere — white-on-white camouflage
    // merges pages into the mass, so every transition is pure translation.
    let flipFromT = 0;
    let currentLift = 0;
    let elLeft: SVGPathElement | null = pageA;
    let elRight: SVGPathElement | null = pageB;
    let elSpare: SVGPathElement | null = pageC;

    function sstep(a: number, b: number, x: number): number {
      const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
      return t * t * (3 - 2 * t);
    }

    function paintRest() {
      if (elLeft) {
        elLeft.style.display = "block";
        elLeft.removeAttribute("transform");
        elLeft.setAttribute("d", pageStrokeD(0, 0));
      }
      if (elRight) {
        elRight.style.display = "block";
        elRight.removeAttribute("transform");
        elRight.setAttribute("d", pageStrokeD(1, 1));
      }
      if (elSpare) {
        elSpare.style.display = "none";
        elSpare.setAttribute("transform", "translate(0 12)");
        elSpare.setAttribute("d", pageStrokeD(0, 0));
      }
    }

    function startFlipTakeoff() {
      // The flyer peels off the rest stack; pin it above the other strokes
      flipFromT = currentLift;
      currentLift = 0;
      if (bookGroup && elLeft) bookGroup.appendChild(elLeft);
    }

    newPage();

    // Typing engine
    const burstDuration = 1150;
    let accumulatedWorkTime = 0;
    let lastBurstIdx = 0;

    // Drinking ritual
    const aromaCycleDuration = 4600;
    let drinkStartTime = performance.now();

    // Idle drift
    let idleIdx = 3;
    let nextIdleSwitch = performance.now() + 2400;

    // Sleeping
    let sleepBreathTime = 0;

    // Phase-enter detection (resets moment-local clocks without any remount)
    let lastActivity: Activity | null = null;

    // Saccades
    let saccadeX = 0, saccadeY = 0;
    let targetSaccadeX = 0, targetSaccadeY = 0;
    let nextSaccadeTime = performance.now() + 300;

    // Blink engine (shared across the whole day)
    let blinkScale = 1;
    let isBlinking = false;
    let blinkStartTime = 0;
    let blinkDuration = 150;
    let isDoubleBlinking = false;
    let doubleBlinkStage = 0;
    let nextBlinkTime = performance.now() + 4000;

    let lastFrameTime = performance.now();
    let frame = 0;

    function triggerBlink(forceDouble = false) {
      if (isBlinking) return;
      isBlinking = true;
      blinkStartTime = performance.now();
      blinkDuration = 150;
      isDoubleBlinking = forceDouble || Math.random() < 0.1;
      doubleBlinkStage = 0;
    }

    function handlePointerMove(event: PointerEvent) {
      if (!interactive || !svg) return;
      lastPointerMoveTime = performance.now();

      const rect = svg.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const dx = event.clientX - centerX;
      const dy = event.clientY - centerY;
      const dist = Math.hypot(dx, dy);
      if (dist < 1) return;

      if (dist < 130) {
        isPointerNear = true;
        const factor = Math.min(dist / 130, 1);
        const ease = Math.sin((factor * Math.PI) / 2);
        const nx = (dx / dist) * ease;
        const ny = (dy / dist) * ease;

        pointerTargetEyeX = nx * 14.0;
        pointerTargetEyeY = ny * 9.5;
        pointerTargetBodyX = nx * 2.8;
        pointerTargetBodyY = ny * 1.8;
        pointerTargetBodyRotate = nx * 2.8;
        pointerTargetStemRotate = nx * 3.8;
        pointerTargetStemX = nx * 2.2;
        pointerTargetStemY = ny * 3.2;
        pointerTargetBrowX = nx * 6.0;
        pointerTargetBrowY = ny * 5.0;
        pointerTargetBrowRotate = nx * 3.0 - ny * 2.0;
      } else {
        isPointerNear = false;
      }
    }

    function handlePointerLeave() {
      isPointerNear = false;
    }

    function handlePointerEnter() {
      lastPointerMoveTime = performance.now();
    }

    function animate(now: number) {
      const dt = Math.min(64, Math.max(1, now - lastFrameTime));
      lastFrameTime = now;

      const phase = PHASES[index];
      const activity = phase.activity;
      const effectiveSpeed = clampSpeed(speed) * phase.speedFactor;

      // Moment entry: reset local clocks, keep everything else flowing
      if (activity !== lastActivity) {
        lastActivity = activity;
        drinkStartTime = now;
        newPage();
        accumulatedWorkTime = 0;
        isFlipping = false;
        currentLift = 0;
        triggerBlink(true);
      }
      if (pendingBlink) {
        pendingBlink = false;
        triggerBlink(true);
      }

      // Page strokes rest whenever no turn is running.
      // (Nested in the book group, so they inherit its reading morph.)
      if (!isFlipping) {
        paintRest();
      }

      // ---------- per-moment face/prop targets ----------
      let glowTarget = 0.22;

      if (activity === "idle") {
        if (now >= nextIdleSwitch) {
          let n: number;
          do {
            n = Math.floor(Math.random() * IDLE_POSES.length);
          } while (n === idleIdx);
          idleIdx = n;
          nextIdleSwitch = now + IDLE_POSES[idleIdx].duration / Math.max(0.4, effectiveSpeed);
        }
        const pose = IDLE_POSES[idleIdx];
        targetEyeX = pose.eyeX; targetEyeY = pose.eyeY;
        targetBrowX = pose.browX; targetBrowY = pose.browY; targetBrowRotate = pose.browRot;
        targetStemRotate = pose.stemRot; targetStemX = pose.stemX; targetStemY = pose.stemY;
        targetBodyRotate = pose.bodyRot; targetBodyX = pose.bodyX; targetBodyY = pose.bodyY;
        targetCupX = 258; targetCupY = 240; targetCupRot = 0;
        glowTarget = 0.18;
        if (zzzGroup) zzzGroup.style.display = "none";
      } else if (activity === "reading") {
        if (!isFlipping) {
          const inPause = !pauseDone && pauseUntil > 0 && now < pauseUntil;
          if (!inPause) {
            accumulatedReadingTime += dt * effectiveSpeed;
          }

          // Thoughtful pause: freeze on the words, brow lifts
          if (!pauseDone && pauseAfter > 0 && pauseUntil === 0 && accumulatedReadingTime >= pauseAfter) {
            pauseUntil = now + pauseLen;
            pauseDone = true;
            triggerBlink();
          }

          if (accumulatedReadingTime >= flipThreshold) {
            startFlipTakeoff();
            isFlipping = true;
            flipDirection = "next";
            flipStartTime = now;
            flipDur = skimPage ? 400 : 560 + Math.random() * 180;
          }

          // Regression: jump back mid-thought to re-read (once per page max)
          let lineIdx = lineIndexFor(Math.min(accumulatedReadingTime, pageDur - 1));
          if (lineIdx > prevLineIdx) {
            if (regressionsLeft > 0 && lineIdx <= 2 && !skimPage && Math.random() < 0.18) {
              accumulatedReadingTime = Math.max(0, accumulatedReadingTime - lineDur[lineIdx - 1] * 0.55);
              regressionsLeft--;
              lineIdx = lineIndexFor(Math.min(accumulatedReadingTime, pageDur - 1));
              triggerBlink();
            }
          }
          prevLineIdx = lineIdx;

          if (inPause) {
            targetBrowY = 1.6;
            targetBrowRotate = 2.4;
          } else {
            const lineTime = lineLocalTime(accumulatedReadingTime, lineIdx);
            const numWords = 4;
            const wordStep = Math.floor(lineTime * numWords);
            const wordSub = (lineTime * numWords) % 1;
            const snap = Math.min(1.0, Math.pow(wordSub / 0.25, 2));
            const smoothProgress = (wordStep + snap) / numWords;

            targetEyeX = -8.0 + 16.0 * smoothProgress;
            targetEyeY = 6.4 + lineIdx * 1.8;
            targetBodyRotate = (smoothProgress - 0.5) * 2.2;
            targetStemRotate = (smoothProgress - 0.5) * 1.8;
            targetBrowRotate = Math.sin(smoothProgress * Math.PI) * 0.8;
            targetStemX = targetEyeX * 0.12;
            targetStemY = 2.0 + lineIdx * 0.3;
            targetBrowX = targetEyeX * 0.15;
            targetBrowY = 3.5 + lineIdx * 0.25;
          }
          targetBodyX = 0; targetBodyY = 1.8;
          targetCupX = 258; targetCupY = 240; targetCupRot = 0;

          // Corner-lift anticipation: the left page stroke itself starts bending.
          // Same element, same paint — the yellow converts, nothing swaps in.
          const timeLeft = flipThreshold - accumulatedReadingTime;
          if (!inPause && timeLeft > 0 && timeLeft < 500) {
            const lift = 0.05 + 0.12 * (1 - timeLeft / 500);
            currentLift = lift;
            if (elLeft) {
              elLeft.style.display = "block";
              elLeft.removeAttribute("transform");
              elLeft.setAttribute("d", pageStrokeD(lift, lift));
            }
          } else {
            currentLift = 0;
          }
        } else {
          // The left stroke bends through the arc and lands as the new right
          // page. One continuous bend, no swaps.
          const elapsed = now - flipStartTime;
          const fp = Math.min(1.12, elapsed / flipDur);
          const clamped = Math.min(fp, 1);
          const e = flipFromT + (1 - flipFromT) * clamped;
          if (elLeft) {
            elLeft.style.display = "block";
            elLeft.removeAttribute("transform");
            elLeft.setAttribute("d", pageStrokeD(e, clamped));
          }
          // Right yellow slides down-left and merges into the blue, done early
          // while a fresh page slides up-right out of the blue on the left, late
          if (elRight) {
            const sk = sstep(0.35, 0.7, fp);
            elRight.style.display = "block";
            elRight.setAttribute("transform", `translate(${(-6 * sk).toFixed(1)} ${(12 * sk).toFixed(1)})`);
            elRight.setAttribute("d", pageStrokeD(1, 1));
          }
          if (elSpare) {
            const rr = sstep(0.5, 0.85, fp);
            elSpare.style.display = fp < 0.5 ? "none" : "block";
            elSpare.setAttribute("transform", `translate(${(6 * (1 - rr)).toFixed(1)} ${(12 * (1 - rr)).toFixed(1)})`);
            elSpare.setAttribute("d", pageStrokeD(0, 0));
          }
          const sweep = clamped;
          targetEyeX = -8.5 + sweep * 17.0;
          targetEyeY = 7.5 - Math.sin(clamped * Math.PI) * 5.0;
          targetStemRotate = (sweep - 0.5) * 3.4;
          targetBodyRotate = (sweep - 0.5) * 2.8;
          targetBrowRotate = Math.sin(clamped * Math.PI) * 2.2;
          if (fp >= 1.1) {
            isFlipping = false;
            currentLift = 0;
            // Roles rotate: risen → left, flown → right, sunk → spare inside
            // the blue. The loop continues.
            const flown = elLeft, sunk = elRight, risen = elSpare;
            elLeft = risen;
            elRight = flown;
            elSpare = sunk;
            paintRest();
            newPage();
            bookBounceVel = -0.07;
            triggerBlink();
          }
        }
        glowTarget = 0.18;
        if (zzzGroup) zzzGroup.style.display = "none";
      } else if (activity === "working") {
        accumulatedWorkTime += dt * effectiveSpeed;
        const burstTime = (accumulatedWorkTime % burstDuration) / burstDuration;
        const burstIdx = Math.floor(accumulatedWorkTime / burstDuration);
        if (burstIdx !== lastBurstIdx) {
          lastBurstIdx = burstIdx;
          if (Math.random() < 0.3) triggerBlink();
        }
        const numKeys = 5;
        const keyStep = Math.floor(burstTime * numKeys);
        const keySub = (burstTime * numKeys) % 1;
        const snap = Math.min(1.0, Math.pow(keySub / 0.3, 2));
        const smoothProgress = (keyStep + snap) / numKeys;

        targetEyeX = -4.0 + smoothProgress * 8.0;
        targetEyeY = 8.2 + Math.sin(burstIdx * 1.7) * 0.9;

        const typingBob = Math.sin(now * 0.022 * effectiveSpeed) * 0.9;
        const keyMash = Math.sin(now * 0.045 * effectiveSpeed) * 0.35;
        targetBodyX = 0;
        targetBodyY = 2.6 + typingBob * 0.6;
        targetBodyRotate = 1.2 + (smoothProgress - 0.5) * 1.0;
        targetStemX = targetEyeX * 0.1;
        targetStemY = 2.8 + keyMash * 0.4;
        targetStemRotate = (smoothProgress - 0.5) * 1.0;
        targetBrowX = targetEyeX * 0.12;
        targetBrowY = 4.1;
        targetBrowRotate = -0.6 + Math.sin(smoothProgress * Math.PI) * 0.4;
        targetCupX = 258; targetCupY = 240; targetCupRot = 0;

        glowTarget = 0.35 + 0.3 * Math.sin(now * 0.02 * effectiveSpeed) + 0.25 * burstTime;
        glowTarget = Math.min(0.85, Math.max(0.2, glowTarget));
        if (zzzGroup) zzzGroup.style.display = "none";
      } else if (activity === "drinking") {
        if (zzzGroup) zzzGroup.style.display = "none";
        const cycleDuration = aromaCycleDuration / effectiveSpeed;
        const progress = Math.min(1.0, Math.max(0, (now - drinkStartTime) / cycleDuration));

        if (progress < 0.15) {
          const p = progress / 0.15;
          const ease = 0.5 - 0.5 * Math.cos(p * Math.PI);
          targetEyeX = 12.0 * ease; targetEyeY = 7.5 * ease;
          targetBodyRotate = 1.5 * ease; targetStemRotate = 2.0 * ease;
          targetBrowRotate = -1.0 * ease;
          targetCupX = 258; targetCupY = 240 + Math.sin(p * Math.PI * 2) * 0.5; targetCupRot = 0;
          blinkScale = 1.0;
        } else if (progress < 0.38) {
          const p = (progress - 0.15) / 0.23;
          const ease = 0.5 - 0.5 * Math.cos(p * Math.PI);
          targetCupX = 258 + (196 - 258) * ease;
          targetCupY = 240 + (136 - 240) * ease;
          targetCupRot = -22.0 * ease;
          targetEyeX = 12.0 - p * 4.0; targetEyeY = 6.0;
          targetBodyX = 2.5 * ease; targetBodyRotate = 2.0 * ease;
          targetStemRotate = 2.4 * ease; targetBrowRotate = 1.2 * ease;
          blinkScale = 1.0;
        } else if (progress < 0.72) {
          const p = (progress - 0.38) / 0.34;
          const drinkTilt = Math.sin(p * Math.PI);
          const sipBob = Math.sin(p * Math.PI * 4);
          targetCupX = 196 - drinkTilt * 4.0;
          targetCupY = 136 + sipBob * 1.8;
          targetCupRot = -22.0 - drinkTilt * 12.0;
          targetEyeX = 8.0; targetEyeY = 4.0;
          targetBodyX = 2.5 * (1 - drinkTilt * 0.5);
          targetBodyY = -2.2 * drinkTilt;
          targetBodyRotate = -1.8 * drinkTilt;
          targetStemRotate = -1.5 * drinkTilt;
          targetStemY = 2.0 + sipBob * 0.8;
          targetBrowRotate = 1.5 * drinkTilt;
          blinkScale = Math.max(0.06, 1.0 - drinkTilt * 0.94);
        } else if (progress < 0.92) {
          const p = (progress - 0.72) / 0.2;
          const ease = 0.5 - 0.5 * Math.cos(p * Math.PI);
          targetCupX = 196 + (258 - 196) * ease;
          targetCupY = 136 + (240 - 136) * ease;
          targetCupRot = -22.0 * (1 - ease);
          targetEyeX = 8.0 * (1 - p); targetEyeY = 6.4;
          targetBodyX = 0; targetBodyY = 0; targetBodyRotate = 0;
          targetStemRotate = 0; targetBrowRotate = 0;
          blinkScale = 1.0;
        } else {
          const p = (progress - 0.92) / 0.08;
          targetCupX = 258; targetCupY = 240 + Math.sin(p * Math.PI) * 1.2; targetCupRot = 0;
          blinkScale = 1.0;
        }
        //sip again while the moment lasts
        if (progress >= 1.0) drinkStartTime = now - 900 / Math.max(0.3, effectiveSpeed);
        glowTarget = 0.25;
      } else {
        // sleeping — head droops onto the desk
        targetCupX = 258; targetCupY = 240; targetCupRot = 0;
        sleepBreathTime += dt * 0.001;
        const nod = Math.sin(sleepBreathTime * 1.5) * 1.8;
        targetEyeX = 0; targetEyeY = 9.0;
        targetBodyX = 0; targetBodyY = 5.2 + nod;
        targetBodyRotate = 1.8 + nod * 0.4;
        targetStemY = 4.0; targetStemRotate = 0.8;
        targetBrowY = 4.8; targetBrowRotate = -0.5;
        blinkScale = 0.05;
        glowTarget = 0.12;
        if (zzzGroup) {
          zzzGroup.style.display = "block";
          const zCycle = (now * 0.0011) % 3.0;
          zzzGroup.setAttribute(
            "transform",
            `translate(${142 + Math.sin(zCycle * 2.2) * 3} ${68 + zCycle * -15.0})`,
          );
        }
      }

      // ---------- prop morph weights (the seamless part) ----------
      const morphRate = Math.min(1, dt / 300);
      bookW += ((activity === "reading" ? 1 : 0) - bookW) * morphRate;
      laptopW += ((activity === "working" ? 1 : 0) - laptopW) * morphRate;
      cupW += ((activity === "drinking" || activity === "working" || activity === "reading" ? 1 : 0) - cupW) * morphRate;
      zW += ((activity === "sleeping" ? 1 : 0) - zW) * morphRate;
      glowCur += (glowTarget - glowCur) * Math.min(1, dt / 200);
      if (Math.abs(bookW) < 0.01) bookW = activity === "reading" ? 0.01 : 0;
      if (Math.abs(laptopW) < 0.01) laptopW = activity === "working" ? 0.01 : 0;
      if (Math.abs(cupW) < 0.01) cupW = activity === "drinking" || activity === "working" || activity === "reading" ? 0.01 : 0;

      if (bookGroup) {
        bookGroup.setAttribute("opacity", bookW.toFixed(3));
        bookGroup.setAttribute("transform", `translate(0 ${(18 * (1 - bookW)).toFixed(2)})`);
        bookGroup.style.display = bookW <= 0.01 ? "none" : "block";
      }
      if (laptopGroup) {
        laptopGroup.setAttribute("opacity", laptopW.toFixed(3));
        laptopGroup.setAttribute("transform", `translate(0 ${(18 * (1 - laptopW)).toFixed(2)})`);
        laptopGroup.style.display = laptopW <= 0.01 ? "none" : "block";
      }
      if (screenGlow) screenGlow.setAttribute("opacity", glowCur.toFixed(2));
      if (zzzGroup && activity === "sleeping") {
        const zCycle = (now * 0.0011) % 3.0;
        zzzGroup.setAttribute("opacity", (Math.max(0, Math.sin((zCycle / 3.0) * Math.PI)) * Math.min(1, zW * 1.5)).toFixed(2));
      } else if (zzzGroup) {
        zzzGroup.style.display = "none";
      }

      // Book landing bounce
      bookBounceY += bookBounceVel;
      bookBounceVel += (0 - bookBounceY) * 0.3;
      bookBounceVel *= 0.72;
      if (bookGroup && bookW > 0.01) {
        const sY = 1 + bookBounceY;
        bookGroup.setAttribute(
          "transform",
          `translate(0 ${(18 * (1 - bookW)).toFixed(2)}) translate(127 230) scale(1 ${sY.toFixed(3)}) translate(-127 -230)`,
        );
      }

      // ---------- shared life: curiosity, saccades, breath ----------
      const idleTime = now - lastPointerMoveTime;
      const shouldLookAtPointer = isPointerNear && idleTime < 1200 && activity !== "sleeping";
      if (shouldLookAtPointer) pointerCuriosityWeight = Math.min(0.65, pointerCuriosityWeight + 0.08);
      else pointerCuriosityWeight = Math.max(0, pointerCuriosityWeight - 0.05);

      if (now >= nextSaccadeTime) {
        targetSaccadeX = (Math.random() - 0.5) * 1.2;
        targetSaccadeY = (Math.random() - 0.5) * 0.8;
        nextSaccadeTime = now + 200 + Math.random() * 250;
      }
      saccadeX += (targetSaccadeX - saccadeX) * 0.28;
      saccadeY += (targetSaccadeY - saccadeY) * 0.28;

      const breathFreq = activity === "sleeping" ? 0.0011 : activity === "idle" ? 0.0017 : 0.0017;
      const breathTime = now * breathFreq;
      const breathRaw = Math.sin(breathTime) + 0.24 * Math.sin(breathTime * 2.0 - 0.5);
      const breathY = breathRaw * (activity === "sleeping" ? -1.6 : -0.9);
      const breathStemY = breathRaw * -0.5;
      const breathBrowY = breathRaw * -0.4;
      const swayRot = Math.cos(breathTime * 0.5) * 0.4;

      const w = pointerCuriosityWeight;
      const iw = 1 - w;
      const effEyeX = pointerTargetEyeX * w + targetEyeX * iw;
      const effEyeY = pointerTargetEyeY * w + targetEyeY * iw;
      const effBodyX = pointerTargetBodyX * w + targetBodyX * iw;
      const effBodyY = pointerTargetBodyY * w + targetBodyY * iw;
      const effBodyRot = pointerTargetBodyRotate * w + targetBodyRotate * iw;
      const effStemX = pointerTargetStemX * w + targetStemX * iw;
      const effStemY = pointerTargetStemY * w + targetStemY * iw;
      const effStemRot = pointerTargetStemRotate * w + targetStemRotate * iw;
      const effBrowX = pointerTargetBrowX * w + targetBrowX * iw;
      const effBrowY = pointerTargetBrowY * w + targetBrowY * iw;
      const effBrowRot = pointerTargetBrowRotate * w + targetBrowRotate * iw;

      // Heavily damped => moment changes read as attention shifts, not cuts
      eyeX += (effEyeX + saccadeX - eyeX) * 0.16;
      eyeY += (effEyeY + saccadeY - eyeY) * 0.16;
      bodyX += (effBodyX - bodyX) * 0.06;
      bodyY += (effBodyY + breathY - bodyY) * 0.06;
      bodyRotate += (effBodyRot + swayRot - bodyRotate) * 0.06;
      stemX += (effStemX - stemX) * 0.1;
      stemY += (effStemY + breathStemY - stemY) * 0.1;
      stemRotate += (effStemRot + swayRot * 0.6 - stemRotate) * 0.09;
      browX += (effBrowX - browX) * 0.12;
      browY += (effBrowY + breathBrowY - browY) * 0.12;
      browRotate += (effBrowRot - browRotate) * 0.1;

      if (bodyGroup) bodyGroup.setAttribute("transform", `translate(${bodyX.toFixed(2)} ${bodyY.toFixed(2)}) rotate(${bodyRotate.toFixed(2)} 127 110)`);
      if (stemGroup) stemGroup.setAttribute("transform", `translate(${stemX.toFixed(2)} ${stemY.toFixed(2)}) rotate(${stemRotate.toFixed(2)} 122 175)`);
      if (eyesGroup) eyesGroup.setAttribute("transform", `translate(${eyeX.toFixed(2)} ${eyeY.toFixed(2)})`);
      if (leftBrow) leftBrow.setAttribute("transform", `translate(${browX.toFixed(2)} ${browY.toFixed(2)}) rotate(${browRotate.toFixed(2)} 86 45)`);

      // Cup glides (never snaps); slides in from off-desk with its morph weight
      cupX += (targetCupX - cupX) * 0.14;
      cupY += (targetCupY - cupY) * 0.14;
      cupRot += (targetCupRot - cupRot) * 0.14;
      if (cupGroup) {
        const slideIn = (1 - cupW) * 46;
        cupGroup.setAttribute(
          "transform",
          `translate(${(cupX + slideIn).toFixed(2)} ${cupY.toFixed(2)}) rotate(${cupRot.toFixed(2)} 14 12)`,
        );
        cupGroup.setAttribute("opacity", cupW.toFixed(3));
        cupGroup.style.display = cupW <= 0.01 ? "none" : "block";
      }
      if (saucerEllipse) saucerEllipse.setAttribute("opacity", (0.45 * cupW).toFixed(3));
      if (deskLine) {
        deskLine.setAttribute("opacity", (0.32 * cupW).toFixed(3));
        deskLine.setAttribute("stroke-dashoffset", (307 * (1 - cupW)).toFixed(1));
      }

      // Steam always breathes; leans toward Bud while sipping
      if (steamPath1 && steamPath2) {
        const sTime = now * 0.0025;
        const lean = activity === "drinking" ? -6.0 : 0;
        const w1 = Math.sin(sTime) * 3 + lean;
        const w2 = Math.cos(sTime * 1.2) * 2.5 + lean;
        steamPath1.setAttribute("d", `M 8 -4 C ${5 + w1} -12 ${12 + w1} -20 ${8 + w1} -28 C ${4 + w1} -36 ${11 + w1} -44 7 -50`);
        steamPath2.setAttribute("d", `M 17 -6 C ${21 + w2} -14 ${14 + w2} -22 ${18 + w2} -30 C ${22 + w2} -38 ${15 + w2} -45 19 -52`);
      }

      // Shared blink engine (closed soft eyes while sleeping / sipping)
      if (activity !== "sleeping" && activity !== "drinking") {
        if (!isBlinking && now >= nextBlinkTime) triggerBlink();
        if (isBlinking && leftEye && rightEye) {
          const elapsed = now - blinkStartTime;
          if (elapsed >= blinkDuration) {
            if (isDoubleBlinking && doubleBlinkStage === 0) {
              doubleBlinkStage = 1; blinkStartTime = now; blinkDuration = 55; blinkScale = 0.85;
            } else if (isDoubleBlinking && doubleBlinkStage === 1) {
              doubleBlinkStage = 2; blinkStartTime = now; blinkDuration = 120;
            } else {
              isBlinking = false; isDoubleBlinking = false; doubleBlinkStage = 0;
              blinkScale = 1;
              nextBlinkTime = now + 4500 + Math.random() * 4500;
              leftEye.removeAttribute("transform");
              rightEye.removeAttribute("transform");
            }
          } else {
            const closeAmount = Math.sin((elapsed / blinkDuration) * Math.PI);
            blinkScale = Math.max(0.08, 1 - closeAmount * 0.92);
            leftEye.setAttribute("transform", `translate(91 98) scale(1 ${blinkScale.toFixed(3)}) translate(-91 -98)`);
            rightEye.setAttribute("transform", `translate(161 76) scale(1 ${blinkScale.toFixed(3)}) translate(-161 -76)`);
          }
        }
      } else if (leftEye && rightEye) {
        leftEye.setAttribute("transform", `translate(91 98) scale(1 ${blinkScale.toFixed(3)}) translate(-91 -98)`);
        rightEye.setAttribute("transform", `translate(161 76) scale(1 ${blinkScale.toFixed(3)}) translate(-161 -76)`);
      }

      frame = requestAnimationFrame(animate);
    }

    window.addEventListener("pointermove", handlePointerMove, { passive: true });
    document.addEventListener("mouseleave", handlePointerLeave);
    document.addEventListener("mouseenter", handlePointerEnter);

    frame = requestAnimationFrame(animate);
    schedule();

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("mouseleave", handlePointerLeave);
      document.removeEventListener("mouseenter", handlePointerEnter);
      cancelAnimationFrame(frame);
      clearTimer();
    };
  });

  $effect(() => {
    void playing;
    void phaseDuration;
    void speed;
    schedule();
    return () => clearTimer();
  });
</script>

<div class="flex flex-col items-center gap-3 {className}">
  <!-- One continuous stage: fixed footprint, single Bud, morphing props -->
  <div class="relative w-full max-w-[340px] min-h-[300px] flex items-center justify-center overflow-visible">
    <svg
      bind:this={svg}
      class="w-64 h-64 text-white select-none overflow-visible"
      viewBox="-30 -16 335 320"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      overflow="visible"
      style="overflow: visible;"
      role="img"
      aria-label="A day in the life of Bud: waking, coffee, work, reading, nap"
    >
      <defs>
        <filter id={filterId} x="-30%" y="-30%" width="160%" height="160%" color-interpolation-filters="sRGB">
          <feFlood flood-opacity="0" result="BackgroundImageFix" />
          <feBlend mode="normal" in="SourceGraphic" in2="BackgroundImageFix" result="shape" />
          <feTurbulence type="fractalNoise" baseFrequency="0.2 0.2" numOctaves="3" seed="5016" />
          <feDisplacementMap in="shape" scale="4" xChannelSelector="R" yChannelSelector="G" result="displacedImage" />
          <feMerge>
            <feMergeNode in="displacedImage" />
          </feMerge>
        </filter>
      </defs>

      <g filter={`url(#${filterId})`}>
        <!-- Shared desk: draws itself in with the coffee setup, clears for the nap -->
        <path bind:this={deskLine} d="M -15 265 L 292 265" stroke="currentColor" stroke-width="2" stroke-linecap="round" opacity="0" stroke-dasharray="307" stroke-dashoffset="307" />
        <ellipse bind:this={saucerEllipse} cx="272" cy="264" rx="15" ry="3" fill="none" stroke="currentColor" stroke-width="1.8" opacity="0" />

        <!-- The one and only Bud face -->
        <g bind:this={bodyGroup}>
          <g bind:this={stemGroup}>
            <path d={NOSE_STEM_PATH} fill="currentColor" />
          </g>
          <g bind:this={eyesGroup}>
            <path bind:this={leftEye} d={LEFT_EYE_PATH} fill="currentColor" />
            <path bind:this={rightEye} d={RIGHT_EYE_PATH} fill="currentColor" />
          </g>
          <g bind:this={leftBrow}>
            <path d={LEFT_BROW_PATH} fill="currentColor" />
          </g>
        </g>

        <!-- Book (morphs in for reading) -->
        <g bind:this={bookGroup} opacity="0" style="display: none;">
          <path d={FULL_BOOK_PATH} fill="currentColor" />
          <!-- Two page strokes over the blue mass. They trade roles every turn:
               the left stroke morphs into the flying page, the other sinks into
               the base and rises back on its new side. Strokes cross like lines,
               never stacking into thick slabs. -->
          <path bind:this={pageA} d={pageStrokeD(0, 0)} fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round" />
          <path bind:this={pageB} d={pageStrokeD(1, 1)} fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round" />
          <path bind:this={pageC} d={pageStrokeD(0, 0)} fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round" transform="translate(0 12)" />
        </g>

        <!-- Laptop, lid back to viewer (morphs in for work) -->
        <g bind:this={laptopGroup} opacity="0" style="display: none;">
          <rect x="48" y="144" width="172" height="104" rx="10" fill="currentColor" />
          <circle cx="134" cy="196" r="9" fill="none" stroke="black" stroke-width="1.6" opacity="0.35" />
          <rect bind:this={screenGlow} x="58" y="139" width="152" height="5" rx="2.5" fill="currentColor" opacity="0.3" />
          <rect x="46" y="250" width="176" height="11" rx="3" fill="currentColor" />
        </g>

        <!-- Mug: slides in for coffee, parked through reading, cleared for the nap -->
        <g bind:this={cupGroup} transform="translate(258, 240)" opacity="0" style="display: none;">
          <path d="M 2 2 C 2 -1 24 -1 24 2 L 21 22 C 20 25 5 25 4 22 Z" fill="currentColor" />
          <path d="M 23 5 C 31 5 32 17 21 19" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" />
          <path bind:this={steamPath1} d="M 8 -4 C 5 -12 12 -20 8 -28 C 4 -36 11 -44 7 -50" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" opacity="0.75" />
          <path bind:this={steamPath2} d="M 17 -6 C 21 -14 14 -22 18 -30 C 22 -38 15 -45 19 -52" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" opacity="0.6" />
        </g>

        <!-- Zzz (morphs in for the nap) -->
        <g bind:this={zzzGroup} style="display: none;">
          <path d="M -5 -10 L 2 -10 L -5 -3 L 2 -3 M 5 -22 L 14 -22 L 5 -13 L 14 -13 M 16 -36 L 27 -36 L 16 -24 L 27 -24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
        </g>
      </g>
    </svg>
  </div>

  {#if showCaption}
    {#key current.id}
      <div class="text-center" in:fade={{ duration: 300, delay: 100 }}>
        <div class="text-xs font-medium text-neutral-200">{current.label}</div>
        <div class="text-[11px] text-neutral-400 mt-0.5">{current.caption}</div>
      </div>
    {/key}
  {/if}

  {#if showTimeline}
    <div class="w-full max-w-[340px] flex flex-col gap-2">
      {#key current.id + String(playing)}
        {#if playing}
          <div class="h-0.5 rounded-full bg-neutral-800 overflow-hidden">
            <div class="h-full bg-neutral-300 day-progress" style="animation-duration: {phaseMs(current)}ms;"></div>
          </div>
        {:else}
          <div class="h-0.5 rounded-full bg-neutral-800"></div>
        {/if}
      {/key}

      {#if showControls}
        <div class="flex items-center justify-between gap-2">
          <button
            onclick={() => prev()}
            class="px-2.5 py-1.5 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-neutral-300 text-[11px] font-medium transition cursor-pointer"
            aria-label="Previous moment"
          >
            ← Prev
          </button>

          <div class="flex items-center gap-1.5">
            {#each PHASES as phase, i}
              <button
                onclick={() => { const delta = (i - index + PHASES.length) % PHASES.length; setPhase(delta); }}
                class="h-1.5 rounded-full transition-all cursor-pointer {i === index ? 'w-5 bg-neutral-200' : 'w-1.5 bg-neutral-700 hover:bg-neutral-500'}"
                aria-label={phase.label}
                title={phase.label}
              ></button>
            {/each}
          </div>

          <div class="flex items-center gap-1.5">
            <button
              onclick={togglePlay}
              class="px-2.5 py-1.5 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-neutral-300 text-[11px] font-medium transition cursor-pointer"
              aria-label={playing ? "Pause day cycle" : "Play day cycle"}
            >
              {playing ? "Pause" : "Play"}
            </button>
            <button
              onclick={() => next()}
              class="px-2.5 py-1.5 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-neutral-300 text-[11px] font-medium transition cursor-pointer"
              aria-label="Next moment"
            >
              Next →
            </button>
          </div>
        </div>

        <div class="flex flex-wrap items-center justify-center gap-1.5">
          {#each PHASES as phase, i}
            <button
              onclick={() => { const delta = (i - index + PHASES.length) % PHASES.length; setPhase(delta); }}
              class="px-2 py-1 rounded-md text-[10px] font-medium border transition cursor-pointer {i === index ? 'bg-neutral-800 border-neutral-600 text-white' : 'bg-neutral-900/60 border-neutral-800 text-neutral-400 hover:text-neutral-200'}"
            >
              {phase.label}
            </button>
          {/each}
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .day-progress {
    width: 0%;
    animation-name: day-fill;
    animation-timing-function: linear;
    animation-fill-mode: forwards;
  }

  @keyframes day-fill {
    from { width: 0%; }
    to { width: 100%; }
  }
</style>
