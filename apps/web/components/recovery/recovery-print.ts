"use client";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function printRecoveryCode(recoveryCode: string): void {
  const printWindow = window.open("", "_blank", "width=520,height=680");
  if (!printWindow) return;

  const escapedCode = escapeHtml(recoveryCode);

  printWindow.document.write(`<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <title>Obscura — 恢复码</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Jersey+10&family=Manrope:wght@400;600;700;800&display=swap" rel="stylesheet" />
  <style>
    :root {
      color-scheme: light;
      --orange: #ff5e24;
      --cloud: #e3f1fe;
      --ink: #232629;
      --slate: #5c6066;
      --paper: #ffffff;
      --outline: #5c6066;
    }

    * { box-sizing: border-box; }

    body {
      background: var(--cloud);
      color: var(--ink);
      font-family: "Manrope", "PingFang SC", "Microsoft YaHei", sans-serif;
      margin: 0;
      padding: 36px;
    }

    .sheet {
      background: var(--paper);
      border: 1px solid var(--cloud);
      border-radius: 16px;
      box-shadow:
        rgba(15, 34, 52, 0.01) 0 27px 11px 0,
        rgba(15, 34, 52, 0.02) 0 15px 9px 0,
        rgba(15, 34, 52, 0.04) 0 7px 7px 0,
        rgba(15, 34, 52, 0.04) 0 2px 4px 0;
      margin: 0 auto;
      max-width: 560px;
      overflow: hidden;
      padding: 32px;
      position: relative;
    }

    .cloud {
      height: 48px;
      position: absolute;
      right: 26px;
      top: 22px;
      width: 96px;
    }

    .eyebrow {
      color: var(--orange);
      display: block;
      font-size: 12px;
      font-weight: 800;
      letter-spacing: 0.14em;
      margin-bottom: 12px;
    }

    h1 {
      color: var(--ink);
      font-family: "Jersey 10", "Manrope", sans-serif;
      font-size: 56px;
      font-weight: 400;
      letter-spacing: -0.025em;
      line-height: 0.88;
      margin: 0 0 16px;
      max-width: 360px;
    }

    .intro {
      color: var(--slate);
      font-size: 14px;
      line-height: 1.7;
      margin: 0 0 24px;
      max-width: 430px;
    }

    .label {
      color: var(--slate);
      font-size: 12px;
      font-weight: 800;
      letter-spacing: 0.12em;
      margin: 0 0 8px;
    }

    .code {
      background:
        linear-gradient(90deg, rgba(255, 94, 36, 0.12) 0 4px, transparent 4px),
        color-mix(in srgb, var(--cloud) 38%, var(--paper));
      border: 1px solid var(--cloud);
      border-radius: 12px;
      color: var(--ink);
      font-family: "SF Mono", "Fira Code", "JetBrains Mono", ui-monospace, monospace;
      font-size: 15px;
      font-weight: 800;
      letter-spacing: 0.08em;
      line-height: 1.8;
      margin: 0 0 24px;
      padding: 18px 20px 18px 26px;
      word-break: break-all;
    }

    .warning {
      background: rgba(255, 94, 36, 0.08);
      border: 1px solid rgba(255, 94, 36, 0.3);
      border-radius: 10px;
      color: var(--slate);
      font-size: 12px;
      font-weight: 700;
      line-height: 1.7;
      margin: 0;
      padding: 14px 16px;
    }

    @media print {
      body { background: var(--paper); padding: 0; }
      .sheet { box-shadow: none; max-width: none; }
    }
  </style>
</head>
<body>
  <main class="sheet">
    <svg class="cloud" viewBox="0 0 96 48" shape-rendering="crispEdges" aria-hidden="true">
      <rect x="16" y="8" width="40" height="8" fill="#ffffff" />
      <rect x="8" y="16" width="64" height="8" fill="#ffffff" />
      <rect x="0" y="24" width="88" height="16" fill="#ffffff" />
      <rect x="16" y="40" width="56" height="8" fill="#ffffff" />
      <rect x="72" y="16" width="8" height="8" fill="#e3f1fe" />
      <rect x="88" y="24" width="8" height="16" fill="#e3f1fe" />
      <rect x="8" y="8" width="8" height="8" fill="#5c6066" opacity="0.42" />
      <rect x="56" y="8" width="8" height="8" fill="#5c6066" opacity="0.42" />
      <rect x="0" y="24" width="8" height="16" fill="#5c6066" opacity="0.42" />
      <rect x="88" y="24" width="8" height="16" fill="#5c6066" opacity="0.42" />
      <rect x="16" y="40" width="56" height="8" fill="#5c6066" opacity="0.42" />
    </svg>
    <span class="eyebrow">离线恢复分片</span>
    <h1>Obscura 恢复码</h1>
    <p class="intro">请将这张纸保存在安全的离线位置。恢复码用于在忘记主密码时恢复密码库，它不会再次完整显示。</p>
    <p class="label">恢复码</p>
    <div class="code">${escapedCode}</div>
    <p class="warning">不要截图、拍照、上传云端或通过消息发送。若同时丢失主密码与恢复码，Obscura 无法替你恢复密码库。</p>
  </main>
</body>
</html>`);
  printWindow.document.close();
  printWindow.print();
}
