"use client";

import { useCallback, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { MascotState, MascotMessage } from "../../hooks/useMascot";
import { SpeechBubble } from "./speech-bubble";
import styles from "./pixel-mascot.module.css";

interface PixelMascotProps {
  state: MascotState;
  message: MascotMessage | null;
  onDismissMessage: () => void;
  onClick?: () => void;
  onFunClick?: () => void;
}

/* Pixel art guardian — 16x18 grid, each pixel = 6x6 SVG units */
const P = 6; // pixel size

type PixelRow = number[];
const SPRITE: PixelRow[] = [
  //  0  1  2  3  4  5  6  7  8  9 10 11 12 13 14 15
  [ 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 0, 0], // 0  ear tips
  [ 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 1, 1, 1, 0, 0, 0], // 1  ears
  [ 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0], // 2  head crown
  [ 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0], // 3  head top
  [ 0, 0, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 1, 1, 1, 0], // 4  face white starts
  [ 0, 0, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 1, 1, 0], // 5  eyes upper white
  [ 0, 0, 1, 1, 2, 3, 2, 2, 2, 2, 2, 3, 2, 1, 1, 0], // 6  eyes center (pupils at 5,11)
  [ 0, 0, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 1, 1, 0], // 7  eyes lower white
  [ 0, 0, 0, 1, 1, 4, 2, 2, 2, 2, 2, 4, 1, 1, 0, 0], // 8  blush cheeks
  [ 0, 0, 0, 1, 1, 1, 2, 3, 2, 3, 2, 1, 1, 1, 0, 0], // 9  nose area
  [ 0, 0, 0, 0, 1, 1, 1, 2, 3, 2, 1, 1, 1, 0, 0, 0], // 10 mouth smile
  [ 0, 0, 0, 0, 0, 1, 1, 1, 2, 1, 1, 1, 0, 0, 0, 0], // 11 chin
  [ 0, 0, 0, 0, 0, 0, 2, 2, 1, 2, 2, 0, 0, 0, 0, 0], // 12 neck scarf
  [ 0, 0, 0, 1, 1, 0, 2, 1, 2, 1, 2, 0, 1, 1, 0, 0], // 13 body with stubby arms
  [ 0, 0, 0, 0, 1, 0, 1, 2, 2, 2, 1, 0, 1, 0, 0, 0], // 14 body lower
  [ 0, 0, 0, 0, 0, 0, 0, 1, 2, 1, 0, 0, 0, 0, 0, 0], // 15 body bottom
  [ 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0], // 16 feet
  [ 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0], // 17 toes
];

const PIXEL_CLASSES: Record<number, string> = {
  1: styles.pixelBody!,
  2: styles.pixelWhite!,
  3: styles.pixelInk!,
  4: styles.pixelBlush!,
};

const HEART_PATHS = [0, 1, 2, 3, 4, 5] as const;
const SPARKLE_POINTS = [0, 1, 2, 3, 4, 5] as const;

interface HeartParticle {
  id: number;
  path: number;
}

export function PixelMascot({
  state,
  message,
  onDismissMessage,
  onClick,
  onFunClick,
}: PixelMascotProps) {
  const clickCount = useRef(0);
  const nextHeartId = useRef(0);
  const [hearts, setHearts] = useState<HeartParticle[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  const [cursorOffset, setCursorOffset] = useState({ dx: 0, dy: 0 });

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      // Normalise to [-1, 1] and clamp
      const dx = Math.max(-1, Math.min(1, (e.clientX - cx) / (rect.width / 2)));
      const dy = Math.max(-1, Math.min(1, (e.clientY - cy) / (rect.height / 2)));
      setCursorOffset({ dx, dy });
    },
    [],
  );

  const handleClick = useCallback(() => {
    clickCount.current += 1;

    // Spawn heart burst
    const newHearts: HeartParticle[] = HEART_PATHS.map((path) => ({
      id: nextHeartId.current++,
      path,
    }));
    setHearts((prev) => [...prev, ...newHearts]);
    // Remove hearts after animation
    setTimeout(() => {
      setHearts((prev) => prev.filter((h) => !newHearts.some((nh) => nh.id === h.id)));
    }, 800);

    if (clickCount.current >= 2) {
      clickCount.current = 0;
      onClick?.();
    } else if (state === "idle") {
      onFunClick?.();
    }
    setTimeout(() => {
      clickCount.current = 0;
    }, 500);
  }, [state, onClick, onFunClick]);

  const w = SPRITE[0]!.length * P;
  const h = SPRITE.length * P;
  const mascotTilt = {
    "--tilt-x": `${-cursorOffset.dy * 6}deg`,
    "--tilt-y": `${cursorOffset.dx * 8}deg`,
  } as CSSProperties;

  // Build body rects, splitting out eye pupils for blink animation
  const bodyRects: Array<{ x: number; y: number; color: number }> = [];
  const pupilRects: Array<{ x: number; y: number }> = [];

  SPRITE.forEach((row, yi) => {
    row.forEach((color, xi) => {
      if (color === 0) return;
      // Eye pupils (dark at row 6, cols 5 and 11)
      if (color === 3 && yi === 6) {
        pupilRects.push({ x: xi * P, y: yi * P });
      } else {
        bodyRects.push({ x: xi * P, y: yi * P, color });
      }
    });
  });

  return (
    <div
      ref={containerRef}
      className={`${styles.container} ${styles[state]}`}
      onClick={handleClick}
      onMouseMove={handleMouseMove}
      role="img"
      aria-label={`像素守护兽 — ${stateLabel(state)}`}
      title={`状态: ${stateLabel(state)}`}
    >
      {message && (
        <div className={styles.bubbleWrap}>
          <SpeechBubble message={message} onDismiss={onDismissMessage} />
        </div>
      )}

      <div
        className={styles.mascot}
      >
        <div className={styles.spriteStage} style={mascotTilt}>
          <svg
            width={w}
            height={h}
            viewBox={`0 0 ${w + P * 6} ${h}`}
            className={styles.svg}
            aria-hidden="true"
          >
            {/* Body */}
            {bodyRects.map((r, i) => (
              <rect
                key={`b-${i}`}
                x={r.x}
                y={r.y}
                width={P}
                height={P}
                className={PIXEL_CLASSES[r.color] ?? styles.pixelBody}
              />
            ))}

            {/* Blinking eye pupils */}
            <g className={styles.eyes}>
              {pupilRects.map((r, i) => (
                <rect
                  key={`p-${i}`}
                  x={r.x}
                  y={r.y}
                  width={P}
                  height={P}
                  className={styles.pixelInk}
                />
              ))}
            </g>

            {/* Floating key — separate element for rotation animation */}
            <g className={styles.key}>
              {/* Key bow (ring top) */}
              <rect x={13 * P} y={6 * P} width={P * 3} height={P} className={styles.keyGold} />
              {/* Key bow sides + hole */}
              <rect x={13 * P} y={7 * P} width={P} height={P} className={styles.keyGold} />
              <rect x={15 * P} y={7 * P} width={P} height={P} className={styles.keyGold} />
              {/* Key bow bottom */}
              <rect x={13 * P} y={8 * P} width={P * 3} height={P} className={styles.keyGold} />
              {/* Key shaft */}
              <rect x={14 * P} y={9 * P} width={P} height={P * 4} className={styles.keyGold} />
              {/* Key teeth */}
              <rect x={13 * P} y={13 * P} width={P * 2} height={P} className={styles.keyGold} />
              <rect x={12 * P} y={14 * P} width={P} height={P} className={styles.keyGold} />
              {/* Key highlight */}
              <rect x={14 * P + 2} y={6 * P + 2} width={P - 4} height={P - 4} className={styles.keyHighlight} />
            </g>
          </svg>
        </div>

        {/* Z's for sleeping */}
        {state === "sleeping" && (
          <div className={styles.zzzGroup}>
            <span className={styles.zzz}>z</span>
            <span className={styles.zzz}>Z</span>
            <span className={styles.zzz}>Z</span>
          </div>
        )}

        {/* Sparkles for excited */}
        {state === "excited" && (
          <div className={styles.sparkles}>
            {SPARKLE_POINTS.map((i) => (
              <div
                key={i}
                className={`${styles.sparkle} ${styles[`sparkle${i}`]!}`}
              />
            ))}
          </div>
        )}

        {/* Heart burst on click */}
        {hearts.map((heart) => (
          <span
            key={heart.id}
            className={`${styles.heartBurst} ${styles[`heartPath${heart.path}`]!}`}
          >
            &hearts;
          </span>
        ))}

        {/* Notification dot */}
        {(state === "working" || state === "error") && (
          <div className={styles.dot} />
        )}
      </div>
    </div>
  );
}

function stateLabel(state: MascotState): string {
  switch (state) {
    case "sleeping":
      return "休眠中";
    case "idle":
      return "待机中";
    case "walking":
      return "巡视中";
    case "working":
      return "工作中";
    case "excited":
      return "兴奋中";
    case "error":
      return "警报";
    default:
      return "在线";
  }
}
