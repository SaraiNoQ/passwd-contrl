import type { Metadata } from "next";
import { AccountDeletionClient } from "../../components/account-deletion/account-deletion-client";

export const metadata: Metadata = {
  title: "删除账户 — Zero Vault",
  description: "公开的 Zero Vault 账户与关联数据删除入口",
};

export default function AccountDeletionPage() {
  return <AccountDeletionClient />;
}
