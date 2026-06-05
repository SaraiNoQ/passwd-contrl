"use client";

import { useCallback, useRef, useState } from "react";
import { Camera, Clipboard, X } from "lucide-react";
import { isValidTotpSecret } from "../lib/totp";

interface TotpScannerProps {
  onSecret: (secret: string) => void;
}

export function TotpScanner({ onSecret }: TotpScannerProps) {
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState("");
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scanIntervalRef = useRef<ReturnType<typeof setInterval>>(null);

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
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", gap: 8 }}>
        <button
          type="button"
          onClick={scanning ? stopScanning : () => void startScanning()}
          aria-label={scanning ? "停止扫描" : "扫描二维码"}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            padding: "6px 12px",
            borderRadius: 6,
            border: "1px solid var(--color-border)",
            background: scanning ? "var(--color-error)" : "var(--color-surface)",
            color: scanning ? "white" : "var(--color-text)",
            cursor: "pointer",
            fontSize: 13
          }}
        >
          <Camera size={14} />
          {scanning ? "停止" : "扫描二维码"}
        </button>
        <button
          type="button"
          onClick={() => void handlePasteFromClipboard()}
          aria-label="从剪贴板粘贴"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            padding: "6px 12px",
            borderRadius: 6,
            border: "1px solid var(--color-border)",
            background: "var(--color-surface)",
            color: "var(--color-text)",
            cursor: "pointer",
            fontSize: 13
          }}
        >
          <Clipboard size={14} />
          从剪贴板粘贴
        </button>
        {scanning && (
          <button
            type="button"
            onClick={stopScanning}
            aria-label="关闭"
            style={{
              display: "flex",
              alignItems: "center",
              padding: 6,
              borderRadius: 6,
              border: "1px solid var(--color-border)",
              background: "var(--color-surface)",
              cursor: "pointer"
            }}
          >
            <X size={14} />
          </button>
        )}
      </div>

      {scanning && (
        <div style={{ position: "relative", borderRadius: 8, overflow: "hidden" }}>
          <video
            ref={videoRef}
            style={{ width: "100%", maxHeight: 200, objectFit: "cover" }}
            playsInline
            muted
          />
          <canvas ref={canvasRef} style={{ display: "none" }} />
        </div>
      )}

      {error && (
        <p style={{ fontSize: 12, color: "var(--color-error)", margin: 0 }}>{error}</p>
      )}
    </div>
  );
}
