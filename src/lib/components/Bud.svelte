<script lang="ts">
  import { onMount } from "svelte";

  let {
    class: className = "",
    size = 56
  }: {
    class?: string;
    size?: number;
  } = $props();

  let svg: SVGSVGElement = $state()!;
  let bodyGroup: SVGGElement = $state()!;
  let stemGroup: SVGGElement = $state()!;
  let eyesGroup: SVGGElement = $state()!;
  let leftEye: SVGPathElement = $state()!;
  let rightEye: SVGPathElement = $state()!;
  let leftBrow: SVGGElement = $state()!;

  // Autonomous idle thoughts and curious glances
  const IDLE_ACTIONS = [
    {
      eyeX: -9.5, eyeY: -7.0, browX: -4.5, browY: -5.5, browRot: 2.8,
      stemRot: -3.2, stemX: -2.0, stemY: -2.5, bodyRot: -2.4, bodyX: -2.0, bodyY: -1.0, duration: 3200
    },
    {
      eyeX: 10.5, eyeY: -2.0, browX: 5.0, browY: -2.0, browRot: -2.2,
      stemRot: 3.8, stemX: 2.5, stemY: -1.2, bodyRot: 2.8, bodyX: 2.0, bodyY: 0, duration: 2800
    },
    {
      eyeX: 1.0, eyeY: 9.0, browX: 0.5, browY: 4.8, browRot: 0.5,
      stemRot: 0.8, stemX: 0.5, stemY: 3.2, bodyRot: 1.2, bodyX: 0, bodyY: 1.6, duration: 3400
    },
    {
      eyeX: 4.5, eyeY: -4.5, browX: 3.2, browY: -4.0, browRot: 3.8,
      stemRot: 3.2, stemX: 1.8, stemY: -2.0, bodyRot: 4.4, bodyX: 1.6, bodyY: -1.0, duration: 2700
    },
    {
      eyeX: -5.0, eyeY: 2.5, browX: -2.5, browY: 1.0, browRot: -3.2,
      stemRot: -3.4, stemX: -1.8, stemY: 1.0, bodyRot: -4.0, bodyX: -1.6, bodyY: 0.6, duration: 2900
    },
    {
      eyeX: 0, eyeY: 0, browX: 0, browY: 0, browRot: 0,
      stemRot: 0, stemX: 0, stemY: 0, bodyRot: 0, bodyX: 0, bodyY: 0, duration: 3200
    },
    {
      eyeX: -12.0, eyeY: 1.0, browX: -6.0, browY: 1.0, browRot: 2.4,
      stemRot: -4.0, stemX: -2.6, stemY: 0.6, bodyRot: -3.0, bodyX: -2.2, bodyY: 0.5, duration: 2600
    },
    {
      eyeX: 11.5, eyeY: -6.0, browX: 5.5, browY: -4.5, browRot: -3.0,
      stemRot: 4.0, stemX: 2.6, stemY: -2.5, bodyRot: 3.2, bodyX: 2.0, bodyY: -1.0, duration: 2700
    }
  ];

  onMount(() => {
    let eyeX = 0, eyeY = 0;
    let stemX = 0, stemY = 0, stemRotate = 0;
    let browX = 0, browY = 0, browRotate = 0;
    let bodyX = 0, bodyY = 0, bodyRotate = 0;

    let pointerTargetEyeX = 0, pointerTargetEyeY = 0;
    let pointerTargetStemX = 0, pointerTargetStemY = 0, pointerTargetStemRotate = 0;
    let pointerTargetBrowX = 0, pointerTargetBrowY = 0, pointerTargetBrowRotate = 0;
    let pointerTargetBodyX = 0, pointerTargetBodyY = 0, pointerTargetBodyRotate = 0;

    let idleTargetEyeX = 0, idleTargetEyeY = 0;
    let idleTargetStemX = 0, idleTargetStemY = 0, idleTargetStemRotate = 0;
    let idleTargetBrowX = 0, idleTargetBrowY = 0, idleTargetBrowRotate = 0;
    let idleTargetBodyX = 0, idleTargetBodyY = 0, idleTargetBodyRotate = 0;

    let saccadeX = 0, saccadeY = 0;
    let targetSaccadeX = 0, targetSaccadeY = 0;
    let nextSaccadeTime = performance.now() + 800;

    let lastPointerTime = 0;
    let isPointerInWindow = true;
    let trackWeight = 0;
    let currentIdleIndex = 5;
    let nextIdleSwitchTime = performance.now() + 2500;
    let isInputFocused = false;

    let blinkScale = 1;
    let isBlinking = false;
    let blinkStartTime = 0;
    let blinkDuration = 160;
    let isDoubleBlinking = false;
    let doubleBlinkStage = 0;
    let nextBlinkTime = performance.now() + 5000 + Math.random() * 4000;

    let frame = 0;

    function triggerBlink(forceDouble = false) {
      if (isBlinking) return;
      isBlinking = true;
      blinkStartTime = performance.now();
      blinkDuration = 160;
      isDoubleBlinking = forceDouble || Math.random() < 0.07;
      doubleBlinkStage = 0;
    }

    function handlePointerMove(event: PointerEvent) {
      if (!svg) return;
      lastPointerTime = performance.now();
      isPointerInWindow = true;

      const rect = svg.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;

      const dx = event.clientX - centerX;
      const dy = event.clientY - centerY;
      const dist = Math.hypot(dx, dy);

      if (dist < 1) return;

      const maxRadius = 380;
      const factor = Math.min(dist / maxRadius, 1);
      const ease = Math.sin((factor * Math.PI) / 2);

      const nx = (dx / dist) * ease;
      const ny = (dy / dist) * ease;

      pointerTargetEyeX = nx * 14.5;
      pointerTargetEyeY = ny * 10.0;
      pointerTargetBodyX = nx * 3.2;
      pointerTargetBodyY = ny * 2.2;
      pointerTargetBodyRotate = nx * 3.2;
      pointerTargetStemRotate = nx * 4.2;
      pointerTargetStemX = nx * 2.8;
      pointerTargetStemY = ny * 3.8;
      pointerTargetBrowX = nx * 7.0;
      pointerTargetBrowY = ny * 6.0;
      pointerTargetBrowRotate = nx * 3.6 - ny * 2.5;
    }

    function handlePointerLeave() {
      isPointerInWindow = false;
    }

    function handlePointerEnter() {
      isPointerInWindow = true;
      lastPointerTime = performance.now();
    }

    function handleFocusIn(event: FocusEvent) {
      const el = event.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "BUTTON")) {
        isInputFocused = true;
      }
    }

    function handleFocusOut() {
      isInputFocused = false;
    }

    function animate(now: number) {
      const idleTime = now - lastPointerTime;
      const isIdle = !isPointerInWindow || idleTime > 1600;

      if (isIdle) {
        trackWeight = Math.max(0, trackWeight - 0.06);
      } else {
        trackWeight = Math.min(1, trackWeight + 0.12);
      }

      if (trackWeight < 0.95) {
        if (isInputFocused) {
          idleTargetEyeX = 1.0;
          idleTargetEyeY = 8.5;
          idleTargetBrowX = 0.5;
          idleTargetBrowY = 4.5;
          idleTargetBrowRotate = 0.5;
          idleTargetStemRotate = 0.8;
          idleTargetStemX = 0.5;
          idleTargetStemY = 3.0;
          idleTargetBodyRotate = 1.2;
          idleTargetBodyX = 0;
          idleTargetBodyY = 1.5;
        } else if (now >= nextIdleSwitchTime) {
          let nextIdx: number;
          do {
            nextIdx = Math.floor(Math.random() * IDLE_ACTIONS.length);
          } while (nextIdx === currentIdleIndex);

          currentIdleIndex = nextIdx;
          const action = IDLE_ACTIONS[currentIdleIndex];

          idleTargetEyeX = action.eyeX;
          idleTargetEyeY = action.eyeY;
          idleTargetBrowX = action.browX;
          idleTargetBrowY = action.browY;
          idleTargetBrowRotate = action.browRot;
          idleTargetStemRotate = action.stemRot;
          idleTargetStemX = action.stemX;
          idleTargetStemY = action.stemY;
          idleTargetBodyRotate = action.bodyRot;
          idleTargetBodyX = action.bodyX;
          idleTargetBodyY = action.bodyY;

          nextIdleSwitchTime = now + action.duration + 1200 + Math.random() * 2000;
        }
      }

      if (now >= nextSaccadeTime) {
        targetSaccadeX = (Math.random() - 0.5) * 1.5;
        targetSaccadeY = (Math.random() - 0.5) * 1.2;
        nextSaccadeTime = now + 700 + Math.random() * 800;
      }
      saccadeX += (targetSaccadeX - saccadeX) * 0.22;
      saccadeY += (targetSaccadeY - saccadeY) * 0.22;

      const breathTime = now * 0.0017;
      const breathRaw = Math.sin(breathTime) + 0.28 * Math.sin(breathTime * 2.0 - 0.6);
      const breathY = breathRaw * -0.95;
      const breathStemY = breathRaw * -0.55;
      const breathBrowY = breathRaw * -0.45;

      const swayX = Math.sin(breathTime * 0.45) * 0.75;
      const swayRot = Math.cos(breathTime * 0.45) * 0.5;

      const effTargetEyeX = pointerTargetEyeX * trackWeight + idleTargetEyeX * (1 - trackWeight);
      const effTargetEyeY = pointerTargetEyeY * trackWeight + idleTargetEyeY * (1 - trackWeight);

      const effTargetBodyX = pointerTargetBodyX * trackWeight + idleTargetBodyX * (1 - trackWeight);
      const effTargetBodyY = pointerTargetBodyY * trackWeight + idleTargetBodyY * (1 - trackWeight);
      const effTargetBodyRotate = pointerTargetBodyRotate * trackWeight + idleTargetBodyRotate * (1 - trackWeight);

      const effTargetStemX = pointerTargetStemX * trackWeight + idleTargetStemX * (1 - trackWeight);
      const effTargetStemY = pointerTargetStemY * trackWeight + idleTargetStemY * (1 - trackWeight);
      const effTargetStemRotate = pointerTargetStemRotate * trackWeight + idleTargetStemRotate * (1 - trackWeight);

      const effTargetBrowX = pointerTargetBrowX * trackWeight + idleTargetBrowX * (1 - trackWeight);
      const effTargetBrowY = pointerTargetBrowY * trackWeight + idleTargetBrowY * (1 - trackWeight);
      const effTargetBrowRotate = pointerTargetBrowRotate * trackWeight + idleTargetBrowRotate * (1 - trackWeight);

      eyeX += (effTargetEyeX + saccadeX - eyeX) * 0.17;
      eyeY += (effTargetEyeY + saccadeY - eyeY) * 0.17;

      bodyX += (effTargetBodyX + swayX - bodyX) * 0.08;
      bodyY += (effTargetBodyY + breathY - bodyY) * 0.08;
      bodyRotate += (effTargetBodyRotate + swayRot - bodyRotate) * 0.08;

      stemX += (effTargetStemX - stemX) * 0.12;
      stemY += (effTargetStemY + breathStemY - stemY) * 0.12;
      stemRotate += (effTargetStemRotate + swayRot * 0.6 - stemRotate) * 0.11;

      browX += (effTargetBrowX - browX) * 0.14;
      browY += (effTargetBrowY + breathBrowY - browY) * 0.14;
      browRotate += (effTargetBrowRotate - browRotate) * 0.12;

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
        eyesGroup.setAttribute(
          "transform",
          `translate(${eyeX.toFixed(2)} ${eyeY.toFixed(2)})`,
        );
      }

      if (leftBrow) {
        leftBrow.setAttribute(
          "transform",
          `translate(${browX.toFixed(2)} ${browY.toFixed(2)}) rotate(${browRotate.toFixed(2)} 86 45)`,
        );
      }

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
            nextBlinkTime = now + 6500 + Math.random() * 6500;
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

      if (document.hidden || (svg && !svg.isConnected)) {
        return;
      }

      frame = requestAnimationFrame(animate);
    }

    function handleVisibilityChange() {
      if (document.hidden) {
        cancelAnimationFrame(frame);
      } else {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(animate);
      }
    }

    window.addEventListener("pointermove", handlePointerMove, {
      passive: true,
    });
    document.addEventListener("mouseleave", handlePointerLeave);
    document.addEventListener("mouseenter", handlePointerEnter);
    document.addEventListener("focusin", handleFocusIn);
    document.addEventListener("focusout", handleFocusOut);
    window.addEventListener("blur", handlePointerLeave);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    frame = requestAnimationFrame(animate);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("mouseleave", handlePointerLeave);
      document.removeEventListener("mouseenter", handlePointerEnter);
      document.removeEventListener("focusin", handleFocusIn);
      document.removeEventListener("focusout", handleFocusOut);
      window.removeEventListener("blur", handlePointerLeave);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      cancelAnimationFrame(frame);
    };
  });
