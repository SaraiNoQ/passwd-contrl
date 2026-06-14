import type { Metadata } from "next";
import { VaultProvider } from "./vault-provider";
import ErrorBoundary from "../components/error-boundary";
import "./tokens.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Obscura — 零知识密码管理",
  description: "本地优先的加密密码管理与自动填充应用"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        {/* Jersey 10 — pixel display font */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Jersey+10&family=Manrope:wght@400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
        {/* Theme init — DESIGN.md defines Obscura as a light Cloud Mist interface. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                document.documentElement.removeAttribute('data-theme');
              })();
            `,
          }}
        />
      </head>
      <body>
        <ErrorBoundary>
          <VaultProvider>{children}</VaultProvider>
        </ErrorBoundary>
      </body>
    </html>
  );
}
