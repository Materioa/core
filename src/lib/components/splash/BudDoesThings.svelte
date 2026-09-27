<script lang="ts">
  import { onMount } from "svelte";

  let {
    class: className = "w-24 h-24 text-foreground",
    activity = "auto",
    speed = 1.0,
    interactive = true,
    autoCycle = true,
    showDesk = true,
    onactivitychange,
    onflip,
  }: {
    class?: string;
    activity?: "auto" | "reading" | "drinking" | "sleeping";
    speed?: number;
    interactive?: boolean;
    autoCycle?: boolean;
    showDesk?: boolean;
    onactivitychange?: (activity: "reading" | "drinking" | "sleeping") => void;
    onflip?: (direction: "next" | "prev") => void;
  } = $props();

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
  let cupGroup: SVGGElement;
  let steamPath1: SVGPathElement;
  let steamPath2: SVGPathElement;
  let zzzGroup: SVGGElement;

  const filterId = "bud_does_things_" + Math.random().toString(36).slice(2, 7);

  // Pristine vector paths from bud.svg
  const NOSE_STEM_PATH =
    "M154.573 2C164.716 2.25175 172.946 6.6995 180.92 12.6555C183.102 14.2855 187.969 17.3385 188.265 20.299C188.334 20.997 188.148 21.637 187.692 22.1718C186.988 22.998 185.702 23.6418 184.612 23.2675C182.526 22.5518 180.597 20.491 178.829 19.198C172.375 14.4765 163.201 9.05075 154.954 9.686C150.546 10.0253 146.913 12.315 144.119 15.6573C126.677 36.5213 131.45 117.61 133.793 145.205L144.224 132.903C149.182 127.081 154.285 118.568 162.481 125.283C164.572 127.681 166.273 132.245 163.994 135.02C151.005 150.837 134.867 164.928 122.331 181.092C122.117 175.096 121.105 169.08 120.705 163.084C118.538 130.612 115.602 35.1083 137.279 10.6485C141.896 5.43851 147.62 2.38075 154.573 2Z";

  const LEFT_EYE_PATH =
    "M95.5129 66.4331C104.451 65.8273 106.496 69.4208 111.284 76.2528C116.699 82.5063 111.621 90.5116 107.237 81.2706C97.5494 60.8471 84.8746 84.5083 81.9534 95.8526C85.6414 90.8178 91.3236 85.9086 97.5069 91.2546C101.064 94.3301 101.307 99.8333 101.468 104.253C101.247 109.301 100.699 113.337 98.3891 118.038C96.3839 122.119 91.7436 126.619 87.3751 127.984C84.0891 129.016 80.5266 128.688 77.4841 127.074C63.6401 119.611 70.8529 94.6858 77.3034 84.2106C82.0294 76.5358 86.1959 69.0726 95.5129 66.4331Z";

  const RIGHT_EYE_PATH =
    "M167.025 44.4704C172.355 44.1429 175.969 46.6149 179.161 50.6439C181.069 53.0519 188.206 63.6356 180.965 63.4526C179.424 63.4139 176.871 57.9436 176.037 56.8029C173.966 53.7129 172.454 51.9826 168.556 51.0886C160.21 53.3166 154.759 66.2456 152.303 73.8451C154.795 70.8254 157.961 67.0404 162.19 67.1524C170.899 67.3834 171.782 76.9191 171.792 83.2724C171.551 88.8779 170.398 94.0674 167.162 98.7834C164.723 102.339 160.352 105.787 156.027 106.538C152.676 107.12 149.232 106.34 146.459 104.371C132.467 94.2824 143.909 65.2676 152.4 54.8404C156.484 49.8239 160.309 45.4891 167.025 44.4704Z";

  const LEFT_BROW_PATH =
    "M93.6561 22.4892C99.1249 21.7517 105.953 24.2347 110.326 27.3962C112.412 28.9042 116.383 32.2214 116.721 34.9364C117.313 39.6847 110.834 43.7487 107.124 40.0754C105.427 38.4307 103.996 36.3007 102.262 34.9142C99.5189 32.7524 96.0224 31.7834 92.5579 32.2252C83.2604 33.3494 75.0191 42.5322 69.6109 49.5404C65.6656 54.8812 62.9979 59.6997 60.0876 65.5967C59.4291 66.9309 58.9096 67.9312 57.5631 68.3199C57.0536 68.2497 56.6429 68.1509 56.2166 67.8459C55.7289 67.4967 55.4516 67.1182 55.3621 66.5182C54.9241 63.5837 63.3801 47.5589 65.1886 44.5614C66.9624 41.6139 68.9379 38.7924 71.1009 36.1174C77.0971 28.7369 83.8534 23.4872 93.6561 22.4892Z";

  // Complete, authentic book path from bud.svg
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

  // Exported control methods
  export function takeCoffeeBreak() {
    setActivityState("drinking", true);
  }

  export function takeNap() {
    setActivityState("sleeping", true);
  }

  export function wakeUp() {
    setActivityState("reading", true);
  }

  export function readBook() {
    setActivityState("reading", true);
  }

  export function flipPage(direction: "next" | "prev" = "next") {
    triggerPageFlip(direction);
  }

  export function getActivity() {
    return currentActivity;
  }

  let setActivityState: (act: "reading" | "drinking" | "sleeping", force?: boolean) => void = () => {};
  let triggerPageFlip: (dir: "next" | "prev") => void = () => {};
  let currentActivity = $state<"reading" | "drinking" | "sleeping">("reading");

  onMount(() => {
    let eyeX = -8.0, eyeY = 6.5;
    let stemX = 0, stemY = 2.0, stemRotate = 0.5;
    let browX = 0, browY = 3.5, browRotate = 0.4;
    let bodyX = 0, bodyY = 1.8, bodyRotate = 1.0;

    let cupCurrentX = 258, cupCurrentY = 240, cupCurrentRotate = 0;
    let targetCupX = 258, targetCupY = 240, targetCupRotate = 0;

    let targetEyeX = -8.0, targetEyeY = 6.5;
    let targetStemRotate = 0.5, targetStemX = 0.4, targetStemY = 2.0;
    let targetBrowRotate = 0.4, targetBrowX = 0.2, targetBrowY = 3.5;
    let targetBodyRotate = 1.0, targetBodyX = 0, targetBodyY = 1.8;

    let pointerTargetEyeX = 0, pointerTargetEyeY = 0;
    let pointerTargetStemX = 0, pointerTargetStemY = 0, pointerTargetStemRotate = 0;
    let pointerTargetBrowX = 0, pointerTargetBrowY = 0, pointerTargetBrowRotate = 0;
    let pointerTargetBodyX = 0, pointerTargetBodyY = 0, pointerTargetBodyRotate = 0;

    let lastPointerMoveTime = 0;
    let isPointerInWindow = true;
    let isPointerNear = false;
    let pointerCuriosityWeight = 0;

    // Living page rhythm: every page gets its own line lengths, and Bud
    // sometimes re-reads a line, pauses to think, or skims ahead.
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
    let lastFrameTime = performance.now();

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

    // Page flip state (organic timing, overshoot settle)
    let isFlipping = false;
    let flipDirection: "next" | "prev" = "next";
    let flipProgress = 0;
    let flipStartTime = 0;
    let flipDur = 650; // ms, re-rolled every turn

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

    newPage();

    // Activity state machine
    let stateStartTime = performance.now();
    let nextAutoSwitchTime = performance.now() + 8500 + Math.random() * 4000;
    let currentInternalActivity: "reading" | "drinking" | "sleeping" = "reading";

    // Coffee aroma savoring variables
    const aromaCycleDuration = 4600; // ms

    // Sleep variables
    let sleepBreathTime = 0;

    // Book bounce
    let bookSpringY = 0;
    let bookSpringVel = 0;

    // Saccades
    let saccadeX = 0, saccadeY = 0;
    let targetSaccadeX = 0, targetSaccadeY = 0;
    let nextSaccadeTime = performance.now() + 300;

    // Blink state
    let blinkScale = 1;
    let isBlinking = false;
    let blinkStartTime = 0;
    let blinkDuration = 150;
    let isDoubleBlinking = false;
    let doubleBlinkStage = 0;
    let nextBlinkTime = performance.now() + 4500;

    let frame = 0;

    setActivityState = function (act: "reading" | "drinking" | "sleeping", force = false) {
      if (currentInternalActivity === act && !force) return;
      currentInternalActivity = act;
      currentActivity = act;
      stateStartTime = performance.now();
      onactivitychange?.(act);

      // Leaving mid-turn parks the pages so nothing freezes mid-air
      if (act !== "reading") {
        isFlipping = false;
        currentLift = 0;
      }

      if (act === "reading") {
        newPage();
        triggerBlink(true);
      } else if (act === "drinking") {
        stateStartTime = performance.now();
      } else if (act === "sleeping") {
        triggerBlink();
      }
    };

    function triggerBlink(forceDouble = false) {
      if (isBlinking || currentInternalActivity === "sleeping") return;
      isBlinking = true;
      blinkStartTime = performance.now();
      blinkDuration = 150;
      isDoubleBlinking = forceDouble || Math.random() < 0.12;
      doubleBlinkStage = 0;
    }

    triggerPageFlip = function (direction: "next" | "prev" = "next") {
      if (isFlipping || currentInternalActivity !== "reading") return;
      // The flyer peels off the rest stack; the dip/sink runs in-loop
      flipFromT = direction === "next" ? currentLift : 0;
      currentLift = 0;
      // Pin the flyer above the other strokes for the whole turn
      const takeEl = direction === "next" ? elLeft : elRight;
      if (bookGroup && takeEl) bookGroup.appendChild(takeEl);
      isFlipping = true;
      flipDirection = direction;
      flipProgress = 0;
      flipStartTime = performance.now();
      flipDur = direction === "next" && skimPage ? 400 : 560 + Math.random() * 180;

      onflip?.(direction);
    };

    function handlePointerMove(event: PointerEvent) {
      if (!interactive || !svg) return;
      lastPointerMoveTime = performance.now();
      isPointerInWindow = true;

      const rect = svg.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;

      const dx = event.clientX - centerX;
      const dy = event.clientY - centerY;
      const dist = Math.hypot(dx, dy);

      if (dist < 130) {
        isPointerNear = true;
        // If sleeping and cursor nudges Bud, wake up!
        if (currentInternalActivity === "sleeping" && activity === "auto" && dist < 65) {
          setActivityState("reading");
          return;
        }

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
      isPointerInWindow = false;
    }

    function handlePointerEnter() {
      isPointerInWindow = true;
      lastPointerMoveTime = performance.now();
    }

    function animate(now: number) {
      const dt = Math.min(64, Math.max(1, now - lastFrameTime));
      lastFrameTime = now;
      const effectiveSpeed = Math.max(0.2, Math.min(3.5, speed));

      // Page strokes rest whenever no turn is running
      if (!isFlipping) {
        paintRest();
      }

      // Autonomous activity scheduler
      if (activity === "auto" && autoCycle) {
        if (now >= nextAutoSwitchTime) {
          if (currentInternalActivity === "reading") {
            const pick = Math.random();
            if (pick < 0.6) {
              setActivityState("drinking");
              nextAutoSwitchTime = now + aromaCycleDuration + 400;
            } else {
              setActivityState("sleeping");
              nextAutoSwitchTime = now + 7500 + Math.random() * 4000;
            }
          } else {
            setActivityState("reading");
            nextAutoSwitchTime = now + 9500 + Math.random() * 6000;
          }
        }
      } else if (activity !== "auto" && activity !== currentInternalActivity) {
        setActivityState(activity);
      }

      // ----------------------------------------------------
      // ACTIVITY 1: READING BOOK
      // ----------------------------------------------------
      if (currentInternalActivity === "reading") {
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
            triggerPageFlip("next");
          }

          // Regression: jump back mid-thought to re-read (once per page max)
          let currentLineIdx = lineIndexFor(Math.min(accumulatedReadingTime, pageDur - 1));
          if (currentLineIdx > prevLineIdx) {
            if (regressionsLeft > 0 && currentLineIdx <= 2 && !skimPage && Math.random() < 0.18) {
              accumulatedReadingTime = Math.max(0, accumulatedReadingTime - lineDur[currentLineIdx - 1] * 0.55);
              regressionsLeft--;
              currentLineIdx = lineIndexFor(Math.min(accumulatedReadingTime, pageDur - 1));
              triggerBlink();
            }
          }
          prevLineIdx = currentLineIdx;

          if (inPause) {
            targetBrowY = 1.6;
            targetBrowRotate = 2.4;
          } else {
            const lineTime = lineLocalTime(accumulatedReadingTime, currentLineIdx);

            const numWords = 4;
            const wordStep = Math.floor(lineTime * numWords);
            const wordSub = (lineTime * numWords) % 1;
            const snap = Math.min(1.0, Math.pow(wordSub / 0.25, 2));
            const smoothProgress = (wordStep + snap) / numWords;

            const scanStartX = -8.0;
            const scanEndX = 8.0;
            targetEyeX = scanStartX + (scanEndX - scanStartX) * smoothProgress;
            targetEyeY = 6.4 + currentLineIdx * 1.8;

            targetBodyRotate = (smoothProgress - 0.5) * 2.2;
            targetStemRotate = (smoothProgress - 0.5) * 1.8;
            targetBrowRotate = Math.sin(smoothProgress * Math.PI) * 0.8;
            targetStemX = targetEyeX * 0.12;
            targetStemY = 2.0 + currentLineIdx * 0.3;
            targetBrowX = targetEyeX * 0.15;
            targetBrowY = 3.5 + currentLineIdx * 0.25;
          }

          targetCupX = 258;
          targetCupY = 240;
          targetCupRotate = 0;

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
          // Page Flip Engine: the left stroke bends through the arc and lands as
          // the right page. Simultaneously the other stroke sinks into the blue
          // base and rises back on its new side. One continuous bend, no swaps.
          const elapsed = now - flipStartTime;
          flipProgress = Math.min(1.12, elapsed / flipDur);
          const clamped = Math.min(flipProgress, 1);

          if (flipDirection === "next") {
            const e = flipFromT + (1 - flipFromT) * clamped;
            if (elLeft) {
              elLeft.style.display = "block";
              elLeft.removeAttribute("transform");
              elLeft.setAttribute("d", pageStrokeD(e, clamped));
            }
            // Right yellow slides down-left and merges into the blue, done early
            if (elRight) {
              const sk = sstep(0.35, 0.7, flipProgress);
              elRight.style.display = "block";
              elRight.setAttribute("transform", `translate(${(-6 * sk).toFixed(1)} ${(12 * sk).toFixed(1)})`);
              elRight.setAttribute("d", pageStrokeD(1, 1));
            }
            // Fresh page slides up-right out of the blue on the left, late —
            // gated off entirely until the flyer has vacated the area
            if (elSpare) {
              const rr = sstep(0.5, 0.85, flipProgress);
              elSpare.style.display = flipProgress < 0.5 ? "none" : "block";
              elSpare.setAttribute("transform", `translate(${(6 * (1 - rr)).toFixed(1)} ${(12 * (1 - rr)).toFixed(1)})`);
              elSpare.setAttribute("d", pageStrokeD(0, 0));
            }
          } else {
            const e = 1 - clamped;
            if (elRight) {
              elRight.style.display = "block";
              elRight.removeAttribute("transform");
              elRight.setAttribute("d", pageStrokeD(e, clamped));
            }
            if (elLeft) {
              const sk = sstep(0.35, 0.7, flipProgress);
              elLeft.style.display = "block";
              elLeft.setAttribute("transform", `translate(${(6 * sk).toFixed(1)} ${(12 * sk).toFixed(1)})`);
              elLeft.setAttribute("d", pageStrokeD(0, 0));
            }
            if (elSpare) {
              const rr = sstep(0.5, 0.85, flipProgress);
              elSpare.style.display = flipProgress < 0.5 ? "none" : "block";
              elSpare.setAttribute("transform", `translate(${(-6 * (1 - rr)).toFixed(1)} ${(12 * (1 - rr)).toFixed(1)})`);
              elSpare.setAttribute("d", pageStrokeD(1, 1));
            }
          }

          const sweepProgress = flipDirection === "next" ? clamped : 1 - clamped;
          targetEyeX = -8.5 + sweepProgress * 17.0;
          targetEyeY = 7.5 - Math.sin(clamped * Math.PI) * 5.0;
          targetStemRotate = (sweepProgress - 0.5) * 3.4;
          targetBodyRotate = (sweepProgress - 0.5) * 2.8;
          targetBrowRotate = Math.sin(clamped * Math.PI) * 2.2;

          // Landing: roles rotate — risen → side, flown → opposite side,
          // sunk → spare inside the blue. The loop continues.
          if (flipProgress >= 1.1) {
            isFlipping = false;
            currentLift = 0;
            if (flipDirection === "next") {
              const flown = elLeft, sunk = elRight, risen = elSpare;
              elLeft = risen;
              elRight = flown;
              elSpare = sunk;
            } else {
              const flown = elRight, sunk = elLeft, risen = elSpare;
              elRight = risen;
              elLeft = flown;
              elSpare = sunk;
            }
            paintRest();
            newPage();
            bookSpringVel = -0.07;
            triggerBlink();
          }
        }

        if (zzzGroup) zzzGroup.style.display = "none";
      }

      // ----------------------------------------------------
      // ACTIVITY 2: COFFEE DRINKING RITUAL
      // (The cup lifts from the desk saucer up to Bud's face,
      //  tilts inwards for a cozy sip, Bud's chest swells with warmth,
      //  Bud swallows in sheer bliss, and lowers the cup back to the saucer)
      // ----------------------------------------------------
      else if (currentInternalActivity === "drinking") {
        if (zzzGroup) zzzGroup.style.display = "none";

        const elapsedAroma = now - stateStartTime;
        const cycleDuration = aromaCycleDuration / effectiveSpeed;
        const progress = Math.min(1.0, Math.max(0, elapsedAroma / cycleDuration));

        if (progress < 0.15) {
          // Phase 1: Glance over at the steaming mug on the desk
          const p = progress / 0.15;
          const ease = 0.5 - 0.5 * Math.cos(p * Math.PI);
          targetEyeX = 12.0 * ease;
          targetEyeY = 7.5 * ease;
          targetBodyRotate = 1.5 * ease;
          targetStemRotate = 2.0 * ease;
          targetBrowRotate = -1.0 * ease;
          targetCupX = 258;
          targetCupY = 240 + Math.sin(p * Math.PI * 2) * 0.5;
          targetCupRotate = 0;
          blinkScale = 1.0;
        } else if (progress < 0.38) {
          // Phase 2: Lift cup from saucer and glide to Bud's face level
          const p = (progress - 0.15) / 0.23;
          const ease = 0.5 - 0.5 * Math.cos(p * Math.PI);
          targetCupX = 258 + (196 - 258) * ease;
          targetCupY = 240 + (136 - 240) * ease;
          targetCupRotate = -22.0 * ease;

          targetEyeX = 12.0 - p * 4.0;
          targetEyeY = 6.0;
          targetBodyX = 2.5 * ease;
          targetBodyRotate = 2.0 * ease;
          targetStemRotate = 2.4 * ease;
          targetBrowRotate = 1.2 * ease;
          blinkScale = 1.0;
        } else if (progress < 0.72) {
          // Phase 3: The Drink / Sip & Savor!
          // Cup tilts deeper into the sip right by Bud's stem, Bud tips head back slightly
          const p = (progress - 0.38) / 0.34;
          const drinkTilt = Math.sin(p * Math.PI);
          const sipBob = Math.sin(p * Math.PI * 4); // two gentle sips

          targetCupX = 196 - drinkTilt * 4.0;
          targetCupY = 136 + sipBob * 1.8;
          targetCupRotate = -22.0 - drinkTilt * 12.0; // tilts to -34deg

          targetEyeX = 8.0;
          targetEyeY = 4.0;
          targetBodyX = 2.5 * (1 - drinkTilt * 0.5);
          targetBodyY = -2.2 * drinkTilt; // chest swells with warm drink
          targetBodyRotate = -1.8 * drinkTilt; // head tips back slightly in appreciation
          targetStemRotate = -1.5 * drinkTilt;
          targetStemY = 2.0 + sipBob * 0.8;
          targetBrowRotate = 1.5 * drinkTilt;

          // Eyes soften into blissful closed crescents during the warm drink
          blinkScale = Math.max(0.06, 1.0 - drinkTilt * 0.94);
        } else if (progress < 0.92) {
          // Phase 4: Lowering the cup back down to the desk
          const p = (progress - 0.72) / 0.20;
          const ease = 0.5 - 0.5 * Math.cos(p * Math.PI);

          targetCupX = 196 + (258 - 196) * ease;
          targetCupY = 136 + (240 - 136) * ease;
          targetCupRotate = -22.0 * (1 - ease);

          targetEyeX = 8.0 * (1 - p);
          targetEyeY = 6.4;
          targetBodyX = 0;
          targetBodyY = 0;
          targetBodyRotate = 0;
          targetStemRotate = 0;
          targetBrowRotate = 0;
          blinkScale = 1.0;
        } else {
          // Phase 5: Soft cushion landing on the saucer
          const p = (progress - 0.92) / 0.08;
          const bounce = Math.sin(p * Math.PI) * 1.2;
          targetCupX = 258;
          targetCupY = 240 + bounce;
          targetCupRotate = 0;
          blinkScale = 1.0;
        }

        if (progress >= 1.0) {
          if (activity === "auto") {
            setActivityState("reading");
          } else if (activity === "drinking") {
            // In manual drinking mode, take another sip every 1.5s
            if (now - stateStartTime >= cycleDuration + 1500) {
              stateStartTime = now;
            }
          }
        }
      }

      // ----------------------------------------------------
      // ACTIVITY 3: SLEEPING / DOZING OFF
      // ----------------------------------------------------
      else if (currentInternalActivity === "sleeping") {
        targetCupX = 258;
        targetCupY = 240;
        targetCupRotate = 0;

        sleepBreathTime += dt * 0.001; // slower, restful slumber breathing
        const nod = Math.sin(sleepBreathTime * 1.5) * 1.8;

        // Head droops forward down toward book in peaceful sleep
        targetEyeX = 0;
        targetEyeY = 9.0;
        targetBodyX = 0;
        targetBodyY = 4.8 + nod;
        targetBodyRotate = 1.6 + nod * 0.4;
        targetStemY = 3.8;
        targetStemRotate = 0.8;
        targetBrowY = 4.8;
        targetBrowRotate = -0.5;

        // Eyes closed
        blinkScale = 0.05;

        // Drifting Zzz
        if (zzzGroup) {
          zzzGroup.style.display = "block";
          const zCycle = (now * 0.0011) % 3.0;
          const zzzOpacity = Math.sin((zCycle / 3.0) * Math.PI);
          const zzzY = -zCycle * 15.0;
          zzzGroup.setAttribute(
            "transform",
            `translate(${142 + Math.sin(zCycle * 2.2) * 3} ${68 + zzzY})`,
          );
          zzzGroup.setAttribute("opacity", Math.max(0, zzzOpacity).toFixed(2));
        }
      }

      // Book bounce
      bookSpringY += bookSpringVel;
      bookSpringVel += (0 - bookSpringY) * 0.3;
      bookSpringVel *= 0.72;

      if (bookGroup) {
        const sY = 1 + bookSpringY;
        bookGroup.setAttribute(
          "transform",
          `translate(127 230) scale(1 ${sY.toFixed(3)}) translate(-127 -230)`,
        );
      }

      // Pointer curiosity
      const idleTime = now - lastPointerMoveTime;
      const shouldLookAtPointer =
        isPointerNear && idleTime < 1200 && currentInternalActivity !== "sleeping";

      if (shouldLookAtPointer) {
        pointerCuriosityWeight = Math.min(0.65, pointerCuriosityWeight + 0.08);
      } else {
        pointerCuriosityWeight = Math.max(0, pointerCuriosityWeight - 0.05);
      }

      // Micro-saccades
      if (now >= nextSaccadeTime) {
        targetSaccadeX = (Math.random() - 0.5) * 1.2;
        targetSaccadeY = (Math.random() - 0.5) * 0.8;
        nextSaccadeTime = now + 200 + Math.random() * 250;
      }
      saccadeX += (targetSaccadeX - saccadeX) * 0.28;
      saccadeY += (targetSaccadeY - saccadeY) * 0.28;

      // Breathing physics
      const breathFreq = currentInternalActivity === "sleeping" ? 0.0011 : 0.0017;
      const breathTime = now * breathFreq;
      const breathRaw = Math.sin(breathTime) + 0.24 * Math.sin(breathTime * 2.0 - 0.5);
      const breathY = breathRaw * (currentInternalActivity === "sleeping" ? -1.6 : -0.9);
      const breathStemY = breathRaw * -0.5;
      const breathBrowY = breathRaw * -0.4;
      const swayRot = Math.cos(breathTime * 0.5) * 0.4;

      // Blend targets
      const effTargetEyeX =
        pointerTargetEyeX * pointerCuriosityWeight + targetEyeX * (1 - pointerCuriosityWeight);
      const effTargetEyeY =
        pointerTargetEyeY * pointerCuriosityWeight + targetEyeY * (1 - pointerCuriosityWeight);

      const effTargetBodyX =
        pointerTargetBodyX * pointerCuriosityWeight + targetBodyX * (1 - pointerCuriosityWeight);
      const effTargetBodyY =
        pointerTargetBodyY * pointerCuriosityWeight + targetBodyY * (1 - pointerCuriosityWeight);
      const effTargetBodyRotate =
        pointerTargetBodyRotate * pointerCuriosityWeight +
        targetBodyRotate * (1 - pointerCuriosityWeight);

      const effTargetStemX =
        pointerTargetStemX * pointerCuriosityWeight + targetStemX * (1 - pointerCuriosityWeight);
      const effTargetStemY =
        pointerTargetStemY * pointerCuriosityWeight + targetStemY * (1 - pointerCuriosityWeight);
      const effTargetStemRotate =
        pointerTargetStemRotate * pointerCuriosityWeight +
        targetStemRotate * (1 - pointerCuriosityWeight);

      const effTargetBrowX =
        pointerTargetBrowX * pointerCuriosityWeight + targetBrowX * (1 - pointerCuriosityWeight);
      const effTargetBrowY =
        pointerTargetBrowY * pointerCuriosityWeight + targetBrowY * (1 - pointerCuriosityWeight);
      const effTargetBrowRotate =
        pointerTargetBrowRotate * pointerCuriosityWeight +
        targetBrowRotate * (1 - pointerCuriosityWeight);

      eyeX += (effTargetEyeX + saccadeX - eyeX) * 0.22;
      eyeY += (effTargetEyeY + saccadeY - eyeY) * 0.22;

      bodyX += (effTargetBodyX - bodyX) * 0.08;
      bodyY += (effTargetBodyY + breathY - bodyY) * 0.08;
      bodyRotate += (effTargetBodyRotate + swayRot - bodyRotate) * 0.08;

      stemX += (effTargetStemX - stemX) * 0.12;
      stemY += (effTargetStemY + breathStemY - stemY) * 0.12;
      stemRotate += (effTargetStemRotate + swayRot * 0.6 - stemRotate) * 0.11;

      browX += (effTargetBrowX - browX) * 0.14;
      browY += (effTargetBrowY + breathBrowY - browY) * 0.14;
      browRotate += (effTargetBrowRotate - browRotate) * 0.12;

      // Apply transforms
      if (bodyGroup) {
        bodyGroup.setAttribute(
          "transform",
          `translate(${bodyX.toFixed(2)} ${bodyY.toFixed(2)}) rotate(${bodyRotate.toFixed(2)} 127 110)`,
        );
      }

      if (stemGroup) {
        stemGroup.setAttribute(
          "transform",
          `translate(${stemX.toFixed(2)} ${stemY.toFixed(2)}) rotate(${stemRotate.toFixed(2)} 122 175)`,
        );
      }

      if (eyesGroup) {
        eyesGroup.setAttribute("transform", `translate(${eyeX.toFixed(2)} ${eyeY.toFixed(2)})`);
      }

      if (leftBrow) {
        leftBrow.setAttribute(
          "transform",
          `translate(${browX.toFixed(2)} ${browY.toFixed(2)}) rotate(${browRotate.toFixed(2)} 86 45)`,
        );
      }

      // Animate cup position and rotation
      cupCurrentX += (targetCupX - cupCurrentX) * 0.18;
      cupCurrentY += (targetCupY - cupCurrentY) * 0.18;
      cupCurrentRotate += (targetCupRotate - cupCurrentRotate) * 0.18;

      if (cupGroup) {
        cupGroup.setAttribute(
          "transform",
          `translate(${cupCurrentX.toFixed(2)} ${cupCurrentY.toFixed(2)}) rotate(${cupCurrentRotate.toFixed(2)} 14 12)`,
        );
      }

      // Steam animation: wafts dynamically
      if (steamPath1 && steamPath2) {
        const sTime = now * 0.0025;
        // When inhaling aroma in drinking mode, steam curls gently toward Bud's face
        const leanDrift = currentInternalActivity === "drinking" ? -6.0 : 0;
        const w1 = Math.sin(sTime) * 3 + leanDrift;
        const w2 = Math.cos(sTime * 1.2) * 2.5 + leanDrift;

        steamPath1.setAttribute(
          "d",
          `M 8 -4 C ${5 + w1} -12 ${12 + w1} -20 ${8 + w1} -28 C ${4 + w1} -36 ${11 + w1} -44 7 -50`,
        );
        steamPath2.setAttribute(
          "d",
          `M 17 -6 C ${21 + w2} -14 ${14 + w2} -22 ${18 + w2} -30 C ${22 + w2} -38 ${15 + w2} -45 19 -52`,
        );
      }

      // Blinking engine
      if (currentInternalActivity !== "sleeping" && currentInternalActivity !== "drinking") {
        if (!isBlinking && now >= nextBlinkTime) {
          triggerBlink();
        }

        if (isBlinking && leftEye && rightEye) {
          const elapsed = now - blinkStartTime;
          if (elapsed >= blinkDuration) {
            if (isDoubleBlinking && doubleBlinkStage === 0) {
              doubleBlinkStage = 1;
              blinkStartTime = now;
              blinkDuration = 55;
              blinkScale = 0.85;
            } else if (isDoubleBlinking && doubleBlinkStage === 1) {
              doubleBlinkStage = 2;
              blinkStartTime = now;
              blinkDuration = 120;
            } else {
              isBlinking = false;
              isDoubleBlinking = false;
              doubleBlinkStage = 0;
              blinkScale = 1;
              nextBlinkTime = now + 4500 + Math.random() * 4500;
              leftEye.removeAttribute("transform");
              rightEye.removeAttribute("transform");
            }
          } else {
            const progress = elapsed / blinkDuration;
            const closeAmount = Math.sin(progress * Math.PI);
            blinkScale = Math.max(0.08, 1 - closeAmount * 0.92);

            leftEye.setAttribute(
              "transform",
              `translate(91 98) scale(1 ${blinkScale.toFixed(3)}) translate(-91 -98)`,
            );
            rightEye.setAttribute(
              "transform",
              `translate(161 76) scale(1 ${blinkScale.toFixed(3)}) translate(-161 -76)`,
            );
          }
        }
      } else if (leftEye && rightEye) {
        // Closed soft eye arcs
        leftEye.setAttribute(
          "transform",
          `translate(91 98) scale(1 ${blinkScale.toFixed(3)}) translate(-91 -98)`,
        );
        rightEye.setAttribute(
          "transform",
          `translate(161 76) scale(1 ${blinkScale.toFixed(3)}) translate(-161 -76)`,
        );
      }

      frame = requestAnimationFrame(animate);
    }

    window.addEventListener("pointermove", handlePointerMove, { passive: true });
    document.addEventListener("mouseleave", handlePointerLeave);
    document.addEventListener("mouseenter", handlePointerEnter);

    frame = requestAnimationFrame(animate);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("mouseleave", handlePointerLeave);
      document.removeEventListener("mouseenter", handlePointerEnter);
      cancelAnimationFrame(frame);
    };
  });
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<svg
  bind:this={svg}
  class="{className} select-none cursor-pointer overflow-visible"
  viewBox="-30 -16 335 320"
  fill="none"
  xmlns="http://www.w3.org/2000/svg"
  overflow="visible"
  style="overflow: visible;"
  role="button"
  tabindex="0"
  aria-label="Bud Does Things: reading, coffee aroma, and napping"
  onclick={(e) => {
    if (!interactive || !svg) return;
    if (currentActivity === "sleeping") {
      wakeUp();
      return;
    }

    const rect = svg.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;

    // Check if clicked the coffee mug area (bottom right)
    if (clickX > rect.width * 0.72 && clickY > rect.height * 0.6) {
      takeCoffeeBreak();
      return;
    }

    // Otherwise trigger page flip
    if (clickX < rect.width * 0.46) {
      triggerPageFlip("prev");
    } else {
      triggerPageFlip("next");
    }
  }}
