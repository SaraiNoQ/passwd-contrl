"use client";

import { useCallback, useRef, useState } from "react";
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
  const [isHovering, setIsHovering] = useState(false);

  const handleClick = useCallback(() => {
    clickCount.current += 1;

    const newHearts: HeartParticle[] = HEART_PATHS.map((path) => ({
      id: nextHeartId.current++,
      path,
    }));
    setHearts((prev) => [...prev, ...newHearts]);
    setTimeout(() => {
      setHearts((prev) => prev.filter((h) => !newHearts.some((nh) => nh.id === h.id)));
    }, 1100);

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

  const hoverMessage = {
    text: hoverTextForState(state),
    type: state === "error" ? "error" : state === "working" ? "info" : "fun",
  } satisfies MascotMessage;
  const visibleMessage = isHovering ? hoverMessage : message;

  return (
    <div
      ref={containerRef}
      className={`${styles.container} ${styles[state]}`}
      onClick={handleClick}
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
      role="img"
      aria-label={`像素猫伙伴 - ${stateLabel(state)}`}
      title={`状态: ${stateLabel(state)}`}
    >
      {visibleMessage ? (
        <div className={styles.bubbleWrap}>
          <SpeechBubble message={visibleMessage} onDismiss={onDismissMessage} />
        </div>
      ) : null}

      <div className={styles.mascot}>
        <img
          className={`${styles.spriteImage} ${spriteClassForState(state)}`}
          src={spriteSrcForState(state)}
          alt=""
          aria-hidden="true"
          draggable={false}
        />

        {state === "sleeping" ? (
          <div className={styles.zzzGroup}>
            <span className={styles.zzz}>z</span>
            <span className={styles.zzz}>Z</span>
            <span className={styles.zzz}>Z</span>
          </div>
        ) : null}

        {state === "excited" ? (
          <div className={styles.sparkles}>
            {SPARKLE_POINTS.map((i) => (
              <div key={i} className={`${styles.sparkle} ${styles[`sparkle${i}`]!}`} />
            ))}
          </div>
        ) : null}

        {hearts.map((heart) => (
          <span key={heart.id} className={`${styles.heartBurst} ${styles[`heartPath${heart.path}`]!}`}>
            &hearts;
          </span>
        ))}

        {(state === "working" || state === "error") ? <div className={styles.dot} /> : null}
      </div>
    </div>
  );
}

function hoverTextForState(state: MascotState): string {
  switch (state) {
    case "sleeping":
      return "我在低功耗守门。";
    case "walking":
      return "离线也能查看本机密码。";
    case "working":
      return "正在处理，请稍等。";
    case "excited":
      return "已复制，记得只粘贴到可信位置。";
    case "error":
      return "有提示需要你看一下。";
    case "idle":
    default:
      return "我守着你的本地加密密码库。";
  }
}

function spriteSrcForState(state: MascotState): string {
  switch (state) {
    case "working":
      return "/mascot/cat-hunter-work.png";
    case "error":
      return "/mascot/cat-hunter-alert.png";
    case "walking":
    case "excited":
      return "/mascot/cat-hunter-wave.png";
    case "sleeping":
    case "idle":
    default:
      return "/mascot/cat-hunter-idle.png";
  }
}

function spriteClassForState(state: MascotState): string {
  switch (state) {
    case "working":
      return styles.spriteWork!;
    case "error":
      return styles.spriteAlert!;
    case "walking":
    case "excited":
      return styles.spriteWave!;
    case "sleeping":
    case "idle":
    default:
      return styles.spriteIdle!;
  }
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
