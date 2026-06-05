import type { Metadata } from "next";
import { VaultProvider } from "./vault-provider";
import ErrorBoundary from "../components/error-boundary";
import "./tokens.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Obscura — 零知识密码管理",
  description: "基于区块链的零知识密码存储与自动填充应用"
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
        {/* Theme init — prevents flash of wrong theme */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                var theme = localStorage.getItem('obscura-theme');
                if (theme === 'dark' || (!theme && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
                  document.documentElement.setAttribute('data-theme', 'dark');
                }
              })();
            `,
          }}
        />
      </head>
      <body>
        <ErrorBoundary>
          <VaultProvider>{children}</VaultProvider>
        </ErrorBoundary>
        {/* Pixel cloud decorations */}
        <div className="pixel-cloud pixel-cloud--tr" aria-hidden="true" />
        <div className="pixel-cloud pixel-cloud--bl" aria-hidden="true" />
        <div className="pixel-cat" aria-hidden="true" />
      </body>
    </html>
  );
}