>
  <defs>
    <filter
      id={filterId}
      x="-30%"
      y="-30%"
      width="160%"
      height="160%"
      color-interpolation-filters="sRGB"
    >
      <feFlood flood-opacity="0" result="BackgroundImageFix" />
      <feBlend
        mode="normal"
        in="SourceGraphic"
        in2="BackgroundImageFix"
        result="shape"
      />
      <feTurbulence
        type="fractalNoise"
        baseFrequency="0.2 0.2"
        numOctaves="3"
        seed="5016"
      />
      <feDisplacementMap
        in="shape"
        scale="4"
        xChannelSelector="R"
        yChannelSelector="G"
        result="displacedImage"
      />
      <feMerge>
        <feMergeNode in="displacedImage" />
      </feMerge>
    </filter>
  </defs>

  <g filter={`url(#${filterId})`}>
    <!-- Desk Surface Line & Saucer (Fixed on the desk surface) -->
    {#if showDesk}
      <path
        d="M -15 265 L 292 265"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        opacity="0.32"
      />
      <!-- Ceramic Coaster / Saucer (Fixed on the desk at x=272, y=264) -->
      <ellipse
        cx="272"
        cy="264"
        rx="15"
        ry="3"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        opacity="0.45"
      />
    {/if}

    <!-- Living Head & Face Group -->
    <g bind:this={bodyGroup}>
      <!-- Nose stem and connected right eyebrow -->
      <g bind:this={stemGroup}>
        <path d={NOSE_STEM_PATH} fill="currentColor" />
      </g>

      <!-- Eyes (Left and Right) -->
      <g bind:this={eyesGroup}>
        <path bind:this={leftEye} d={LEFT_EYE_PATH} fill="currentColor" />
        <path bind:this={rightEye} d={RIGHT_EYE_PATH} fill="currentColor" />
      </g>

      <!-- Left Eyebrow -->
      <g bind:this={leftBrow}>
        <path d={LEFT_BROW_PATH} fill="currentColor" />
      </g>
    </g>

    <!-- Complete Book & Body Group (Sitting on desk) -->
    <g bind:this={bookGroup}>
      <path d={FULL_BOOK_PATH} fill="currentColor" />
      <!-- Two page strokes over the blue mass. They trade roles every turn:
           the left stroke morphs into the flying page, the other sinks into
           the base and rises back on its new side. Strokes cross like lines,
           never stacking into thick slabs. -->
      <path bind:this={pageA} d={pageStrokeD(0, 0)} fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round" />
      <path bind:this={pageB} d={pageStrokeD(1, 1)} fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round" />
      <path bind:this={pageC} d={pageStrokeD(0, 0)} fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round" transform="translate(0 12)" />
    </g>

    <!-- Coffee Mug (Lifts from saucer, drinks, and sets back down) -->
    <g bind:this={cupGroup} transform="translate(258, 240)">
      <!-- Ceramic Cup Body -->
      <path d="M 2 2 C 2 -1 24 -1 24 2 L 21 22 C 20 25 5 25 4 22 Z" fill="currentColor" />
      <!-- Mug Handle -->
      <path
        d="M 23 5 C 31 5 32 17 21 19"
        fill="none"
        stroke="currentColor"
        stroke-width="2.4"
        stroke-linecap="round"
      />

      <!-- Rising Organic Steam Curls -->
      <path
        bind:this={steamPath1}
        d="M 8 -4 C 5 -12 12 -20 8 -28 C 4 -36 11 -44 7 -50"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
        opacity="0.75"
      />
      <path
        bind:this={steamPath2}
        d="M 17 -6 C 21 -14 14 -22 18 -30 C 22 -38 15 -45 19 -52"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
        opacity="0.6"
      />
    </g>

    <!-- Floating Sleep Z's (Subtle, minimalist chalk letters) -->
    <g bind:this={zzzGroup} style="display: none;">
      <path
        d="M -5 -10 L 2 -10 L -5 -3 L 2 -3 M 5 -22 L 14 -22 L 5 -13 L 14 -13 M 16 -36 L 27 -36 L 16 -24 L 27 -24"
        fill="none"
        stroke="currentColor"
        stroke-width="3"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </g>
  </g>
</svg>
