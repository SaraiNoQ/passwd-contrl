"use client";

import { useMemo } from "react";
import { ShieldCheck, ShieldAlert, Edit3, AlertTriangle, CheckCircle2 } from "lucide-react";
import type { VaultItem } from "../../lib/local-vault";
import { isLogin } from "../../lib/item-types";
import { isWeakPassword } from "../../app/vault-provider";
import { getPasswordAge } from "../../lib/password-aging";
import { cn } from "../../lib/utils";
import styles from "./password-health.module.css";

/* ---------------------------------------------------------------------------
   Types
   --------------------------------------------------------------------------- */

export interface PasswordHealthProps {
  items: VaultItem[];
  onEditItem: (item: VaultItem) => void;
  /** Whether a breach check is currently running. */
  breachChecking?: boolean;
  /** Current progress: checked N of total. */
  breachProgress?: { checked: number; total: number };
  /** IDs of credentials whose passwords were found in a breach. */
  breachedIds?: Set<string>;
  /** ID → breach occurrence count. */
  breachCounts?: Map<string, number>;
  /** Callback to start a breach check. */
  onCheckBreach?: () => void;
}

type RiskReason = "weak" | "duplicate" | "old" | "non-https" | "breached";

interface ItemRisk {
  item: VaultItem;
  reasons: RiskReason[];
  riskScore: number;
}

/* ---------------------------------------------------------------------------
   Helpers
   --------------------------------------------------------------------------- */

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

function getRiskScore(reasons: RiskReason[]): number {
  const weights: Record<RiskReason, number> = { weak: 30, duplicate: 25, old: 20, "non-https": 15, breached: 35 };
  return reasons.reduce((sum, r) => sum + (weights[r] ?? 0), 0);
}

function getRiskReasons(
  item: VaultItem,
  duplicatePasswords: Set<string>,
  now: number,
  breachedIds?: Set<string>
): RiskReason[] {
  if (!isLogin(item)) return [];
  const reasons: RiskReason[] = [];
  if (isWeakPassword(item.password)) reasons.push("weak");
  if (duplicatePasswords.has(item.password)) reasons.push("duplicate");
  if (new Date(item.updatedAt).getTime() < now - NINETY_DAYS_MS) reasons.push("old");
  if (!item.origin.startsWith("https://")) reasons.push("non-https");
  if (breachedIds?.has(item.id)) reasons.push("breached");
  return reasons;
}

function getRiskReasonLabel(reason: RiskReason): string {
  switch (reason) {
    case "weak": return "弱密码";
    case "duplicate": return "复用密码";
    case "old": return "陈旧密码";
    case "non-https": return "非 HTTPS";
    case "breached": return "已泄露";
  }
}

function getRiskTagClass(reason: RiskReason): string | undefined {
  switch (reason) {
    case "weak": return styles.riskTagWeak;
    case "duplicate": return styles.riskTagDuplicate;
    case "old": return styles.riskTagOld;
    case "non-https": return styles.riskTagNonHttps;
    case "breached": return styles.riskTagBreached;
  }
}

function riskScoreClass(score: number): string {
  if (score >= 60) return styles.riskScoreHigh ?? "";
  if (score >= 30) return styles.riskScoreMedium ?? "";
  return styles.riskScoreMuted ?? "";
}

/* ---------------------------------------------------------------------------
   Circular Gauge
   --------------------------------------------------------------------------- */

const GAUGE_RADIUS = 54;
const GAUGE_CIRCUMFERENCE = 2 * Math.PI * GAUGE_RADIUS;

