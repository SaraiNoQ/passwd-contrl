"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Check,
  CloudOff,
  Database,
  KeyRound,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { getErrorMessage, loginAccount } from "../../lib/api-client";
import {
  accountEmailsMatch,
  isRecentAccountAuthentication,
  normalizeAccountEmail,
} from "../../lib/account-deletion-flow";
import { handleDeleteAccount } from "../../lib/vault-settings";
import styles from "./account-deletion.module.css";

type AuthenticatedDeletion = {
  email: string;
  csrfToken: string;
  authenticatedAt: number;
};

type Stage = "checking" | "authenticate" | "confirm" | "complete";

const COMPLETION_SESSION_KEY = "zero-vault.account-deletion.confirmed.v1";
const LEGACY_COMPLETION_SESSION_KEYS = ["obscura.account-deletion.confirmed.v1"] as const;

const safeDeletionError = (error: unknown): string => {
  const message = getErrorMessage(error);
  if (message === "发生了未知错误") {
    return "删除请求未获服务器确认，请稍后重试。";
  }
  return message;
};

export function AccountDeletionClient() {
  const [stage, setStage] = useState<Stage>("checking");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmationEmail, setConfirmationEmail] = useState("");
  const [authenticated, setAuthenticated] = useState<AuthenticatedDeletion | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const confirmationMatches = useMemo(
    () => authenticated !== null && accountEmailsMatch(confirmationEmail, authenticated.email),
    [authenticated, confirmationEmail],
  );

  useEffect(() => {
    let completed = false;
    try {
      completed =
        sessionStorage.getItem(COMPLETION_SESSION_KEY) === "true" ||
        LEGACY_COMPLETION_SESSION_KEYS.some((key) => sessionStorage.getItem(key) === "true");
      for (const key of [COMPLETION_SESSION_KEY, ...LEGACY_COMPLETION_SESSION_KEYS]) {
        sessionStorage.removeItem(key);
      }
    } catch {
      // Some privacy modes disable sessionStorage. The deletion flow still
      // works; only the post-reload completion handoff is unavailable.
    }
    setStage(completed ? "complete" : "authenticate");
  }, []);

  const authenticate = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");

    const normalizedEmail = normalizeAccountEmail(email);
    if (!normalizedEmail || !password) {
      setError("请输入账户邮箱和主密码。");
      return;
    }

    setLoading(true);
    try {
      // loginAccount is the Web client's OPAQUE start/finish exchange. A
      // successful exchange creates a new cookie session and CSRF token; no
      // direct-login or server-visible master-password path is used here.
      const session = await loginAccount(normalizedEmail, password);
      if (!accountEmailsMatch(session.user.email, normalizedEmail)) {
        throw new Error("invalid_credentials");
      }

      setAuthenticated({
        email: session.user.email,
        csrfToken: session.csrfToken,
        authenticatedAt: Date.now(),
      });
      setConfirmationEmail("");
      setStage("confirm");
    } catch (authenticationError) {
      setAuthenticated(null);
      setError(safeDeletionError(authenticationError));
    } finally {
      setPassword("");
      setLoading(false);
    }
  }, [email, password]);

  const deleteAuthenticatedAccount = useCallback(async () => {
    setError("");
    if (!authenticated) {
      setStage("authenticate");
      setError("请先使用主密码完成身份验证。");
      return;
    }
    if (!isRecentAccountAuthentication(authenticated.authenticatedAt)) {
      setAuthenticated(null);
      setConfirmationEmail("");
      setStage("authenticate");
      setError("身份验证已超过 5 分钟，请重新登录后删除。");
      return;
    }
    if (!accountEmailsMatch(confirmationEmail, authenticated.email)) {
      setError("确认邮箱与已验证账户不一致。");
      return;
    }

    setLoading(true);
    try {
      await handleDeleteAccount(authenticated.csrfToken);
      // A full reload drops any unlocked vault and authenticated account state
      // still held by the root provider. The one-shot session marker preserves
      // only the success screen and is removed immediately after reload.
      try {
        sessionStorage.setItem(COMPLETION_SESSION_KEY, "true");
        window.location.reload();
        return;
      } catch {
        setAuthenticated(null);
        setConfirmationEmail("");
        setEmail("");
        setStage("complete");
      }
    } catch (deletionError) {
      if (
        deletionError instanceof Error &&
        deletionError.message === "recent_authentication_required"
      ) {
        setAuthenticated(null);
        setConfirmationEmail("");
        setStage("authenticate");
      }
      setError(
        `${safeDeletionError(deletionError)} 服务器未确认删除，本浏览器的本地加密数据仍然保留。`,
      );
    } finally {
      setLoading(false);
    }
  }, [authenticated, confirmationEmail]);

  return (
    <main className={styles.page}>
      <div className={styles.grid} aria-hidden="true" />
      <div className={styles.shell}>
        <header className={styles.topbar}>
          <Link href="/" className={styles.backLink}>
            <ArrowLeft size={18} aria-hidden="true" />
            返回 Zero Vault
          </Link>
          <span className={styles.publicBadge}>PUBLIC ACCOUNT TOOL</span>
        </header>

        <section className={styles.hero}>
          <div className={styles.heroCopy}>
            <p className={styles.eyebrow}>ACCOUNT DELETION / 账户删除</p>
            <h1>清除云端账户，<br />不留下模糊状态。</h1>
            <p>
              这是无需进入密码库即可访问的公开删除入口。删除前必须重新完成
              OPAQUE 身份验证，并再次输入账户邮箱确认。
            </p>
          </div>
          <div className={styles.pixelVault} aria-hidden="true">
            <span className={styles.vaultTop} />
            <span className={styles.vaultDoor}>
              <span className={styles.vaultDial} />
            </span>
            <span className={styles.vaultDelete}><Trash2 size={28} /></span>
          </div>
        </section>

        <div className={styles.contentGrid}>
          <aside className={styles.protocol} aria-label="账户删除流程">
            <p className={styles.panelLabel}>DELETION PROTOCOL</p>
            <ol>
              <li className={
                stage === "authenticate"
                  ? styles.activeStep
                  : stage === "confirm" || stage === "complete"
                    ? styles.finishedStep
                    : ""
              }>
                <span>01</span>
                <div><strong>重新验证身份</strong><small>OPAQUE recent authentication</small></div>
              </li>
              <li className={stage === "confirm" ? styles.activeStep : stage === "complete" ? styles.finishedStep : ""}>
                <span>02</span>
                <div><strong>确认目标邮箱</strong><small>Type the verified email again</small></div>
              </li>
              <li className={stage === "complete" ? styles.activeStep : ""}>
                <span>03</span>
                <div><strong>服务器确认删除</strong><small>Local cleanup follows success only</small></div>
              </li>
            </ol>

            <div className={styles.boundaryNote}>
              <ShieldCheck size={20} aria-hidden="true" />
              <p>
                任何网络、认证或服务器错误都不会触发本地清理。
                <span>Local encrypted data stays intact on failure.</span>
              </p>
            </div>
          </aside>

          <section className={styles.actionPanel} aria-labelledby="deletion-action-title">
            {stage === "checking" ? (
              <div className={styles.checking} role="status">
                正在检查删除状态…
              </div>
            ) : null}

            {stage === "authenticate" ? (
              <>
                <div className={styles.actionHeader}>
                  <span className={styles.actionIcon}><KeyRound size={22} /></span>
                  <div>
                    <p>STEP 01 / RECENT AUTH</p>
                    <h2 id="deletion-action-title">验证账户</h2>
                  </div>
                </div>
                <p className={styles.description}>
                  输入您的账户邮箱和主密码。密码只参与浏览器内的 OPAQUE 协议计算，
                  不会直接发送给服务器。
                </p>
                <form className={styles.form} onSubmit={authenticate} noValidate>
                  <Input
                    id="deletion-email"
                    label="账户邮箱 / Account email"
                    type="text"
                    inputMode="email"
                    autoComplete="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="name@example.com"
                    disabled={loading}
                    required
                  />
                  <Input
                    id="deletion-password"
                    label="主密码 / Master password"
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    disabled={loading}
                    required
                  />
                  <Button type="submit" loading={loading} className={styles.primaryAction ?? ""}>
                    {loading ? "正在验证…" : "验证并继续"}
                  </Button>
                </form>
              </>
            ) : null}

            {stage === "confirm" && authenticated ? (
              <>
                <div className={styles.actionHeader}>
                  <span className={styles.actionIcon}><Trash2 size={22} /></span>
                  <div>
                    <p>STEP 02 / FINAL CHECK</p>
                    <h2 id="deletion-action-title">永久删除账户</h2>
                  </div>
                </div>
                <div className={styles.verifiedAccount}>
                  <Check size={18} aria-hidden="true" />
                  <span>已验证账户</span>
                  <strong>{authenticated.email}</strong>
                </div>
                <div className={styles.impactGrid}>
                  <div><Database size={18} /><span>云端加密密码库与元数据</span></div>
                  <div><CloudOff size={18} /><span>设备、会话与加密备份</span></div>
                </div>
                <p className={styles.description}>
                  此操作不可撤销。请再次输入完整邮箱；仅在服务器返回明确成功后，
                  浏览器才会清除本地 Zero Vault 数据。
                </p>
                <div className={styles.form}>
                  <Input
                    id="deletion-confirm-email"
                    label="再次输入邮箱 / Re-enter account email"
                    type="text"
                    inputMode="email"
                    autoComplete="off"
                    value={confirmationEmail}
                    onChange={(event) => setConfirmationEmail(event.target.value)}
                    placeholder={authenticated.email}
                    disabled={loading}
                  />
                  <div className={styles.confirmActions}>
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setAuthenticated(null);
                        setConfirmationEmail("");
                        setError("");
                        setStage("authenticate");
                      }}
                      disabled={loading}
                    >
                      返回
                    </Button>
                    <Button
                      variant="danger"
                      onClick={() => void deleteAuthenticatedAccount()}
                      loading={loading}
                      disabled={!confirmationMatches}
                    >
                      {loading ? "正在删除…" : "永久删除我的账户"}
                    </Button>
                  </div>
                </div>
              </>
            ) : null}

            {stage === "complete" ? (
              <div className={styles.complete} role="status">
                <span className={styles.completeIcon}><Check size={32} /></span>
                <p>STEP 03 / COMPLETE</p>
                <h2 id="deletion-action-title">账户已删除</h2>
                <p>
                  服务器已确认删除，本浏览器中的 Zero Vault 本地数据也已清除。
                  Your account deletion has been confirmed.
                </p>
                <a href="/" className={styles.homeLink}>返回首页</a>
              </div>
            ) : null}

            {error ? (
              <div className={styles.error} role="alert" aria-live="assertive">
                <strong>操作未完成</strong>
                <span>{error}</span>
              </div>
            ) : null}
          </section>
        </div>
      </div>
    </main>
  );
}
