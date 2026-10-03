export const englishCatalog: Readonly<Record<string, string>> = {
  "(tabs)": "Vault",
  "(tabs)/settings": "Settings",
  "(tabs)/vault": "Vault",
  "account": "Account",
  "cloud-backup": "Cloud backup",
  "conflicts": "Sync conflicts",
  "credential": "Credential",
  "credential/[id]": "Credential details",
  "device-approval": "Device approval",
  "devices": "Trusted devices",
  "health": "Password health",
  "index": "Zero Vault",
  "item": "Vault item",
  "item/[id]/edit": "Edit item",
  "item/new": "New item",
  "local-backup": "Local backup",
  "login": "Sign in",
  "password-health": "Password health",
  "recovery": "Account recovery",
  "recovery-code": "Recovery code",
  "register": "Create account",
  "settings": "Settings",
  "sync-status": "Sync status",
  "unlock": "Unlock vault",
  "vault": "Vault",

  "Zero Vault": "Zero Vault",
  "Zero Vault 正在启动": "Zero Vault is starting",
  "正在安全启动…": "Starting securely…",
  "创建 Zero Vault": "Create Zero Vault",
  "零知识密码管理器": "Zero-knowledge password manager",
  "账户": "Account",
  "账户管理": "Account management",
  "账户信息": "Account information",
  "账户邮箱": "Account email",
  "邮箱": "Email",
  "密码": "Password",
  "主密码": "Master password",
  "新主密码": "New master password",
  "再次输入主密码": "Enter the master password again",
  "再次输入新主密码": "Enter the new master password again",
  "输入密码": "Enter password",
  "输入主密码": "Enter master password",
  "输入主密码以解锁本地密码库": "Enter your master password to unlock the local vault",
  "主密码（至少 12 位）": "Master password (at least 12 characters)",
  "至少 12 个字符": "At least 12 characters",
  "主密码至少需要 12 个字符": "The master password must contain at least 12 characters",
  "新主密码至少需要 12 个字符": "The new master password must contain at least 12 characters",
  "两次密码不一致": "The passwords do not match",
  "两次输入的新主密码不一致": "The new passwords do not match",
  "登录": "Sign in",
  "创建账户": "Create account",
  "新增凭据": "New credential",
  "编辑凭据": "Edit credential",
  "创建新账户": "Create a new account",
  "已有账户，返回登录": "Already have an account? Sign in",
  "退出": "Sign out",
  "退出登录": "Sign out",
  "退出当前会话": "Sign out of this session",
  "退出并重新登录": "Sign out and sign in again",
  "确认退出": "Sign out?",
  "退出后需要重新登录": "You will need to sign in again.",
  "退出会撤销本次移动会话，并清除本机保存的会话令牌。":
    "Signing out revokes this mobile session and removes its saved token.",
  "登录会话已失效，请重新登录。": "Your session has expired. Please sign in again.",
  "邮箱、密码或设备认证信息无效": "The email, password, or device credential is invalid",
  "安全验证已过期，请重新开始": "The secure authentication expired. Please start again.",
  "加密操作失败，已安全中止": "The cryptographic operation failed and was stopped safely",
  "输入数据无效，请检查后重试": "The input is invalid. Check it and try again.",
  "安全参数无效，请更新应用后重试": "The security parameters are invalid. Update the app and try again.",
  "密码库已锁定，请重新解锁": "The vault is locked. Unlock it and try again.",
  "恢复验证已过期，请重新开始": "The recovery authentication expired. Please start again.",
  "恢复提交状态尚未确认，请使用新主密码重新登录":
    "The recovery commit is not yet confirmed. Sign in again with the new master password.",
  "首台设备会成为可信设备。主密码和恢复码不会发送到服务器。":
    "Your first device becomes trusted. Your master password and recovery code are never sent to the server.",
  "主密码只在此设备上使用，不会发送到服务器":
    "Your master password is used only on this device and is never sent to the server",
  "主密码只在此设备的原生 OPAQUE 模块中使用":
    "Your master password is used only by the native OPAQUE module on this device",
  "主密码冷启动解锁需要联网；如需离线解锁，请先在联网解锁后于设置中启用强生物识别":
    "Cold-start unlock with your master password requires a network connection. For offline unlock, first unlock online and enable strong biometrics in Settings.",

  "设置": "Settings",
  "语言": "Language",
  "中文": "Chinese",
  "English": "English",
  "语言设置保存失败，请重试。": "Could not save the language setting. Please try again.",
  "关于": "About",
  "安全": "Security",
  "安全与恢复": "Security and recovery",
  "安全可用性": "Security availability",
  "自动锁定": "Auto-lock",
  "自动锁定时间": "Auto-lock delay",
  "分钟": "minutes",
  "强生物识别": "Strong biometrics",
  "立即锁定": "Lock now",
  "设备信任": "Device trust",
  "设备批准": "Device approval",
  "管理可信设备": "Manage trusted devices",
  "处理同步冲突，当前 {count} 条": "Resolve sync conflicts, {count} current",
  "管理可信设备与待批准设备　›": "Manage trusted and pending devices ›",
  "管理账户": "Manage account",
  "账户、安全操作与永久删除　›": "Account, security actions, and permanent deletion ›",
  "密码库恢复": "Vault recovery",
  "使用或轮换离线恢复码　›": "Use or rotate an offline recovery code ›",
  "同步冲突": "Sync conflicts",
  "当前没有冲突　›": "No current conflicts ›",
  "密码健康": "Password health",
  "本机检查缺失、弱密码和重复使用　›": "Check for missing, weak, and reused passwords on this device ›",
  "本地加密备份与导入": "Local encrypted backup and import",
  "导出密文备份或导入 crypto-core 备份　›": "Export an encrypted backup or import a crypto-core backup ›",
  "加密云备份": "Encrypted cloud backup",
  "创建、恢复或删除服务器密文快照　›": "Create, restore, or delete encrypted server snapshots ›",
  "自动填充与凭据": "Autofill and credentials",
  "Android 自动填充": "Android Autofill",
  "启用 Android 自动填充服务": "Enable Android Autofill service",
  "打开系统设置　›": "Open system settings ›",
  "Credential Provider": "Credential Provider",
  "启用 Android Credential Provider": "Enable Android Credential Provider",
  "打开系统选择页　›": "Open system selector ›",
  "需要 Android 14 或更高版本": "Requires Android 14 or later",
  "Credential Provider 需要 Android 14 或更高版本。":
    "Credential Provider requires Android 14 or later.",
  "Zero Vault 已是当前自动填充服务。": "Zero Vault is already the active Autofill service.",
  "Zero Vault 凭据提供方已启用。": "Zero Vault Credential Provider is enabled.",
  "当前设备未提供 Android 自动填充服务。": "This device does not provide Android Autofill.",
  "系统自动填充设置当前不可用。": "System Autofill settings are currently unavailable.",
  "系统凭据提供方设置当前不可用。": "System Credential Provider settings are currently unavailable.",
  "在 Android Keystore 中启用 BIOMETRIC_STRONG 密钥　›":
    "Enable a BIOMETRIC_STRONG key in Android Keystore ›",
  "已启用的设备安全策略不会自动降级为密码解锁":
    "The enabled device security policy never falls back to password unlock",

  "凭据": "Credentials",
  "凭据详情": "Credential details",
  "密码库": "Vault",
  "暂无凭据": "No credentials yet",
  "搜索凭据...": "Search credentials…",
  "同步": "Sync",
  "同步成功": "Sync complete",
  "同步失败": "Sync failed",
  "密码库已与服务器同步。": "Your vault is up to date with the server.",
  "同步未完成，请检查网络后重试。":
    "Sync did not complete. Check your connection and try again.",
  "锁定": "Lock",
  "去解锁": "Unlock",
  "密码库已锁定": "Vault locked",
  "待同步": "Pending sync",
  "项": "items",
  "个冲突": "conflicts",
  "处理": "Resolve",
  "新建密码库条目": "Create vault item",
  "新建条目": "New item",
  "编辑条目": "Edit item",
  "条目不存在或已被删除": "This item does not exist or has been deleted",
  "标题": "Title",
  "文件夹": "Folder",
  "已有文件夹": "Existing folders",
  "点按即可填入": "Tap to use",
  "使用已有文件夹 {folder}": "Use existing folder {folder}",
  "将保存到已有文件夹 {folder}": "Will save to existing folder {folder}",
  "保存后将新建文件夹 {folder}": "Saving will create folder {folder}",
  "可输入新文件夹，或从已有文件夹中选择":
    "Enter a new folder or choose an existing one",
  "输入名称即可创建文件夹": "Enter a name to create a folder",
  "未分类": "Uncategorized",
  "文件夹 {name}，{count} 项": "Folder {name}, {count} items",
  "网站": "Website",
  "选择网站协议": "Choose website protocol",
  "用户名": "Username",
  "登录项": "Login",
  "登录条目": "Login items",
  "安全笔记": "Secure note",
  "信用卡": "Payment card",
  "笔记内容": "Note",
  "备注": "Notes",
  "持卡人": "Cardholder",
  "卡号": "Card number",
  "卡组织": "Card network",
  "月份": "Month",
  "年份": "Year",
  "有效期": "Expiry",
  "名称": "Name",
  "值": "Value",
  "文本": "Text",
  "布尔值": "Boolean",
  "类型：文本　›": "Type: Text ›",
  "类型：隐藏　›": "Type: Hidden ›",
  "类型：布尔值　›": "Type: Boolean ›",
  "自定义字段": "Custom fields",
  "添加自定义字段": "Add custom field",
  "删除字段": "Delete field",
  "密码生成器": "Password generator",
  "大写": "Uppercase",
  "小写": "Lowercase",
  "数字": "Numbers",
  "符号": "Symbols",
  "生成并填入密码": "Generate and fill password",
  "保存并加入同步队列": "Save and queue for sync",
  "Android App 关联": "Android app associations",
  "Android App 关联（高级）": "Android app associations (advanced)",
  "从已安装 App 选择": "Choose from installed apps",
  "选择已安装 App": "Choose an installed app",
  "仅显示具有启动入口且能读取单一当前发布签名的 App。":
    "Only apps with a launcher entry and one readable current signing certificate are shown.",
  "正在读取已安装 App…": "Loading installed apps…",
  "未找到可安全关联的 App": "No apps available for a secure association",
  "已关联": "Already linked",
  "无法读取已安装 App": "Could not load installed apps",
  "Android 未能安全读取可关联应用列表，请稍后重试。":
    "Android could not safely read the list of linkable apps. Try again later.",
  "Android 包名": "Android package name",
  "发布签名证书 SHA-256": "Signing certificate SHA-256",
  "添加 Android App 关联": "Add Android app association",
  "删除 App 关联": "Delete app association",
  "只有包名和发布签名证书 SHA-256 都精确匹配时才允许填充。不要填写调试证书。":
    "Autofill is allowed only when both the package name and signing certificate SHA-256 match exactly. Do not use a debug certificate.",
  "网站必须是没有路径、查询或账号信息的 HTTP(S) origin":
    "The website must be an HTTP or HTTPS origin without a path, query, or user information",
  "删除条目": "Delete item",
  "删除会进入离线同步队列，并在同步后影响其他设备。":
    "Deletion is queued offline and will affect other devices after sync.",
  "取消": "Cancel",
  "删除": "Delete",
  "编辑": "Edit",
  "复制": "Copy",
  "已复制": "Copied",
  "显示": "Show",
  "隐藏": "Hide",
  "修改": "Edit",
  "动态验证码": "One-time password",
  "无效的 TOTP 密钥": "Invalid TOTP secret",
  "暂无历史版本": "No version history",
  "历史版本": "Version history",
  "版本": "Version",
  "版本 {revision}": "Version {revision}",
  "版本 {revision} · {time}": "Version {revision} · {time}",
  "恢复历史版本 {revision}": "Restore version {revision}",
  "版本 {revision} 会作为一次新的修改进入同步队列，当前版本仍保留在云端历史中。":
    "Version {revision} will be queued as a new change; the current version remains in cloud history.",
  "动态验证码（{seconds}s）": "One-time password ({seconds}s)",
  "创建于 {time}": "Created {time}",
  "更新于 {time}": "Updated {time}",
  "已复制{label}，未被替换时将在 30 秒后清除":
    "{label} copied; it will be cleared after 30 seconds unless replaced.",
  "读取历史版本": "Load version history",
  "正在读取…": "Loading…",
  "恢复此版本": "Restore this version",
  "密码已隐藏": "Password hidden",
  "未命名": "Untitled",
  "打开条目 {title}": "Open item {title}",
  "无网站": "No website",
  "无用户名": "No username",
  "未提供": "Not provided",
  "未知": "Unknown",

  "同步状态": "Sync status",
  "待同步 {count} 项": "{count} pending",
  "处理 {count} 个冲突": "Resolve {count} conflicts",
  "处理 {count} 个同步冲突": "Resolve {count} sync conflicts",
  "检测到 {count} 个冲突，点击选择处理方式":
    "{count} conflicts detected. Tap to choose how to resolve them.",
  "上次同步于 {time}": "Last synced {time}",
  "← 返回": "← Back",
  "最近同步时间": "Last synced",
  "从未同步": "Never synced",
  "空闲": "Idle",
  "同步中...": "Syncing…",
  "立即同步": "Sync now",
  "冲突提示": "Conflict warning",
  "前往修改": "Edit",
  "编辑 {title}": "Edit {title}",
  "本机当前没有需要人工仲裁的加密变更。": "No encrypted changes currently require manual resolution.",
  "每条冲突都需要明确选择。应用不会按时间戳静默覆盖本地或云端版本。":
    "Each conflict requires an explicit choice. The app never silently overwrites local or cloud data by timestamp.",
  "没有待处理冲突": "No pending conflicts",
  "本地版本": "Local version",
  "云端版本": "Cloud version",
  "保留本地": "Keep local",
  "保留本地版本": "Keep local version",
  "采用云端": "Use cloud",
  "采用云端版本": "Use cloud version",
  "两者保留": "Keep both",
  "将本地版本另存为副本": "Save the local version as a copy",
  "暂缓此冲突": "Resolve later",
  "写入决议": "Apply resolution",
  "本次不改写任何版本；该冲突会在下一次同步重试时再次出现。":
    "No version will change now; this conflict will reappear on the next sync.",
  "本地内容将作为新的加密变更覆盖当前云端版本。":
    "Local content will be encrypted as a new change and replace the cloud version.",
  "未同步的本地变更会被丢弃，并采用服务器当前状态。":
    "Unsynced local changes will be discarded and the server state will be used.",
  "云端版本保持为原条目，本地版本会使用新 ID 加密保存为副本。":
    "The cloud version stays on the original item and the local version is encrypted as a copy with a new ID.",
  "条目 ID：{id}": "Item ID: {id}",
  "本地基线：v{revision}": "Local baseline: v{revision}",
  "服务器：v{revision}": "Server: v{revision}",
  "确认{resolution}？": "Confirm: {resolution}?",
  "自定义字段：{count} 项（值不在预览中显示）":
    "{count} custom fields (values hidden in preview)",

  "可信设备": "Trusted devices",
  "当前设备": "Current device",
  "等待批准": "Pending approval",
  "已信任": "Trusted",
  "已拒绝": "Rejected",
  "已撤销": "Revoked",
  "设备 ID：": "Device ID: ",
  "本机设备指纹：": "Device fingerprint:",
  "指纹：": "Fingerprint:",
  "注册时间：": "Registered: ",
  "最近活动：": "Last active: ",
  "最近位置：": "Last location: ",
  "等待设备批准": "Waiting for device approval",
  "请在一台已受信任设备中核对指纹并批准此设备。批准前，本机不能读取密码库或恢复包。":
    "Verify the fingerprint and approve this device from a trusted device. This device cannot access the vault or recovery packet until approved.",
  "刷新状态": "Refresh status",
  "使用恢复码恢复": "Recover with a recovery code",
  "销毁本机身份并重新绑定": "Destroy this device identity and bind again",
  "通过另一台可信设备重新绑定": "Bind again through another trusted device",
  "核对并批准": "Verify and approve",
  "批准并共享密钥": "Approve and share key",
  "拒绝": "Reject",
  "撤销此设备": "Revoke this device",
  "当前设备不能在此页自我撤销；请先退出，再由另一台可信设备撤销。":
    "The current device cannot revoke itself here. Sign out first, then revoke it from another trusted device.",
  "没有可显示的设备。下拉刷新后仍为空时，请停止操作并检查会话。":
    "No devices to display. If refreshing still shows none, stop and check the session.",
  "只有已批准且会话有效的设备可以管理信任关系。":
    "Only approved devices with a valid session can manage trust.",
  "批准新设备？": "Approve new device?",
  "拒绝此设备？": "Reject this device?",
  "撤销可信设备？": "Revoke trusted device?",
  "确认拒绝": "Reject",
  "确认撤销": "Revoke",
  "本机设备指纹：{fingerprint}": "Device fingerprint: {fingerprint}",
  "设备 ID：{id}": "Device ID: {id}",
  "设备 {name}": "Device {name}",
  "批准设备 {name}": "Approve device {name}",
  "拒绝设备 {name}": "Reject device {name}",
  "撤销设备 {name}": "Revoke device {name}",
  "仅在另一台设备上核对过以下指纹后继续：\n\n{fingerprint}\n\n批准后会为该设备加密分发密码库密钥。":
    "Continue only after verifying this fingerprint on another device:\n\n{fingerprint}\n\nApproval encrypts and distributes the vault key to this device.",
  "“{name}”将无法获取密码库密钥。此操作不能在本页撤销。":
    "“{name}” will not receive the vault key. This cannot be undone on this screen.",
  "“{name}”的移动会话和后续同步权限将被撤销。已离线的数据不会被远程擦除。":
    "The mobile session and future sync access for “{name}” will be revoked. Offline data cannot be erased remotely.",

  "解锁": "Unlock",
  "解锁密码库": "Unlock vault",
  "正在读取 Keystore 与设备策略…": "Reading Keystore and device policy…",
  "正在验证本机安全状态": "Checking device security",
  "正在验证本机解锁策略，暂不允许继续。": "Checking the device unlock policy. Please wait.",
  "使用主密码继续": "Continue with master password",
  "使用强生物识别继续": "Continue with strong biometrics",
  "使用强生物识别解锁": "Unlock with strong biometrics",
  "重新检测": "Check again",
  "重新检测安全模块": "Check security module again",
  "本机安全模块不可用": "Device security module unavailable",
  "本机安全密钥已失效，需要安全恢复": "The device security key is invalid and secure recovery is required",
  "强生物识别当前不可用": "Strong biometrics are currently unavailable",
  "此设备要求使用强生物识别": "This device requires strong biometrics",
  "以后可使用系统生物识别解锁。生物信息变化会使本机密钥失效，不会降级为普通密钥。":
    "You can unlock with system biometrics. Biometric changes invalidate the device key; the app never falls back to a weaker key.",
  "主密码授权或设备解锁失败，密码库仍保持锁定。":
    "Master-password authorization or device unlock failed. The vault remains locked.",
  "强生物识别未完成，密码库仍保持锁定。": "Biometric verification was not completed. The vault remains locked.",
  "强生物识别当前不可用。为防止绕过设备策略，主密码解锁已禁用。":
    "Strong biometrics are unavailable. Master-password unlock is disabled to prevent bypassing device policy.",
  "生物识别密钥已失效。为防止降级攻击，主密码解锁仍保持禁用。":
    "The biometric key is invalid. Master-password unlock remains disabled to prevent a downgrade attack.",

  "恢复码": "Recovery code",
  "账户恢复码": "Account recovery code",
  "离线恢复码": "Offline recovery code",
  "使用离线恢复码": "Use offline recovery code",
  "使用恢复码恢复账户": "Recover account with a recovery code",
  "使用恢复码重置主密码": "Reset master password with a recovery code",
  "恢复账户邮箱": "Recovery account email",
  "输入离线保存的恢复码": "Enter the offline recovery code",
  "轮换恢复码": "Rotate recovery code",
  "恢复或轮换恢复码": "Recover or rotate a recovery code",
  "只显示一次": "Shown once",
  "只显示一次的恢复码": "One-time recovery code",
  "请现在抄写到纸上并离线保存。不要截图、不要粘贴到聊天或云笔记。应用进入后台后会立即清除此码。":
    "Write this code on paper and store it offline now. Do not paste it into chat or cloud notes. The app clears it when moved to the background.",
  "我已抄写，继续确认": "I wrote it down — continue",
  "确认已经离线保存？确认后原生安全存储会永久删除这份待确认恢复码，应用无法再次显示。":
    "Have you saved it offline? After confirmation, secure storage permanently deletes this pending code and the app cannot show it again.",
  "确认已离线保存": "Confirm offline storage",
  "返回检查": "Go back and check",
  "我已离线保存": "I saved it offline",
  "恢复码已从屏幕清除": "Recovery code cleared from the screen",
  "为防止后台泄露，恢复码不会在当前会话中再次显示。请重新输入主密码登录；尚未确认的恢复码会从原生安全存储中重新显示。":
    "To prevent background exposure, this recovery code will not appear again in this session. Sign in again with your master password; an unconfirmed code will be restored from secure storage.",
  "轮换成功后旧恢复码立即失效。新恢复码只显示到你确认保存或应用进入后台。":
    "After rotation, the old code becomes invalid immediately. The new code is shown only until you confirm storage or the app enters the background.",
  "轮换需要有效会话、已批准设备和已解锁的密码库。":
    "Rotation requires a valid session, an approved device, and an unlocked vault.",
  "生成新恢复码并使旧码失效": "Generate a new code and invalidate the old one",
  "确认生成新恢复码？服务器接受新恢复包后，旧恢复码会立即失效。":
    "Generate a new recovery code? The old code becomes invalid as soon as the server accepts the new recovery packet.",
  "确认轮换": "Rotate",
  "恢复": "Recover",
  "继续恢复": "Continue recovery",
  "确认恢复": "Confirm recovery",
  "恢复会替换本机现有的密码库密钥材料。服务器不会收到恢复码明文。":
    "Recovery replaces the vault key material on this device. The server never receives the plaintext recovery code.",
  "主密码重置只通过恢复 v2 完成；成功后旧会话、旧设备和旧恢复码都会失效。":
    "Master-password reset uses recovery v2. On success, old sessions, devices, and recovery codes become invalid.",

  "本地加密备份": "Local encrypted backup",
  "导出 Android 密文快照": "Export Android encrypted snapshot",
  "恢复 Android 密文快照": "Restore Android encrypted snapshot",
  "导入 Web crypto-core 备份": "Import Web crypto-core backup",
  "选择恢复文件": "Choose recovery file",
  "选择 Web 加密备份": "Choose Web encrypted backup",
  "Web 备份独立密码": "Separate Web backup password",
  "Web 加密备份密码": "Web encrypted backup password",
  "Zero Vault 主密码": "Zero Vault master password",
  "导出加密文件": "Export encrypted file",
  "恢复加密备份": "Restore encrypted backup",
  "确认恢复本地备份？": "Restore local backup?",
  "确认替换并恢复": "Replace and restore",
  "包含条目密文、离线变更和同步游标，不导出任何明文 CSV。":
    "Includes encrypted items, offline changes, and the sync cursor. No plaintext CSV is exported.",
  "文件只公开格式、账户标识、备份 ID 和创建时间；Room 快照由密码库密钥认证加密。恢复时必须使用同一账户的密钥。":
    "The file exposes only its format, account identifier, backup ID, and creation time. The Room snapshot is authenticated with the vault key and must be restored under the same account.",
  "选择文件后应用会保持锁定，并要求使用主密码或强生物识别重新授权。":
    "After choosing a file, the app stays locked and asks for master-password or biometric authorization.",
  "取消待处理操作": "Cancel pending operation",
  "重新授权后继续": "Continue after authorization",
  "旧 webcrypto-mvp 备份不受支持，请先在 Web 端迁移。":
    "Legacy webcrypto-mvp backups are not supported. Migrate them in the Web app first.",
  "导出完成": "Export complete",
  "导入完成": "Import complete",

  "创建加密快照": "Create encrypted snapshot",
  "创建和恢复前必须先解锁密码库。": "Unlock the vault before creating or restoring a backup.",
  "请先处理同步冲突，再创建一致性快照。": "Resolve sync conflicts before creating a consistent snapshot.",
  "暂无兼容的移动端云备份。": "No compatible mobile cloud backups.",
  "快照由 Android 原生层直接从 Room 生成，只包含版本化密文封装、密文待同步队列和同步游标；服务器不会解析内容。":
    "The Android native layer creates the snapshot directly from Room. It contains only versioned encrypted envelopes, the encrypted pending queue, and the sync cursor; the server never parses it.",
  "删除云端备份": "Delete cloud backup",
  "此操作只删除服务器上的加密快照，无法撤销。":
    "This permanently deletes only the encrypted snapshot stored on the server.",

  "分析仅在本机解锁内存中执行，不会上传或保存密码及其哈希。":
    "Analysis runs only in unlocked memory on this device. Passwords and their hashes are never uploaded or saved.",
  "密码库已锁定，健康分析不可用": "Unlock the vault to run password health analysis",
  "缺失": "Missing",
  "缺失密码": "Missing password",
  "弱密码": "Weak",
  "复用": "Reused",
  "重复使用": "Reused password",
  "未发现缺失、弱密码或重复使用风险": "No missing, weak, or reused passwords found",
  "前往修改　›": "Edit ›",
  "查看密码健康": "View password health",

  "确定": "OK",
  "确认": "Confirm",
  "稍后处理": "Later",
  "处理中…": "Working…",
  "操作已取消。": "Operation cancelled.",
  "已启用": "Enabled",
  "未能启用": "Could not enable",
  "系统不支持": "Not supported",
  "请先解锁": "Unlock first",
  "先启用强生物识别": "Enable strong biometrics first",
  "无法打开设置": "Could not open settings",
  "网络连接失败，请稍后重试。": "Network connection failed. Try again later.",
  "保存失败": "Save failed",
  "无法保存": "Could not save",
  "删除失败": "Delete failed",
  "恢复失败": "Recovery failed",
  "未能保存": "Could not save",
  "条目内容无效": "Invalid item content",
  "凭据未找到": "Credential not found",
  "未找到匹配的凭据": "No matching credentials",
  "时间未知": "Unknown time",
  "· 更新于": "· Updated",
  "· 移动端认证密文快照 v2": "· Mobile authenticated encrypted snapshot v2",
  "安全预览不会显示密码、CVV、TOTP、笔记正文或任何自定义字段值。":
    "The secure preview never shows passwords, CVVs, TOTP values, note bodies, or custom-field values.",
  "本地基线：v": "Local baseline: v",
  "本机安全模块不可用。请取消操作并重启应用，当前不会执行恢复或导入。":
    "Device security is unavailable. Cancel and restart the app; recovery or import will not run.",
  "本机安全模块当前不可用。密码、恢复和设备重绑定均已暂停，以免破坏仍受保护的本机材料。":
    "Device security is unavailable. Password, recovery, and device binding operations are paused to protect secured device material.",
  "本机检查缺失、弱密码和重复使用 ›": "Check for missing, weak, and reused passwords on this device ›",
  "本机安全扫描": "On-device security scan",
  "本机设备身份缺失或校验失败。请取消操作并从解锁页执行安全恢复或重新绑定。":
    "The device identity is missing or invalid. Cancel and start secure recovery or device binding from the unlock screen.",
  "持卡人：": "Cardholder: ",
  "创建、恢复或删除服务器密文快照 ›": "Create, restore, or delete encrypted server snapshots ›",
  "创建:": "Created: ",
  "导出密文备份或导入 crypto-core 备份 ›": "Export an encrypted backup or import a crypto-core backup ›",
  "动态验证码（": "One-time password (",
  "服务器：v": "Server: v",
  "服务器修订号": "Server revision",
  "复制恢复码": "Copy recovery code",
  "个冲突，点击选择处理方式": "conflicts — tap to choose a resolution",
  "更新:": "Updated: ",
  "管理本地加密备份与导入": "Manage local encrypted backup and import",
  "管理加密云备份": "Manage encrypted cloud backups",
  "管理可信设备与待批准设备 ›": "Manage trusted and pending devices ›",
  "恢复码只在本页内存中短暂使用；离开应用或进入后台会立即清空输入和新恢复码。":
    "Recovery codes are held briefly in this screen's memory. Leaving the app or entering the background clears both the input and new code.",
  "检测到": "Detected ",
  "仅使用 Android Keystore 与强生物识别；不可用时不会返回候选项或明文凭据。":
    "Uses only Android Keystore and strong biometrics. No suggestions or plaintext credentials are returned when unavailable.",
  "卡号末四位：": "Last four digits: ",
  "卡组织：": "Card network: ",
  "类型：": "Type: ",
  "批准前请在另一条可信信道核对完整指纹。撤销设备不会远程删除其离线副本。":
    "Verify the full fingerprint over another trusted channel before approval. Revocation does not remotely erase an offline copy.",
  "前往修改 ›": "Edit ›",
  "打开系统设置 ›": "Open system settings ›",
  "打开系统选择页 ›": "Open system selector ›",
  "当前没有冲突 ›": "No current conflicts ›",
  "请抄写到纸上并离线保存，不要截图或粘贴到云笔记。":
    "Write it on paper and store it offline. Do not paste it into cloud notes.",
  "请先解决同步冲突，以免导出不一致快照。":
    "Resolve sync conflicts before exporting to avoid an inconsistent snapshot.",
  "请先解锁密码库再执行备份操作。": "Unlock the vault before using backup actions.",
  "请现在抄写到纸上并离线保存。如需复制，请勿粘贴到聊天或云笔记。应用进入后台后会立即清除此码。":
    "Write this code on paper and store it offline now. If you copy it, do not paste it into chat or cloud notes. The app clears it when moved to the background.",
  "确认重置主密码并重建设备信任？成功后所有旧会话、旧设备和旧恢复码都会失效。恢复码错误时操作会安全失败。":
    "Reset the master password and rebuild device trust? On success, all old sessions, devices, and recovery codes become invalid. An incorrect recovery code fails safely.",
  "上次同步:": "Last synced: ",
  "生物识别不可用或已失效。请取消操作并从解锁页使用恢复码或可信设备重新绑定。":
    "Biometrics are unavailable or invalid. Cancel and use a recovery code or trusted device from the unlock screen.",
  "使用或轮换离线恢复码 ›": "Use or rotate an offline recovery code ›",
  "输入完整账户邮箱后才能继续。删除失败时不会清除本机密码库。":
    "Enter the full account email to continue. A failed deletion never clears the local vault.",
  "输入账户邮箱确认删除": "Enter the account email to confirm deletion",
  "条目 ID：": "Item ID: ",
  "同步完成后才能执行备份操作。": "Wait for sync to finish before using backup actions.",
  "网站：": "Website: ",
  "文件夹：": "Folder: ",
  "无法读取本机设备指纹，请勿批准此设备。":
    "The device fingerprint could not be read. Do not approve this device.",
  "先选择文件，返回并重新授权后再输入备份独立密码。旧 webcrypto-mvp 备份必须先在 Web 端迁移。":
    "Choose a file first, return and authorize again, then enter the separate backup password. Legacy webcrypto-mvp backups must be migrated in the Web app.",
  "项（值不在预览中显示）": "items (values hidden in preview)",
  "永久删除账户": "Permanently delete account",
  "用户名：": "Username: ",
  "邮箱是 OPAQUE 账户标识，当前协议不允许原地修改。需要更换邮箱时，请先在 Web 端生成可移植的 crypto-core 加密备份，在新账户导入并核对后再删除旧账户。":
    "Email is the OPAQUE account identifier and cannot be changed in place. To change it, create a portable crypto-core encrypted backup in the Web app, import and verify it in a new account, then delete the old account.",
  "在 Android Keystore 中启用 BIOMETRIC_STRONG 密钥 ›":
    "Enable a BIOMETRIC_STRONG key in Android Keystore ›",
  "账户、安全操作与永久删除 ›": "Account, security actions, and permanent deletion ›",
  "自定义字段：": "Custom fields: ",
  "TOTP 密钥或 otpauth URI": "TOTP secret or otpauth URI",
  "外观": "Appearance",
  "浅色": "Light",
  "浅色主题": "Light theme",
  "深色": "Dark",
  "深色主题": "Dark theme",
  "跟随系统": "Use system setting",
  "跟随系统主题": "Use system theme",
  "主题设置保存失败，请重试。": "Could not save the theme setting. Try again.",
  "· 当前设备": "· Current device",
  "备份加密格式不受支持或文件已损坏。": "The backup encryption format is unsupported or the file is damaged.",
  "备份认证失败，请检查备份密码、账户和文件完整性。":
    "Backup authentication failed. Check the backup password, account, and file integrity.",
  "备份认证失败，文件可能已被修改或不属于当前密码库。":
    "Backup authentication failed. The file may have been modified or belong to another vault.",
  "备份文件格式无效、为空或超过允许大小。":
    "The backup file is invalid, empty, or exceeds the size limit.",
  "备份文件为空或超过允许大小。": "The backup file is empty or exceeds the size limit.",
  "本地删除将覆盖云端版本；云端条目内容会被删除。":
    "The local deletion will replace the cloud version and delete its item content.",
  "本机 Room 密文库和待同步队列将被此快照原子替换，完成后密码库会立即锁定。是否继续？":
    "This snapshot will atomically replace the local Room encrypted vault and pending queue, then lock the vault. Continue?",
  "本机安全策略已变化，请返回解锁页重新验证或执行恢复。":
    "The device security policy changed. Return to unlock and verify again or start recovery.",
  "本机设备密钥已失效。主密码不能替代设备身份，请执行安全恢复或重新绑定。":
    "The device key is invalid. A master password cannot replace device identity; use secure recovery or bind again.",
  "本机设备身份缺失或校验失败。请使用恢复码或销毁旧身份后重新绑定。":
    "The device identity is missing or invalid. Use a recovery code or destroy the old identity and bind again.",
  "变更标识重复": "Duplicate change identifier",
  "不存在（该版本没有密文记录）": "Not present (this version has no encrypted record)",
  "冲突处理失败。系统没有静默覆盖任何版本，请重新同步后再试。":
    "Conflict resolution failed. No version was silently overwritten; sync and try again.",
  "此 Android 备份属于另一个账户，已拒绝恢复。":
    "This Android backup belongs to another account and was rejected.",
  "此操作会原子替换本机 Room 密文库、离线队列和同步游标，完成后立即锁定。":
    "This atomically replaces the local Room encrypted vault, offline queue, and sync cursor, then locks the vault.",
  "存在未解决的同步冲突，未创建备份。":
    "A backup was not created because sync conflicts remain unresolved.",
  "当前会话和本机设备身份将被销毁。重新登录后，需要在另一台可信设备上核对新指纹。":
    "This session and device identity will be destroyed. After signing in again, verify the new fingerprint on another trusted device.",
  "当前设备身份和本机会话将被销毁。重新登录后，需要在另一台可信设备上核对新指纹并批准。":
    "This device identity and session will be destroyed. After signing in again, verify and approve its new fingerprint from another trusted device.",
  "服务器密码库、设备信任、会话和恢复材料将被永久删除。本机密文与 Keystore 密钥也会清除，此操作无法撤销。":
    "The server vault, device trust, sessions, and recovery material will be permanently deleted. Local ciphertext and Keystore keys will also be cleared. This cannot be undone.",
  "复制失败，请重试": "Copy failed. Try again.",
  "该快照不是兼容的移动端密文格式，已拒绝恢复。":
    "This snapshot is not a compatible mobile encrypted format and was rejected.",
  "该设备没有可核对的指纹，已阻止批准。":
    "Approval was blocked because this device has no verifiable fingerprint.",
  "恢复历史版本": "Restore version history",
  "恢复码轮换状态无法确认。请重试；应用会复用本机已保护的待确认材料。":
    "Recovery-code rotation could not be confirmed. Try again; the app will reuse the protected pending material on this device.",
  "恢复失败。邮箱、恢复码或加密恢复材料无效；请不要删除本机待确认材料。":
    "Recovery failed because the email, recovery code, or encrypted recovery material is invalid. Do not delete pending device material.",
  "恢复失败。邮箱、恢复码或加密恢复材料无效；请使用新主密码尝试普通登录以确认状态。":
    "Recovery failed because the email, recovery code, or encrypted recovery material is invalid. Try a normal sign-in with the new master password to verify the state.",
  "加密备份操作失败，未修改密码库。请检查文件格式、账户和备份密码。":
    "The encrypted backup operation failed without changing the vault. Check the file format, account, and backup password.",
  "加密备份写入失败，未报告导出成功。请重新选择保存位置。":
    "The encrypted backup could not be written. Choose another save location.",
  "加密备份已写入你选择的文件。": "The encrypted backup was written to the selected file.",
  "历史版本读取失败，请确认密码库仍处于解锁状态":
    "Could not load version history. Make sure the vault is still unlocked.",
  "历史版本未写入本机，当前条目保持不变。":
    "The historical version was not written locally and the current item is unchanged.",
  "历史版本已写入本机并进入同步队列":
    "The historical version was written locally and queued for sync",
  "另一项恢复操作仍在进行，请稍后重试。": "Another recovery is in progress. Try again later.",
  "另一项文件保存操作仍在进行，请先完成或取消。":
    "Another file save is in progress. Finish or cancel it first.",
  "密码库已锁定，请重新解锁后再执行备份操作。":
    "The vault is locked. Unlock it before using backup actions.",
  "密文缺失，无法安全预览": "Encrypted content is missing and cannot be previewed safely",
  "密文元数据无效，无法安全预览": "Encrypted metadata is invalid and cannot be previewed safely",
  "启用生物识别前需要先解锁密码库。": "Unlock the vault before enabling biometrics.",
  "请输入 Web crypto-core 加密备份的独立密码。":
    "Enter the separate password for the Web crypto-core encrypted backup.",
  "请输入 Zero Vault 主密码重新授权。": "Enter the Zero Vault master password to authorize again.",
  "请先解锁密码库。冲突决议需要读取本地密文并生成新的加密变更。":
    "Unlock the vault first. Conflict resolution must read local ciphertext and create a new encrypted change.",
  "请先解锁密码库。批准设备需要在本机加密分发密码库密钥。":
    "Unlock the vault first. Device approval encrypts and distributes the vault key on this device.",
  "请先解锁密码库并启用严格强生物识别，再启用凭据提供方。":
    "Unlock the vault and enable strict strong biometrics before enabling Credential Provider.",
  "请先解锁密码库并启用严格强生物识别。系统服务不会降级使用设备密码。":
    "Unlock the vault and enable strict strong biometrics first. System services never fall back to the device PIN.",
  "请重启应用或重新安装同签名 APK；不要清除应用数据":
    "Restart the app or reinstall an APK with the same signature; do not clear app data",
  "设备操作未完成。密码库和设备信任状态均未自动降级，请重试。":
    "The device operation did not finish. Vault and trust state were not downgraded; try again.",
  "设备列表刷新失败，请检查网络后重试。": "Could not refresh devices. Check the network and try again.",
  "所有者校验失败": "Owner verification failed",
  "条目版本不一致": "Item version mismatch",
  "条目仍保留在本机，未写入删除队列。请重试。":
    "The item remains on this device and was not queued for deletion. Try again.",
  "条目未能写入本机加密存储，未执行静默降级。请保持此页并重试。":
    "The item could not be written to encrypted local storage. No unsafe fallback ran; keep this screen open and try again.",
  "同步基线已变化": "Sync baseline changed",
  "网络连接失败，无法读取云端历史版本": "Network connection failed; cloud version history is unavailable",
  "未提供指纹，禁止批准": "No fingerprint provided; approval blocked",
  "无法解密；密钥可能不匹配或密文已损坏":
    "Could not decrypt; the key may not match or the encrypted content may be damaged",
  "系统当前无法打开文件保存面板。": "The system file save panel is currently unavailable.",
  "系统认证未完成，当前密钥策略未改变。":
    "System authentication was not completed. The current key policy is unchanged.",
  "销毁并重新绑定": "Destroy and bind again",
  "新恢复码已从本机待确认存储中删除。":
    "The new recovery code was deleted from pending secure storage on this device.",
  "选择自动锁定时间（分钟）": "Choose auto-lock delay (minutes)",
  "已复制到剪贴板": "Copied to clipboard",
  "已复制恢复码": "Recovery code copied",
  "已恢复": "Restored",
  "已删除": "Deleted",
  "已选择 Android 密文快照。重新解锁后将原子替换本机 Room 密文库、离线队列和同步游标，完成后立即锁定。":
    "Android encrypted snapshot selected. After authorization it atomically replaces the local Room vault, offline queue, and sync cursor, then locks the vault.",
  "已选择 Web crypto-core 加密备份。重新解锁后才会在原生层解密并导入。":
    "Web crypto-core encrypted backup selected. It will be decrypted and imported natively only after authorization.",
  "已安全导入 {count} 个条目；它们已进入离线同步队列。":
    "{count} items were imported securely and queued for offline sync.",
  "移动端认证密文快照 v2": "Mobile authenticated encrypted snapshot v2",
  "永久删除": "Delete permanently",
  "永久删除账户？": "Permanently delete account?",
  "云备份操作失败，未执行不安全降级。":
    "Cloud backup failed and no unsafe fallback was used.",
  "云端密文快照无效，未修改本机数据。":
    "The cloud encrypted snapshot is invalid. Local data was not changed.",
  "云端条目已更新": "The cloud item has changed",
  "只有会话有效的可信设备可以处理同步冲突。":
    "Only trusted devices with a valid session can resolve sync conflicts.",
  "重新绑定此设备？": "Bind this device again?",
  "重新创建设备身份？": "Create a new device identity?",
  "自动锁定设置未能安全保存，已使用 5 分钟默认值。":
    "Auto-lock could not be saved securely. The 5-minute default is being used.",
  "已解锁，可安全填充": "Unlocked and ready for secure autofill",
  "已锁定，填充时验证生物识别": "Locked; verify biometrics when filling",
  "尚未完成安全配置": "Security setup incomplete",
  "系统凭据提供方": "Credential Provider",
  "启用 Android 系统凭据提供方": "Enable Android Credential Provider",
  "系统凭据提供方需要 Android 14 或更高版本。":
    "Credential Provider requires Android 14 or later.",
  "在 Android 密钥库中启用强生物识别密钥 ›":
    "Enable a strong biometric key in Android Keystore ›",
  "导出密文备份或导入跨平台加密备份 ›":
    "Export an encrypted backup or import a cross-platform encrypted backup ›",
  "仅使用 Android 密钥库与强生物识别；不可用时不会返回候选项或明文凭据。":
    "Uses only Android Keystore and strong biometrics. No suggestions or plaintext credentials are returned when unavailable.",
  "发生了未知错误": "An unknown error occurred",
  "该邮箱未注册": "No account exists for this email",
  "邮箱或密码不正确": "Incorrect email or password",
  "登录会话已过期，请重新开始": "The sign-in session expired. Please start again.",
  "注册会话已过期，请重新开始": "The registration session expired. Please start again.",
  "注册请求无效，请检查邮箱格式后重试":
    "The registration request is invalid. Check the email address and try again.",
  "注册数据无法被服务器接受，请更新应用后重试":
    "The server could not accept the registration data. Update the app and try again.",
  "该邮箱已注册": "An account already exists for this email",
  "网络连接失败，请检查网络": "Could not connect. Check your network connection.",
  "请求超时，请检查网络连接": "The request timed out. Check your network connection.",
  "服务器尚未部署移动端注册接口":
    "The server does not have the mobile registration endpoint yet.",
  "服务器注册失败，请稍后重试": "Registration failed on the server. Try again later.",
  "服务器安全登录服务暂不可用，请稍后重试":
    "Secure sign-in is temporarily unavailable on the server. Try again later.",
  "账户已在服务器创建，但本机初始化未完成。请返回登录页，使用刚才的邮箱和主密码登录以继续绑定本机":
    "The account was created, but setup on this device did not finish. Return to sign in and use the same email and master password to finish binding this device.",
  "无法确认账户是否已在服务器创建。请先返回登录页使用刚才的邮箱和主密码登录；仅在确认邮箱未注册后再重新创建":
    "The app could not confirm whether the account was created. Try signing in with the same email and master password first; create the account again only if the email is confirmed as unregistered.",
  "操作已取消": "Operation cancelled",
  "请重新登录": "Please sign in again",
  "权限不足": "You do not have permission to do this",
  "安全登录模块尚未安装，禁止使用不安全登录":
    "The secure sign-in module is not installed. Insecure sign-in is blocked.",
  "安全登录模块不可用，禁止继续":
    "The secure sign-in module is unavailable. The operation was stopped.",
  "原生安全登录尚未通过兼容性验证，禁止继续":
    "Native secure sign-in has not passed compatibility verification. The operation was stopped.",
  "服务器版本过旧，尚未部署移动端注册服务":
    "The server is too old and does not support mobile registration.",
  "此设备正在等待可信设备批准":
    "This device is waiting for approval from a trusted device.",
  "本机设备标识已被占用，请清除应用数据后重试":
    "This device identifier is already in use. Clear the app data and try again.",
  "本机设备凭据无法通过验证，请在可信设备中检查设备状态":
    "This device credential could not be verified. Check the device in Trusted devices.",
  "此设备已被拒绝或撤销": "This device has been rejected or revoked.",
  "本机设备身份与账户不匹配，已安全中止":
    "This device identity does not match the account. The operation was stopped safely.",
  "本机设备凭据缺失，请重新注册此设备":
    "This device credential is missing. Register this device again.",
  "本机设备身份尚未完成初始化，请重新开始":
    "This device identity has not been initialized. Please start again.",
  "密码库密钥包与本机设备不匹配，已安全中止":
    "The vault key package does not belong to this device. The operation was stopped safely.",
  "可信设备尚未分发密码库密钥":
    "A trusted device has not shared the vault key yet.",
  "需要验证设备身份后才能继续":
    "Verify this device before continuing.",
  "当前无法验证设备身份": "This device cannot be verified right now.",
  "设备安全密钥已失效，请使用恢复流程重新绑定":
    "The device security key is invalid. Use recovery to bind this device again.",
  "本机受保护数据校验失败，已安全中止":
    "Protected data on this device failed verification. The operation was stopped safely.",
  "本机安全存储失败，未保存登录会话":
    "Secure storage failed. The sign-in session was not saved.",
  "本机安全模块操作失败，已安全中止":
    "The device security module failed. The operation was stopped safely.",
  "恢复码材料不完整，请重新登录后重试":
    "Recovery-code data is incomplete. Sign in again and try again.",
  "恢复失败。邮箱、恢复码或加密恢复材料无效，未执行不安全降级":
    "Recovery failed because the email, recovery code, or encrypted recovery data is invalid. No insecure fallback was used.",
  "无法确认恢复是否已提交。请使用新主密码执行普通登录，不要删除本机恢复材料":
    "Recovery could not be confirmed. Try a normal sign-in with the new master password, and keep the recovery data on this device.",
  "云端安全存储暂不可用，账户和本机数据均未删除，请稍后重试":
    "Cloud secure storage is temporarily unavailable. Neither the account nor local data was deleted. Try again later.",
  "云端加密备份清理未完成，账户和本机数据均未删除，请稍后重试":
    "Encrypted cloud backup cleanup did not finish. Neither the account nor local data was deleted. Try again later.",
  "请先退出当前账户，再恢复其他邮箱的密码库":
    "Sign out of the current account before recovering a vault for another email.",
  "无法确认服务器会话撤销，且本机令牌删除失败；请保持应用关闭并重试退出":
    "The server session could not be confirmed as revoked, and the local token could not be deleted. Keep the app closed and try signing out again.",
  "安全会话清理失败；本次服务器会话已退出，请重启应用后重新登录":
    "Secure session cleanup failed after the server session was revoked. Restart the app and sign in again.",
  "已退出本机，但服务器会话撤销失败；下次登录会轮换本设备会话":
    "Local sign-out succeeded, but the server session could not be revoked. The next sign-in will rotate this device session.",
  "登录已过期，无法安全地重新绑定设备":
    "The session expired, so this device cannot be bound again safely.",
  "无法撤销当前服务器会话，未清除本机设备身份":
    "The current server session could not be revoked. The local device identity was kept.",
  "服务器会话已撤销，但本机令牌删除失败；请清除应用数据后重新登录":
    "The server session was revoked, but the local token could not be deleted. Clear the app data and sign in again.",
  "会话已撤销，但本机设备身份清理失败；请清除应用数据后重新绑定":
    "The session was revoked, but the local device identity could not be cleared. Clear the app data and bind the device again.",
  "登录已过期，请重新登录后再删除账户":
    "The session expired. Sign in again before deleting the account.",
  "为防止长期会话误删账户，请退出并重新登录后在 5 分钟内重试":
    "To prevent accidental deletion from a long-lived session, sign out and sign in again, then retry within 5 minutes.",
  "账户已从服务器删除，但本机安全数据清理失败；请清除应用数据后再使用本设备":
    "The account was deleted from the server, but secure data on this device could not be cleared. Clear the app data before using this device again.",
  "会话已失效，请重新登录": "The session expired. Please sign in again.",
  "自动锁定设置未能安全保存，已恢复为 5 分钟":
    "Auto-lock could not be saved securely and was reset to 5 minutes.",
  "未命名条目": "Untitled item",
  "请重新输入主密码完成安全验证":
    "Enter the master password again to complete secure verification.",
  "生物识别已取消，密码库仍保持锁定":
    "Biometric verification was cancelled. The vault remains locked.",
  "生物识别未授权本机密钥，密码库仍保持锁定":
    "Biometric verification did not authorize the device key. The vault remains locked.",
  "此设备已要求使用生物识别解锁":
    "This device requires biometric unlock.",
  "此设备尚未启用生物识别解锁":
    "Biometric unlock is not enabled on this device.",
  "生物识别密钥已失效，请重新注册此设备":
    "The biometric key is invalid. Register this device again.",
  "本机设备身份缺失，请使用恢复码或可信设备重新绑定":
    "The device identity is missing. Use a recovery code or trusted device to bind it again.",
  "本机设备身份校验失败，请勿继续批准或解锁":
    "The device identity failed verification. Do not approve or unlock it.",
  "本机设备凭据缺失，请重新绑定此设备":
    "The device credential is missing. Bind this device again.",
  "本机安全材料校验失败，已禁止解锁":
    "Device security data failed verification. Unlocking was blocked.",
  "本机安全模块不可用，已禁止密码降级":
    "The device security module is unavailable. Password fallback was blocked.",
  "本机安全模块返回了不兼容状态，已禁止解锁":
    "The device security module returned an incompatible state. Unlocking was blocked.",
  "此设备仍在等待批准和密码库密钥分发":
    "This device is still waiting for approval and the vault key.",
  "此设备尚未收到密码库密钥":
    "This device has not received the vault key yet.",
  "网络连接失败，离线变更仍安全保存在本机":
    "The network connection failed. Offline changes remain stored securely on this device.",
  "密码库操作失败，未执行不安全降级":
    "The vault operation failed. No insecure fallback was used.",
  "是": "Yes",
  "否": "No",
  "＋": "+",
  "›": "›",
  "·": "·",
};

export const chineseOverrides: Readonly<Record<string, string>> = {
  "(tabs)": "密码库",
  "(tabs)/settings": "设置",
  "(tabs)/vault": "密码库",
  "account": "账户",
  "cloud-backup": "云备份",
  "conflicts": "同步冲突",
  "credential": "凭据",
  "credential/[id]": "凭据详情",
  "device-approval": "设备批准",
  "devices": "可信设备",
  "health": "密码健康",
  "index": "Zero Vault",
  "item": "密码库条目",
  "item/[id]/edit": "编辑条目",
  "item/new": "新建条目",
  "local-backup": "本地备份",
  "login": "登录",
  "password-health": "密码健康",
  "recovery": "账户恢复",
  "recovery-code": "恢复码",
  "register": "创建账户",
  "settings": "设置",
  "sync-status": "同步状态",
  "unlock": "解锁密码库",
  "vault": "密码库",
};
