# Zero Vault 浏览器插件 0.2.2

网页密码库：https://zero-vault-web.pages.dev

## Chrome / Edge

1. 解压 `zero-vault-chromium-0.2.2.zip`，保留目录中的所有文件。
2. Chrome 打开 `chrome://extensions`；Edge 打开 `edge://extensions`。
3. 开启开发者模式，选择“加载已解压的扩展程序”，选择包含 `manifest.json` 的解压目录。
4. 把 Zero Vault 固定到工具栏。允许插件在需要保存或填充的 HTTPS 网站上运行，并刷新安装前已打开的网页，以启用自动保存提示。

从本仓库构建后，也可直接加载 `apps/extension/build/chromium`。

## Firefox XPI（优先发布）

当前构建目标为 Firefox 142+，Mozilla 检查通过后可进行个人分发签名，不公开上架商店。

在仓库根目录运行：

```sh
pnpm --filter @zero-vault/extension package:firefox
bash apps/extension/scripts/sign-firefox.sh
```

第一条命令生成 `apps/extension/artifacts/zero-vault-firefox-0.2.2-unsigned.xpi`。第二条采用 Node 24.19.0、web-ext 10.6.0 和 `--channel=unlisted`，先构建及严格检查，再隐藏输入 AMO API key/secret。凭据不写入文件、命令参数或仓库，结束时清除脚本内环境变量。已有 `WEB_EXT_API_KEY` / `WEB_EXT_API_SECRET` 环境变量时可直接使用。

AMO 凭据在 [Mozilla 开发者中心](https://addons.mozilla.org/en-US/developers/addon/api/key/) 获取，不要发送到聊天或提交到 Git。成功签名后，XPI 位于 `apps/extension/artifacts/firefox-signed/`，旁边生成 `SHA256SUMS`。签名可能需要等待 Mozilla 的自动或人工审核；未下载签名包不代表签名已经成功。

安装签名版：Firefox 打开 `about:addons`，点击齿轮菜单“从文件安装附加组件”，选择签名 XPI；签名版可保留安装。相关机制见 [Mozilla 签名说明](https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/)。

### 未签名 XPI 的临时测试

1. 打开 `about:debugging#/runtime/this-firefox`。
2. 点击“临时载入附加组件”，选择 `zero-vault-firefox-0.2.2-unsigned.xpi`，或解压目录中的 `manifest.json`。
3. 根据浏览器界面允许所需网站权限。将插件固定到工具栏。

Firefox 重启后临时安装失效。仅将 ZIP 改为 XPI 后缀不会获得 Mozilla 签名。Chrome/Edge 的既有开发版本保留，但当前优先构建和签名 Firefox。

## 连接与使用

1. 打开插件，填写已有账户的邮箱和账户密码，点击“连接账户”。新账户在网页创建。
2. 在已解锁的网页或手机“设备管理”中找到“Zero Vault · 浏览器插件”，核对插件显示的完整指纹，再批准。
3. 回到插件，设置并确认至少 12 位的**插件本地主密码**，点击“已批准，完成连接”。完成前不要重启浏览器。
4. 以后在插件中用本地主密码解锁。网页关闭后仍可生成、保存、填充和同步；闲置五分钟或重启后重新解锁。

“生成密码”支持长度、字符类型、复制与主动填入；生成不自动保存，也不提交表单。HTTPS 登录提交后，同源跳转或表单消失会显示保存提示，由你核对原网站与账号后确认。已有账号显示“更新密码”；相同密码不会重复保存。多条记录需要选择。锁定时先在插件页面解锁再保存。

密码库本地变更先加密保存，联网时自动同步。冲突通过“保留本地”“采用云端”“另存副本”处理。云端会话过期时，锁定后在解锁表单补填账户密码重新登录；账户密码与本地主密码可以不同。

## 当前边界

- 仅保存账号密码，不支持 Passkey。填充只允许精确 HTTPS origin，相似域名无法手动解除阻止。
- 页面提示依据提交后的页面变化，无法证明每个网站登录成功，保存前请自行确认。
- 不识别的表单、跨域 iframe、HTTP 页面不会自动捕获；可复制生成密码并在网页手动管理记录。
- “此网站不再提示”在该安装的本地生效。候选五分钟后、锁定、关闭标签页或重启时清除。
- 手机实际原生联调仍待 campus-server 恢复；Web/插件与 Android 共用现有加密和同步协议。

## 构建与校验

在仓库根目录运行 `pnpm --filter @zero-vault/extension build`，再运行 `pnpm --filter @zero-vault/extension package`。正式打包不使用 localhost API 覆盖。发布目录 `apps/extension/artifacts` 包含两个 ZIP 和 `SHA256SUMS`。
