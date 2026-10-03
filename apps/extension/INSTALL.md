# Zero Vault 浏览器插件 0.2.0

网页密码库：https://zero-vault-web.pages.dev

## Chrome / Edge

1. 解压 `zero-vault-chromium-0.2.0.zip`，保留目录中的所有文件。
2. Chrome 打开 `chrome://extensions`；Edge 打开 `edge://extensions`。
3. 开启开发者模式，选择“加载已解压的扩展程序”，选择包含 `manifest.json` 的解压目录。
4. 把 Zero Vault 固定到工具栏。允许插件在需要保存或填充的 HTTPS 网站上运行，并刷新安装前已打开的网页，以启用自动保存提示。

从本仓库构建后，也可直接加载 `apps/extension/build/chromium`。

## Firefox（个人测试包）

1. 打开 `about:debugging#/runtime/this-firefox`。
2. 点击“临时载入附加组件”，选择 `zero-vault-firefox-0.2.0.zip`，或解压目录中的 `manifest.json`。
3. 根据浏览器界面允许所需网站权限。将插件固定到工具栏。

Firefox 重启后临时安装失效；长期安装须经 Mozilla 签名。本次交付不含签名或商店发布。默认支持 Chrome/Edge 120+、Firefox 128+；验收使用机器上的实际浏览器版本。

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