function ScoreGauge({ score }: { score: number }) {
  const offset = GAUGE_CIRCUMFERENCE * (1 - score / 100);

  let fillClass: string | undefined;
  let grade: string;
  let gradeClass: string | undefined;
  let summary: string;

  if (score >= 71) {
    fillClass = styles.gaugeFillGreen;
    grade = "优秀";
    gradeClass = styles.scoreGradeGreen;
    summary = "风险列表保持清爽，继续让每个站点拥有独立密码。";
  } else if (score >= 41) {
    fillClass = styles.gaugeFillYellow;
    grade = "一般";
    gradeClass = styles.scoreGradeYellow;
    summary = "列表里有几个密码需要更新，建议尽快处理。";
  } else {
    fillClass = styles.gaugeFillRed;
    grade = "危险";
    gradeClass = styles.scoreGradeRed;
    summary = "风险记录堆积过高，请优先更新高风险密码。";
  }

  return (
    <div className={styles.scoreLayout}>
      <div className={styles.gaugeWrap}>
        <div className={styles.gauge}>
          <svg
            className={styles.gaugeSvg}
            width="140"
            height="140"
            viewBox="0 0 140 140"
          >
            <circle
              className={styles.gaugeTrack}
              cx="70"
              cy="70"
              r={GAUGE_RADIUS}
            />
            <circle
              className={cn(styles.gaugeFill, fillClass)}
              cx="70"
              cy="70"
              r={GAUGE_RADIUS}
              strokeDasharray={GAUGE_CIRCUMFERENCE}
              strokeDashoffset={offset}
            />
          </svg>
          <div className={styles.gaugeCenter}>
            <span className={styles.gaugeScore}>{score}</span>
            <span className={styles.gaugeLabel}>列表评分</span>
          </div>
        </div>
      </div>

      <div className={styles.scoreDetails}>
        <h3>风险列表概览</h3>
        <span className={cn(styles.scoreGrade, gradeClass)}>
          {grade} · {score} 分
        </span>
        <p className={styles.scoreSummary}>{summary}</p>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
   Risk Count Color
   --------------------------------------------------------------------------- */

function countColorClass(count: number, total: number): string | undefined {
  if (total === 0 || count === 0) return styles.riskCardCountGreen;
  const ratio = count / total;
  if (ratio >= 0.5) return styles.riskCardCountRed;
  if (ratio >= 0.2) return styles.riskCardCountYellow;
  return styles.riskCardCountMuted;
}

/* ---------------------------------------------------------------------------
   PasswordHealth
   --------------------------------------------------------------------------- */

export function PasswordHealth({
  items,
  onEditItem,
  breachChecking = false,
  breachProgress,
  breachedIds,
  breachCounts,
  onCheckBreach
}: PasswordHealthProps) {
  const now = useMemo(() => Date.now(), []);
  const effectiveBreachedIds = breachedIds ?? new Set<string>();

  // Compute duplicate password set (passwords used more than once)
  const duplicatePasswords = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of items) {
      if (!isLogin(item)) continue;
      counts.set(item.password, (counts.get(item.password) ?? 0) + 1);
    }
    const dupes = new Set<string>();
    for (const [pw, count] of counts) {
      if (count > 1) dupes.add(pw);
    }
    return dupes;
  }, [items]);

  // Compute risk counts
  const weakCount = useMemo(
    () => items.filter((i) => isLogin(i) && isWeakPassword(i.password)).length,
    [items]
  );

  const duplicateItemCount = useMemo(() => {
    let count = 0;
    for (const item of items) {
      if (isLogin(item) && duplicatePasswords.has(item.password)) count++;
    }
    return count;
  }, [items, duplicatePasswords]);

  const oldCount = useMemo(
    () =>
      items.filter((i) => new Date(i.updatedAt).getTime() < now - NINETY_DAYS_MS).length,
    [items, now]
  );

  const nonHttpsCount = useMemo(
    () => items.filter((i) => isLogin(i) && !i.origin.startsWith("https://")).length,
    [items]
  );

  const breachedCount = effectiveBreachedIds.size;

  // Compute overall security score (0-100)
  const score = useMemo(() => {
    const total = items.length;
    if (total === 0) return 100;

    const weakPenalty = (weakCount / total) * 40;
    const dupPenalty = (duplicateItemCount / total) * 20;
    const oldPenalty = (oldCount / total) * 25;
    const nonHttpsPenalty = (nonHttpsCount / total) * 15;
    const breachPenalty = breachedCount > 0 ? (breachedCount / total) * 30 : 0;
    const httpsBonus = nonHttpsCount === 0 ? 5 : 0;

    return Math.max(0, Math.min(100, Math.round(100 - weakPenalty - dupPenalty - oldPenalty - nonHttpsPenalty - breachPenalty + httpsBonus)));
  }, [items.length, weakCount, duplicateItemCount, oldCount, nonHttpsCount, breachedCount]);

  // Compute top risk items
  const topRisks = useMemo(() => {
    const risks: ItemRisk[] = [];
    for (const item of items) {
      const reasons = getRiskReasons(item, duplicatePasswords, now, breachedIds);
      if (reasons.length > 0) {
        risks.push({ item, reasons, riskScore: getRiskScore(reasons) });
      }
    }
    risks.sort((a, b) => b.riskScore - a.riskScore);
    return risks.slice(0, 10);
  }, [items, duplicatePasswords, now, breachedIds]);

  // Empty vault state
  if (items.length === 0) {
    return (
      <div className={styles.container}>
        <div className={styles.sectionHeader}>
          <div>
            <span className={styles.sectionKicker}>HEALTH</span>
            <h2>风险列表</h2>
          </div>
        </div>
        <div className={styles.emptyState}>
          <div className={styles.emptyPixelVault} aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <div className={styles.emptyStateCopy}>
            <span>密码状态未生成</span>
            <h3>密码库尚未开始使用</h3>
            <p>添加第一条密码后，Obscura 会把强度、重复、过期与 HTTPS 风险写进本地健康列表。</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.sectionHeader}>
        <div>
          <span className={styles.sectionKicker}>HEALTH</span>
          <h2>风险列表</h2>
        </div>
        <span className={styles.vaultCount}>共 {items.length} 枚密码条目</span>
      </div>

      {/* Section 1: Overall Security Score */}
      <ScoreGauge score={score} />

      {/* Breach check card */}
      {onCheckBreach ? (
        <div className={styles.breachCheckCard}>
          <div className={styles.breachCheckInfo}>
            <ShieldAlert size={18} />
            <div>
              <div className={styles.breachCheckTitle}>泄露检查</div>
              <div className={styles.breachCheckDesc}>
                使用 Have I Been Pwned 匿名接口检查密码是否出现在已知泄露记录中。仅发送密码哈希前缀，不会发送完整密码。
              </div>
            </div>
          </div>
          <div className={styles.breachCheckRight}>
            {breachChecking && breachProgress ? (
              <span className={styles.breachCheckProgress}>
                正在扫描 {breachProgress.checked}/{breachProgress.total}...
              </span>
            ) : null}
            <button
              className={styles.breachCheckBtn}
              type="button"
              onClick={onCheckBreach}
              disabled={breachChecking}
            >
              <ShieldAlert size={14} />
              {breachChecking ? "扫描中..." : "扫描泄露"}
            </button>
          </div>
        </div>
      ) : null}

      {/* Breach result banner */}
      {breachedCount > 0 && !breachChecking ? (
        <div className={styles.breachBannerDanger}>
          <AlertTriangle size={16} />
          <span>
            发现 {breachedCount} 个密码已进入泄露记录，请立即更新。
          </span>
        </div>
      ) : breachedIds && breachedCount === 0 && !breachChecking ? (
        <div className={styles.breachBannerSafe}>
          <CheckCircle2 size={16} />
          <span>未在已知泄露记录中发现你的密码。</span>
        </div>
      ) : null}

      {/* Section 2: Risk Breakdown Cards */}
      <div className={styles.riskGrid}>
        <div className={styles.riskCard}>
          <div className={styles.riskCardHeader}>
            <span className={styles.riskCardTitle}>弱密码</span>
          </div>
          <span className={cn(styles.riskCardCount, weakCount > 0 ? styles.riskCardCountRed : styles.riskCardCountGreen)}>
            {weakCount}
          </span>
          <span className={styles.riskCardSuggestion}>
            {weakCount > 0 ? "建议更新为强密码" : "所有密码强度达标"}
          </span>
        </div>

        <div className={styles.riskCard}>
          <div className={styles.riskCardHeader}>
            <span className={styles.riskCardTitle}>复用密码</span>
          </div>
          <span className={cn(styles.riskCardCount, duplicateItemCount > 0 ? styles.riskCardCountYellow : styles.riskCardCountGreen)}>
            {duplicateItemCount}
          </span>
          <span className={styles.riskCardSuggestion}>
            {duplicateItemCount > 0 ? "建议为每个站点生成独立密码" : "没有重复使用的密码"}
          </span>
        </div>

        <div className={styles.riskCard}>
          <div className={styles.riskCardHeader}>
            <span className={styles.riskCardTitle}>陈旧密码</span>
          </div>
          <span className={cn(styles.riskCardCount, countColorClass(oldCount, items.length))}>
            {oldCount}
          </span>
          <span className={styles.riskCardSuggestion}>
            {oldCount > 0 ? "建议定期更新密码" : "所有条目都在近期更新过"}
          </span>
        </div>

        <div className={styles.riskCard}>
          <div className={styles.riskCardHeader}>
            <span className={styles.riskCardTitle}>非 HTTPS</span>
          </div>
          <span className={cn(styles.riskCardCount, nonHttpsCount > 0 ? styles.riskCardCountRed : styles.riskCardCountGreen)}>
            {nonHttpsCount}
          </span>
          <span className={styles.riskCardSuggestion}>
            {nonHttpsCount > 0 ? "建议仅使用 HTTPS 站点" : "所有站点均使用 HTTPS"}
          </span>
        </div>

        {breachedIds !== undefined ? (
          <div className={styles.riskCard}>
            <div className={styles.riskCardHeader}>
              <span className={styles.riskCardTitle}>泄露密码</span>
            </div>
            <span className={cn(styles.riskCardCount, breachedCount > 0 ? styles.riskCardCountRed : styles.riskCardCountGreen)}>
              {breachedCount}
            </span>
            <span className={styles.riskCardSuggestion}>
              {breachedCount > 0 ? "这些密码已进入泄露记录，请立即更新" : "未在已知泄露记录中发现你的密码"}
            </span>
          </div>
        ) : null}
      </div>

      {/* Section 3: Top Risk Items */}
      {topRisks.length > 0 ? (
        <div className={styles.riskLedger}>
          <div className={styles.riskLedgerHeader}>
            <div>
              <span className={styles.sectionKicker}>FIX LIST</span>
              <h3>高风险密码队列</h3>
            </div>
            <span className={styles.vaultCount}>共 {topRisks.length} 项</span>
          </div>
          <div className={styles.riskTable}>
            <div className={styles.riskTableHeader}>
              <span>密码条目</span>
              <span>风险原因</span>
              <span>列表评分</span>
              <span>操作</span>
            </div>
            {topRisks.map((risk) => {
                const ageDays = risk.reasons.includes("old") ? getPasswordAge(risk.item) : null;
                return (
              <div className={styles.riskRow} key={risk.item.id}>
                <div>
                  <span className={styles.mobileCellLabel}>密码条目</span>
                  <div className={styles.riskItemTitle}>{risk.item.title}</div>
                  <div className={styles.riskItemOrigin}>
                    {isLogin(risk.item) ? risk.item.origin : ""}
                    {ageDays !== null ? (
                      <span className={styles.riskItemAge}>已使用 {ageDays} 天</span>
                    ) : null}
                  </div>
                </div>
                <div className={styles.riskItemReasons}>
                  <span className={styles.mobileCellLabel}>风险原因</span>
                  {risk.reasons.map((r) => (
                    <span key={r} className={cn(styles.riskTag, getRiskTagClass(r))}>
                      {getRiskReasonLabel(r)}
                    </span>
                  ))}
                </div>
                <div>
                  <span className={styles.mobileCellLabel}>列表评分</span>
                  <span className={cn(styles.riskScoreBadge, riskScoreClass(risk.riskScore))}>
                    {risk.riskScore}
                  </span>
                </div>
                <div className={styles.riskAction}>
                  <span className={styles.mobileCellLabel}>操作</span>
                  <button
                    className={styles.riskActionBtn}
                    type="button"
                    onClick={() => onEditItem(risk.item)}
                    title="编辑凭据"
                  >
                    <Edit3 size={12} />
                    更换
                  </button>
                </div>
              </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className={styles.emptyState}>
          <div className={styles.emptyPixelSeal} aria-hidden="true">
            <ShieldCheck size={26} />
          </div>
          <div className={styles.emptyStateCopy}>
            <span>风险列表为空</span>
            <h3>没有待修复密码</h3>
            <p>当前密码库未发现弱密码、重复使用、陈旧记录或非 HTTPS 风险。继续保持每个站点一把独立密码。</p>
          </div>
        </div>
      )}
    </div>
  );
}