</script>

<svg
  bind:this={svg}
  class={className}
  width={size}
  height={size}
  viewBox="0 0 254 268"
  fill="none"
  xmlns="http://www.w3.org/2000/svg"
  overflow="visible"
  style="width: {size}px; height: {size}px; display: block; overflow: visible; flex-shrink: 0; color: inherit;"
  aria-label="Bud"
>
  <g bind:this={bodyGroup}>
    <!-- Nose stem and connected right eyebrow -->
    <g bind:this={stemGroup}>
      <path
        d="M154.573 2C164.716 2.25175 172.946 6.6995 180.92 12.6555C183.102 14.2855 187.969 17.3385 188.265 20.299C188.334 20.997 188.148 21.637 187.692 22.1718C186.988 22.998 185.702 23.6418 184.612 23.2675C182.526 22.5518 180.597 20.491 178.829 19.198C172.375 14.4765 163.201 9.05075 154.954 9.686C150.546 10.0253 146.913 12.315 144.119 15.6573C126.677 36.5213 131.45 117.61 133.793 145.205L144.224 132.903C149.182 127.081 154.285 118.568 162.481 125.283C164.572 127.681 166.273 132.245 163.994 135.02C151.005 150.837 134.867 164.928 122.331 181.092C122.117 175.096 121.105 169.08 120.705 163.084C118.538 130.612 115.602 35.1083 137.279 10.6485C141.896 5.43851 147.62 2.38075 154.573 2Z"
        fill="currentColor"
      />
    </g>

    <!-- Eyes (Left and Right) -->
    <g bind:this={eyesGroup}>
      <path
        bind:this={leftEye}
        d="M95.5129 66.4331C104.451 65.8273 106.496 69.4208 111.284 76.2528C116.699 82.5063 111.621 90.5116 107.237 81.2706C97.5494 60.8471 84.8746 84.5083 81.9534 95.8526C85.6414 90.8178 91.3236 85.9086 97.5069 91.2546C101.064 94.3301 101.307 99.8333 101.468 104.253C101.247 109.301 100.699 113.337 98.3891 118.038C96.3839 122.119 91.7436 126.619 87.3751 127.984C84.0891 129.016 80.5266 128.688 77.4841 127.074C63.6401 119.611 70.8529 94.6858 77.3034 84.2106C82.0294 76.5358 86.1959 69.0726 95.5129 66.4331Z"
        fill="currentColor"
      />

      <path
        bind:this={rightEye}
        d="M167.025 44.4704C172.355 44.1429 175.969 46.6149 179.161 50.6439C181.069 53.0519 188.206 63.6356 180.965 63.4526C179.424 63.4139 176.871 57.9436 176.037 56.8029C173.966 53.7129 172.454 51.9826 168.556 51.0886C160.21 53.3166 154.759 66.2456 152.303 73.8451C154.795 70.8254 157.961 67.0404 162.19 67.1524C170.899 67.3834 171.782 76.9191 171.792 83.2724C171.551 88.8779 170.398 94.0674 167.162 98.7834C164.723 102.339 160.352 105.787 156.027 106.538C152.676 107.12 149.232 106.34 146.459 104.371C132.467 94.2824 143.909 65.2676 152.4 54.8404C156.484 49.8239 160.309 45.4891 167.025 44.4704Z"
        fill="currentColor"
      />
    </g>

    <!-- Left Eyebrow -->
    <g bind:this={leftBrow}>
      <path
        d="M93.6561 22.4892C99.1249 21.7517 105.953 24.2347 110.326 27.3962C112.412 28.9042 116.383 32.2214 116.721 34.9364C117.313 39.6847 110.834 43.7487 107.124 40.0754C105.427 38.4307 103.996 36.3007 102.262 34.9142C99.5189 32.7524 96.0224 31.7834 92.5579 32.2252C83.2604 33.3494 75.0191 42.5322 69.6109 49.5404C65.6656 54.8812 62.9979 59.6997 60.0876 65.5967C59.4291 66.9309 58.9096 67.9312 57.5631 68.3199C57.0536 68.2497 56.6429 68.1509 56.2166 67.8459C55.7289 67.4967 55.4516 67.1182 55.3621 66.5182C54.9241 63.5837 63.3801 47.5589 65.1886 44.5614C66.9624 41.6139 68.9379 38.7924 71.1009 36.1174C77.0971 28.7369 83.8534 23.4872 93.6561 22.4892Z"
        fill="currentColor"
      />
    </g>
  </g>
</svg>
