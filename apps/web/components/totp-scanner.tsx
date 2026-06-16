"use client";

import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import { Camera, Clipboard, Radio, X } from "lucide-react";
import { isValidTotpSecret } from "../lib/totp";
import styles from "./totp-scanner.module.css";

interface TotpScannerProps {
  onSecret: (secret: string) => void;
}

export function TotpScanner({ onSecret }: TotpScannerProps) {
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState("");
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null) as MutableRefObject<MediaStream | null>;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scanIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null) as MutableRefObject<ReturnType<typeof setInterval> | null>;

  const stopScanning = useCallback(() => {
    if (scanIntervalRef.current) {
      clearInterval(scanIntervalRef.current);
      scanIntervalRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setScanning(false);
  }, []);

  useEffect(() => {
    return () => stopScanning();
  }, [stopScanning]);

  const scanFrame = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0);

    // Try to read QR code using BarcodeDetector API (Chrome 83+)
    if ("BarcodeDetector" in globalThis) {
      const detector = new (globalThis as Record<string, unknown> as { BarcodeDetector: new (opts: { formats: string[] }) => { detect: (canvas: HTMLCanvasElement) => Promise<Array<{ rawValue: string }>> } }).BarcodeDetector({ formats: ["qr_code"] });
      void detector.detect(canvas).then((barcodes: Array<{ rawValue: string }>) => {
        for (const barcode of barcodes) {
          const value = barcode.rawValue;
          if (value.startsWith("otpauth://") && isValidTotpSecret(value)) {
            onSecret(value);
            stopScanning();
            return;
          }
          // Check if it's a raw base32 secret
          if (isValidTotpSecret(value)) {
            onSecret(value);
            stopScanning();
            return;
          }
        }
      }).catch(() => {
        // Detection errors are expected when no QR code is visible
      });
    }
  }, [onSecret, stopScanning]);

  const startScanning = useCallback(async () => {
    setError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" }
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setScanning(true);
      scanIntervalRef.current = setInterval(scanFrame, 500);
    } catch {
      setError("无法访问摄像头。请确保已授权摄像头权限。");
    }
  }, [scanFrame]);

  const handlePasteFromClipboard = useCallback(async () => {
    setError("");
    try {
      const text = await navigator.clipboard.readText();
      if (!text) {
        setError("剪贴板为空");
        return;
      }
      // Check if it's a valid TOTP secret
      const trimmed = text.trim();
      if (isValidTotpSecret(trimmed)) {
        onSecret(trimmed);
      } else {
        setError("剪贴板内容不是有效的 TOTP 密钥");
      }
    } catch {
      setError("无法读取剪贴板");
    }
  }, [onSecret]);

  return (
    <section className={styles.scanner} aria-labelledby="totp-scanner-title">
      <div className={styles.header}>
        <div>
          <span className={styles.eyebrow}>TOTP / 验证码</span>
          <h3 id="totp-scanner-title" className={styles.title}>绑定验证码</h3>
          <p className={styles.subtitle}>扫码或粘贴密钥，保存到此记录。</p>
        </div>
        <span className={`${styles.status} ${scanning ? styles.statusActive : ""}`}>
          <span className={styles.statusDot} aria-hidden="true" />
          {scanning ? "正在扫描" : "待接入"}
        </span>
      </div>

      <div className={styles.channelGrid} aria-label="TOTP 密钥接入方式">
        <div className={`${styles.channelCard} ${scanning ? styles.channelCardActive : ""}`}>
          <span className={styles.channelIndex}>CH 01</span>
          <span className={styles.channelIcon} aria-hidden="true">
            <Camera size={20} />
          </span>
          <div className={styles.channelCopy}>
            <strong>扫码添加</strong>
            <span>识别验证器二维码</span>
          </div>
          <button
            type="button"
            onClick={scanning ? stopScanning : () => void startScanning()}
            aria-label={scanning ? "停止扫描" : "扫描二维码"}
            aria-pressed={scanning}
            className={`${styles.actionButton} ${styles.scanButton} ${scanning ? styles.actionButtonDanger : ""}`}
          >
            <Camera size={18} aria-hidden="true" />
            {scanning ? "停止扫描" : "开始扫描"}
          </button>
        </div>

        <div className={styles.channelCard}>
          <span className={styles.channelIndex}>CH 02</span>
          <span className={styles.channelIcon} aria-hidden="true">
            <Clipboard size={20} />
          </span>
          <div className={styles.channelCopy}>
            <strong>粘贴密钥</strong>
            <span>读取 otpauth 或 Base32</span>
          </div>
          <button
            type="button"
            onClick={() => void handlePasteFromClipboard()}
            aria-label="从剪贴板粘贴"
            className={styles.actionButton}
          >
            <Clipboard size={18} aria-hidden="true" />
            粘贴密钥
          </button>
        </div>
      </div>

      {scanning && (
        <div
          className={styles.videoFrame}
          role="group"
          aria-label="二维码扫描取景器"
        >
          <video
            ref={videoRef}
            className={styles.video}
            playsInline
            muted
            aria-label="摄像头实时画面"
          />
          <canvas ref={canvasRef} className={styles.canvas} />
          <div className={styles.videoRail}>
            <span><Radio size={13} aria-hidden="true" /> CAMERA CHANNEL ONLINE</span>
            <button
              type="button"
              onClick={stopScanning}
              aria-label="关闭二维码取景器"
              className={styles.iconButton}
            >
              <X size={18} aria-hidden="true" />
            </button>
          </div>
          <div className={styles.viewfinder} aria-hidden="true">
            <span className={`${styles.corner} ${styles.cornerTopLeft}`} />
            <span className={`${styles.corner} ${styles.cornerTopRight}`} />
            <span className={`${styles.corner} ${styles.cornerBottomLeft}`} />
            <span className={`${styles.corner} ${styles.cornerBottomRight}`} />
            <span className={styles.scanLine} />
          </div>
          <p className={styles.scanHint}>将二维码置于像素信标框内</p>
        </div>
      )}

      <div className={styles.liveRegion} aria-live="polite" aria-atomic="true">
        {scanning ? "摄像头已开启，正在识别动态验证码二维码。" : ""}
      </div>

      {error ? (
        <p className={styles.error} role="alert">{error}</p>
      ) : null}
    </section>
  );
}
