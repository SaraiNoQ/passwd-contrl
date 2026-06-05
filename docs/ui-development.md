# Zero Vault 前端界面开发文档

Last updated: 2026-06-04

## 目标

本文档用于指导 Zero Vault 的 Web Vault 与浏览器扩展界面重构。重构目标不是做营销页，而是把已经整理为文字规范的 UI 方案落地为可长期维护、默认中文、符合零知识密码管理器安全边界的产品界面。

注意：后续开发 agent 可能不支持多模态能力，因此不能依赖读取或理解 `UI/` 目录图片本身。`UI/` 文件名只作为人类追溯依据；开发实现必须以本文档中的文字描述、页面要求、组件规范、颜色 token、交互约束和验收标准为准。

本轮前端重构应保持现有功能和协议稳定：

- 不改变加密模型、同步协议、恢复码协议、设备信任协议。
- 不向 API、日志、localStorage、测试快照、截图输出明文密码、明文 origin、明文用户名、明文 notes、master password、derived key、recovery code。
- 不实现静默填充，不自动提交表单。
- 不填充 HTTP 页面、隐藏字段、不可见字段、disabled/readonly 字段、跨域 iframe。
- Web Vault 锁定后必须清空扩展 session credentials。
- 首选语言改为中文，英文作为后续 i18n 扩展项，不作为首版界面的默认文案。

## 原型图映射

`UI/` 目录中的 9 张原型图已经被转写为下面的文字映射。若开发模型无法看图，不需要打开图片；按“目标界面”和“开发范围”落地即可。

| 原型图 | 目标界面 | 开发范围 |
| --- | --- | --- |
| `UI/ChatGPT Image 2026年6月4日 01_00_44 (1).png` | Web Vault 锁定态/仪表盘 | 左侧导航、解锁卡片、状态概览、安全事件、同步/运行时摘要 |
| `UI/ChatGPT Image 2026年6月4日 01_00_44 (2).png` | Web Vault 已解锁凭据页 | 凭据列表、搜索过滤、状态卡片、右侧新增/编辑抽屉 |
| `UI/ChatGPT Image 2026年6月4日 01_00_44 (3).png` | 浏览器扩展 popup | 当前站点、匹配凭据、阻止原因、确认填充按钮 |
| `UI/ChatGPT Image 2026年6月4日 01_00_44 (4).png` | CSV 导入流程 | 导入向导、浏览器来源、明文 CSV 警告、预览与校验 |
| `UI/ChatGPT Image 2026年6月4日 01_00_44 (5).png` | 恢复码设置 | 步骤进度、恢复码展示、离线保存警告、确认校验 |
| `UI/ChatGPT Image 2026年6月4日 01_00_44 (6).png` | 同步与设备信任 | 同步状态、受信设备、冲突解决、活动记录 |
| `UI/ChatGPT Image 2026年6月4日 01_00_44 (7).png` | 移动端/桌面端预览 | Android Autofill、iOS/macOS Credential Provider 后续参考 |
| `UI/ChatGPT Image 2026年6月4日 01_00_44 (8).png` | 网页填充确认浮层 | 浏览器页面上的凭据选择、安全提示、确认填充 |
| `UI/ChatGPT Image 2026年6月4日 01_00_44 (9).png` | 设计系统 | 颜色、排版、按钮、输入框、徽章、列表、模态框、标签页 |

## 产品定位

Zero Vault 的界面应像一个严肃、可信、面向高频操作的安全控制台。可以参考 Web3 产品中“暗色、发光边框、玻璃层级、技术感排版”的视觉语言，但不能变成加密货币交易面板。

应避免：

- 大面积紫色/蓝紫渐变。
- 装饰性光球、漂浮圆形、随机 bokeh 背景。
- 钱币、链条、NFT、价格图表等加密货币符号。
- 营销页式 hero、大段宣传语、空泛价值主张。
- 过度卡片化导致核心凭据列表密度不足。

应强调：

- 密码库的当前安全状态。
- 凭据检索、复制、编辑、同步、冲突解决的效率。
- 扩展填充的站点匹配和阻止原因。
- 数据始终本地解密、远端只存密文的边界。
- 恢复码、设备信任、CSV 导入等高风险操作的明确确认。

## 信息架构

默认中文导航如下。首版可以只实现已有功能入口，未完成入口应隐藏或以明确的“规划中”状态呈现，不能做成可点击但无行为的假入口。

- 仪表盘
- 凭据
- 通行密钥
- 安全笔记
- 银行卡
- 身份信息
- 共享项目
- 同步与设备
- 活动记录
- 回收站
- 设置

当前已具备功能优先落地：

- 仪表盘
- 凭据
- 导入
- 同步与设备
- 恢复码
- 活动记录
- 设置

后续功能入口如通行密钥、银行卡、身份信息、共享项目，只有在数据模型和加密/同步协议完成后再开放。

## 默认中文文案原则

界面文案应简洁、操作化、可直接指导用户下一步。避免“军工级加密”“绝对安全”等无法证明的宣传词。

推荐文案示例：

- 解锁密码库
- 创建本地密码库
- 主密码只在此设备上使用，不会发送到服务器
- 已锁定
- 已解锁
- 自动锁定倒计时
- 立即同步
- 有同步冲突
- 保留本地版本
- 采用云端版本
- 创建副本
- 跳过此项
- 从云端恢复密文密码库
- 扩展已连接
- 扩展未连接
- 未配置扩展 ID
- 当前站点不允许填充
- 仅支持 HTTPS 页面填充
- 检测到相似域名，请手动确认
- CSV 文件包含明文密码，导入完成后请删除原文件
- 恢复码不会上传到服务器，丢失后无法通过客服找回

禁用文案示例：

- 你的密码绝对安全
- 服务器帮你恢复主密码
- 自动为你填写所有密码
- 点击即刻上链保护
- 无需担心任何泄漏

## 视觉设计规范

### 颜色

以暗色为主，使用少量高亮色表达状态和动作。

| Token | 用途 | 推荐值 |
| --- | --- | --- |
| `--color-bg-root` | 页面根背景 | `#050B12` |
| `--color-bg-shell` | 主应用背景 | `#07111D` |
| `--color-bg-panel` | 面板/抽屉/弹层 | `#0B1624` |
| `--color-bg-panel-soft` | 弱层级面板 | `#101827` |
| `--color-border` | 默认边框 | `#1F2937` |
| `--color-border-strong` | 强调边框 | `#334155` |
| `--color-text-primary` | 主文本 | `#F8FAFC` |
| `--color-text-secondary` | 次文本 | `#CBD5E1` |
| `--color-text-muted` | 弱文本 | `#94A3B8` |
| `--color-primary` | 主操作/焦点 | `#22D3EE` |
| `--color-success` | 安全/成功 | `#34D399` |
| `--color-accent` | 次强调 | `#F472B6` |
| `--color-warning` | 警告 | `#F59E0B` |
| `--color-danger` | 危险/删除/阻止 | `#FB7185` |

使用约束：

- 主操作使用 cyan，不要每个可点击元素都发光。
- 成功、安全、已同步使用 mint green。
- 警告、CSV 明文、冲突使用 amber。
- 删除、阻止、恢复码丢失风险使用 rose。
- 文本对比度至少满足 WCAG AA。
- 警告状态不能只依赖颜色，必须同时有图标和文字。

### 玻璃与发光

可在面板上使用轻量 glassmorphism：

- 背景：半透明深色，不使用浅色毛玻璃。
- 边框：1px 低透明度 cyan/slate。
- 阴影：弱扩散，不做霓虹外发光大面积铺满。
- 半径：卡片和面板最大 8px，除非现有组件明确需要更大半径。

### 排版

推荐使用系统 sans-serif 或现有项目字体栈。中文界面要优先保证可读性。

| 用途 | 字号 | 行高 | 字重 |
| --- | --- | --- | --- |
| 页面标题 | 24-28px | 32-36px | 600 |
| 分区标题 | 16-18px | 24-28px | 600 |
| 表格/列表正文 | 14px | 20-22px | 400 |
| 辅助说明 | 12-13px | 18px | 400 |
| 按钮 | 13-14px | 20px | 500 |
| 扩展 popup 标题 | 15-16px | 22px | 600 |

排版约束：

- 不用负 letter-spacing。
- 不用 viewport width 动态缩放字体。
- 中文按钮文本必须在窄宽度下不溢出。
- 密集表格里不要使用 hero 级标题。

### 间距和尺寸

推荐 spacing scale：

- `4px`: 图标与短标签间距、紧凑内部间距。
- `8px`: 控件内部常用间距、卡片内组间距。
- `12px`: 表单行、列表行内部间距。
- `16px`: 面板 padding、表单组间距。
- `24px`: 页面区块间距。
- `32px`: 大区块或空状态间距。

布局尺寸：

- Sidebar 宽度：240-280px。
- Web 主内容最大宽度：不强制居中卡片，优先全宽工作台。
- 右侧抽屉宽度：360-420px。
- Extension popup 宽度：320-360px，高度 480-600px。
- 移动触控目标：至少 44px。

## 应用布局

### Web Shell

Web Vault 应使用“侧边导航 + 顶部状态栏 + 主工作区 + 右侧上下文面板/抽屉”的结构。

左侧导航：

- 顶部显示 Zero Vault 标识和当前锁定状态。
- 中部是功能导航。
- 底部显示同步状态、扩展连接状态、锁定按钮。

顶部状态栏：

- 全局搜索。
- 当前 vault 状态。
- 同步按钮和最近同步时间。
- 自动锁定倒计时。
- 当前账户/设备状态。

主工作区：

- 仪表盘显示概览卡和安全事件。
- 凭据页显示高密度列表或表格。
- 同步页显示设备、冲突和活动。

右侧面板：

- 新增/编辑凭据抽屉。
- 详情预览。
- 安全警告。
- 导入校验结果。

### 响应式策略

桌面：

- 保留 sidebar。
- 凭据列表和详情抽屉可以并排。
- 状态卡可使用 3-4 列。

平板：

- sidebar 可压缩为图标栏。
- 右侧抽屉覆盖主内容。
- 表格列数减少，保留名称、origin、用户名、状态、操作。

移动：

- 使用底部导航或顶部菜单。
- 凭据列表改为行卡片，不使用过宽表格。
- 新增/编辑表单使用全屏 sheet。
- 关键操作保持底部固定按钮，但不能遮挡内容。

## 页面开发规范

### 1. 锁定态与解锁页

文字参考：锁定态/仪表盘界面。左侧深色导航，中央解锁卡片，右侧最近安全事件和状态卡片。

必须包含：

- Zero Vault 品牌区。
- 当前状态：已锁定、本地 vault 是否存在、同步是否可用。
- 主密码输入框。
- 解锁按钮。
- 创建新密码库入口。
- 安全说明：主密码不会发送到服务器。
- 扩展连接状态：已连接、未连接、未配置扩展 ID。
- 最近安全事件或本地运行状态摘要。

交互要求：

- 主密码输入默认隐藏。
- 错误密码只显示通用错误，不透露内部验证细节。
- 连续失败应有轻量冷却或提示，避免暴力尝试体验。
- 解锁成功后进入凭据页或上次访问页。
- 锁定态不展示任何凭据名称、origin、用户名。

测试要求：

- 错误密码无法解锁。
- 锁定态 DOM 不包含明文凭据。
- 解锁后扩展 bridge 只发布最小 session credentials。

### 2. 凭据列表页

文字参考：已解锁凭据工作台。左侧导航，顶部统计卡片，中部高密度凭据表格，右侧新增/编辑凭据抽屉，安全状态 badge。

必须包含：

- 搜索框。
- 筛选：全部、弱密码、重复密码、未同步、有冲突、最近更新。
- 凭据列表或表格。
- 新增凭据按钮。
- 复制用户名/密码按钮。
- 编辑、删除、查看详情。
- 每个 item 的同步状态 badge。
- 密码默认隐藏。

列表字段建议：

- 名称。
- Origin 或应用标识。
- 用户名。
- 密码强度/风险。
- 同步状态。
- 最近更新。
- 操作按钮。

交互要求：

- 点击行打开详情或编辑抽屉。
- 复制密码只在用户明确点击后执行。
- 复制后不在 toast 中显示明文。
- 删除前确认。
- origin 必须校验 HTTPS URL，非 HTTPS 需要明确阻止或标记为不支持自动填充。
- 搜索可以匹配本地已解密的名称、origin、用户名，但不能把搜索索引持久化为明文。

安全要求：

- localStorage 只能保存加密 vault 或必要的非敏感 UI 偏好。
- 不把 plaintext item 写入 URL query、日志、analytics、测试快照。
- 密码 reveal 状态离开行、锁定、切换页面后应重置。

### 3. 新增/编辑凭据抽屉

文字参考：凭据新增/编辑抽屉。表单紧凑、右侧滑出、带 URL 校验、密码生成、显示/隐藏、复制和保存/取消操作。

字段：

- 标题/名称。
- 网站地址/Origin。
- 用户名。
- 密码。
- 备注。
- 标签。

控件要求：

- 密码生成器入口。
- reveal/hide 按钮。
- 复制按钮。
- 保存、取消、删除。
- URL 校验提示。

文案示例：

- 标题：新增凭据 / 编辑凭据
- Origin placeholder：`https://example.com`
- URL 错误：自动填充仅支持 HTTPS 站点
- 保存成功：凭据已加密保存

### 4. 浏览器扩展 popup

文字参考：浏览器扩展 popup。紧凑深色弹窗，显示当前站点、匹配凭据、阻止原因和明确的确认填充按钮。

必须包含：

- 当前 tab origin。
- 状态：可填充、已锁定、HTTP 阻止、相似域名警告、未检测到登录表单。
- 候选凭据列表。
- 填充按钮。
- 打开 Web Vault 按钮。
- 不展示明文密码。

状态优先级：

1. 非 HTTPS：阻止。
2. 锁定：提示打开 Web Vault 解锁。
3. 跨域 iframe 或字段不安全：阻止。
4. 无 exact origin 匹配：显示无匹配或相似域名警告。
5. exact origin 匹配：允许用户选择并点击填充。

交互要求：

- 用户点击 Fill 后才发送 username/password 到 content script。
- 填充前 content script 必须重新检查字段可见性和可编辑性。
- 不自动提交。
- popup 不显示密码明文。
- 键盘可导航，焦点状态清晰。

### 5. CSV 导入

文字参考：CSV 导入向导。分步骤流程，浏览器来源卡片，文件选择，明文 CSV 风险警告，校验统计和导入预览。

导入流程：

1. 选择浏览器来源：Chrome、Edge、Firefox。
2. 选择 CSV 文件。
3. 在浏览器内存中解析。
4. 展示校验结果和预览。
5. 用户确认导入。
6. 加密写入 vault。
7. 提示删除明文 CSV。

必须显示的风险提示：

- CSV 文件包含明文密码。
- Zero Vault 不会上传明文 CSV。
- 导入完成后请删除原 CSV 文件。

校验维度：

- URL 是否有效。
- 是否 HTTPS。
- 用户名是否为空。
- 密码是否为空。
- 重复项。
- 不支持字段。

安全要求：

- 不把 CSV 原文写入 localStorage、IndexedDB、日志、错误上报。
- 测试中不能使用真实密码 fixture。
- 导入预览里的密码默认不显示。

### 6. 恢复码设置

文字参考：恢复码设置流程。步骤进度、恢复码包、离线保存警告、用户确认校验、恢复码丢失风险提示。

必须包含：

- 恢复码用途说明。
- 恢复码生成状态。
- 离线保存建议。
- 用户确认步骤。
- 恢复码校验输入。
- 丢失风险警告。

安全要求：

- 恢复码永远不能发送到服务器。
- 服务器只保存 encrypted recovery packet。
- 恢复码不要默认复制到剪贴板；必须用户明确点击。
- 页面离开或锁定后清空恢复码显示。
- 不在截图测试、日志、telemetry 中记录真实恢复码。

推荐中文文案：

- “恢复码只显示一次。”
- “请将恢复码写在纸上并离线保存。”
- “Zero Vault 无法通过邮箱或客服重置主密码。”

### 7. 同步与设备信任

文字参考：同步与设备信任控制台。同步状态卡片、受信设备表、冲突解决卡片、同步活动与安全事件侧栏。

必须包含：

- 当前同步状态：已同步、待同步、冲突、离线、失败。
- 最近同步时间。
- item-level sync 统计。
- 受信设备列表。
- 新设备请求。
- 冲突解决面板。
- 同步活动记录。

冲突 UI 必须提供：

- 保留本地版本。
- 采用云端版本。
- 创建副本。
- 跳过。

安全要求：

- 冲突解决只在客户端解密后展示。
- 服务端 history 仍然只返回密文 envelope。
- 不自动覆盖用户数据。
- 设备撤销后应立即清除该设备的 encrypted vault key。

### 8. 移动端与系统凭据提供器预览

文字参考：移动端和桌面端凭据提供器预览。Android Autofill、iOS Credential Provider、macOS Credential Provider 的候选列表和确认填充样式。

当前阶段仅作为设计约束，不要求实现移动端。Web 组件应为后续移动端复用留出信息结构：

- 凭据行应能压缩到移动列表。
- 安全 badge 和 origin 匹配状态应有短文案版本。
- 填充确认 UI 应与 Android AutofillService、iOS/macOS Credential Provider 的候选项模型兼容。

### 9. 网页填充确认浮层

文字参考：网页填充确认浮层。登录页上方的安全确认层，包含候选凭据、origin 状态、生物识别/解锁提示和 Fill Selected 操作。

当前实际产品以扩展 popup 为主。若未来实现页面内浮层，必须遵守：

- 仅 exact HTTPS origin。
- 不注入到跨域 iframe。
- 不展示明文密码。
- 不自动提交。
- 用户明确点击后填充。
- DOM 变更后重新验证字段。

## 组件规范

### Button

类型：

- Primary：主要操作，例如解锁、保存、确认填充、立即同步。
- Secondary：次操作，例如取消、查看详情。
- Ghost/Icon：工具操作，例如复制、显示/隐藏、刷新。
- Danger：删除、撤销信任设备、清除本地数据。

要求：

- 图标优先使用 lucide icons。
- 图标按钮必须有 `aria-label`。
- 禁用态必须有视觉区别。
- 加载态不能导致按钮宽度跳动。

### Input

类型：

- Text input。
- Password input。
- URL input。
- Search input。
- Textarea。

要求：

- focus ring 在暗色背景下清晰。
- 错误提示紧贴字段。
- URL 字段实时校验 HTTPS。
- Password 字段默认隐藏，reveal/hide 是显式动作。

### Status Badge

类型：

- 已锁定。
- 已解锁。
- 已同步。
- 待同步。
- 冲突。
- 离线。
- 已阻止。
- 可填充。
- 相似域名。
- 受信设备。

要求：

- 颜色、图标、文字三者同时表达状态。
- badge 文案保持 2-6 个中文字符，必要时使用 tooltip 补充。

### Credential Row

必须支持：

- 名称。
- origin。
- 用户名。
- 密码 masked。
- 风险/同步 badge。
- 快捷操作。

不得：

- 默认展示明文密码。
- 在未解锁时渲染凭据文本。
- 把用户名/密码放到 HTML `title` 属性中。

### Drawer / Modal

用于：

- 新增/编辑凭据。
- 导入确认。
- 恢复码展示。
- 冲突解决。
- 设备授权。

要求：

- ESC 关闭非破坏性弹层。
- 危险操作弹层需要明确确认。
- 恢复码弹层关闭时清空敏感内存状态。
- 焦点 trap 正常工作。

### Toast

用途：

- 保存成功。
- 复制完成。
- 同步完成。
- 导入完成。
- 错误提示。

要求：

- 不显示明文密码、origin 明细、用户名明细。
- 错误文案不要暴露内部实现或协议消息。

## 扩展 bridge UI

Web Vault 应显示扩展连接状态，帮助用户完成本地配置。

状态：

- 未配置：没有 `NEXT_PUBLIC_EXTENSION_ID`。
- 连接中：已配置 ID，正在尝试通信。
- 已连接：扩展可接收 session credentials。
- 无法通信：ID 错误、扩展未安装、浏览器不支持。
- 已清空：锁定后已通知扩展清空 session。

界面要求：

- 在设置页或仪表盘显示配置状态。
- 不显示任何 session credential 明细。
- publish/clear 结果只显示状态和时间。
- 连接失败时给出操作提示：检查扩展 ID、重新加载扩展、重启 Web dev server。

## 本地化和 i18n

首版默认语言为 `zh-CN`。

建议目录：

- `apps/web/src/i18n/zh-CN.ts`
- `apps/web/src/i18n/en-US.ts`（可后置）
- `apps/extension/src/i18n/zh-CN.ts`
- `apps/extension/src/i18n/en-US.ts`（可后置）

约束：

- 新增界面文案不得直接散落在组件中，除非项目当前还没有 i18n 基础设施；若临时直写中文，应在后续任务中集中抽离。
- 测试中优先使用 role、label、test id，不依赖易变长句文案。
- 中文文案要考虑扩展 popup 的窄宽度，按钮尽量 2-6 个汉字。

常用词表：

| English | 中文 |
| --- | --- |
| Vault | 密码库 |
| Credential | 凭据 |
| Unlock | 解锁 |
| Lock | 锁定 |
| Sync | 同步 |
| Conflict | 冲突 |
| Recovery code | 恢复码 |
| Trusted device | 受信设备 |
| Fill | 填充 |
| Blocked | 已阻止 |
| Exact match | 精确匹配 |
| Similar domain | 相似域名 |
| Import | 导入 |
| Export | 导出 |
| Local only | 仅本地 |

## 可访问性要求

必须满足：

- 键盘可操作全部核心流程。
- focus ring 在暗色背景上清晰。
- 表单字段有 label。
- 图标按钮有 `aria-label`。
- 弹层有标题和焦点管理。
- 颜色不是唯一状态表达。
- 文本对比度满足 WCAG AA。
- 移动触控目标不小于 44px。

需要测试的键盘路径：

- 解锁。
- 搜索凭据。
- 新增凭据。
- 复制用户名/密码。
- 扩展 popup 选择候选并填充。
- 冲突解决。
- 关闭弹层。

## 安全与隐私验收

前端重构完成后，必须验证：

- `localStorage` 不包含明文 password、origin、username、notes、master password、recovery code。
- `sessionStorage` 不包含长期密钥或 master password。
- extension storage 不持久保存 vault key。
- popup 不显示明文密码。
- Web Vault 锁定后扩展 session credentials 被清空。
- CSV 导入不落盘明文。
- 恢复码不发送到 API。
- 同步冲突不会自动覆盖本地或远端。
- 错误提示不输出 OPAQUE message、session token、ciphertext payload 内容。

## 测试计划

### Web

新增或更新测试：

- 中文默认文案渲染。
- 锁定态不渲染凭据明文。
- 解锁后显示凭据列表。
- 搜索过滤。
- 新增/编辑/删除凭据。
- 密码复制不在 toast 中显示明文。
- CSV 导入不写明文 localStorage。
- 恢复码关闭后清空显示。
- 扩展 bridge 状态：未配置、已连接、无法通信、锁定清空。
- 同步冲突 panel：保留本地、采用云端、创建副本、跳过。

命令：

```sh
npx pnpm --filter @zero-vault/web typecheck
npx pnpm --filter @zero-vault/web test
```

### Extension

新增或更新测试：

- popup 中文文案。
- exact HTTPS origin 显示候选。
- HTTP blocked。
- 相似域名警告。
- popup 不展示密码。
- Fill 后不自动 submit。
- hidden/invisible/disabled/readonly/cross-origin iframe blocked。
- 锁定后候选清空。

命令：

```sh
npx pnpm --filter @zero-vault/extension build
npx pnpm --filter @zero-vault/extension test
npx pnpm --filter @zero-vault/extension test:e2e
```

### 全仓

前端重构合并前运行：

```sh
npx pnpm typecheck
npx pnpm test
npx pnpm build
cargo test --manifest-path crates/crypto-core/Cargo.toml
npx pnpm wasm:build
```

## 开发分阶段

**状态说明**：`未开始` | `进行中` | `已完成`

### UI-1: 设计系统基础 — 已完成

目标：

- 建立颜色、spacing、radius、shadow、typography token。
- 建立按钮、输入框、badge、面板、列表行、弹层基础组件。
- 默认中文文案。

已完成：

- `apps/web/app/tokens.css` — 完整的设计 token 体系（颜色、间距、圆角、排版、阴影、玻璃效果、过渡动画）。
- `apps/web/components/ui/button.module.css` — 按钮组件 CSS Module，包含 primary/secondary/ghost/danger 变体、loading 态、focus ring。
- 组件目录已创建：`components/import/`、`components/recovery/`、`components/sync/`（待填充）。
- Button — 主要操作按钮，支持 primary/secondary/ghost/danger 变体。
- Input — 文本输入、URL 输入、搜索输入。
- PasswordField — 密码输入，带 reveal/hide 切换。
- Badge — 状态徽章，支持锁定/解锁/同步/冲突/离线等状态。
- Panel — 面板容器，暗色玻璃层级。
- Drawer — 右侧滑出抽屉，用于新增/编辑凭据。
- Modal — 模态弹层，用于确认操作和恢复码展示。
- Toast — 通知提示，不显示明文敏感信息。
- CredentialRow — 凭据列表行，支持 masked 密码和快捷操作。

待完成：

- 无剩余设计系统基础组件。

验收：

- 原有页面功能不回退。
- Web 和 extension typecheck/test 通过。

**备注**：中文（zh-CN）现在是默认语言。英文作为后续 i18n 扩展项，不作为首版界面的默认文案。

### UI-2: Web Shell 与锁定态 — 已完成

目标：

- 重构整体布局。
- 完成 sidebar、top status bar、locked dashboard。
- 展示扩展连接状态。

已完成：

- `apps/web/components/shell/sidebar.tsx` — 左侧导航，品牌区、功能导航、扩展连接状态、同步状态、锁定按钮、账户管理。
- `apps/web/components/shell/top-bar.tsx` — 顶部状态栏，搜索、同步状态 badge、自动锁定倒计时、同步按钮。
- `apps/web/components/shell/locked-state.tsx` — 锁定态界面，品牌区、主密码输入、创建/解锁/恢复入口、扩展连接 badge。
- Shell 布局已集成到 `vault-app.tsx`。

验收：

- 锁定态无明文泄漏。
- 解锁流程通过。

### UI-3: 凭据工作台 — 已完成

目标：

- 重构凭据列表。
- 完成新增/编辑抽屉。
- 完成搜索、筛选、复制、密码生成器视觉。
- 增加 item sync badge。

已完成：

- `apps/web/components/credentials/credential-list.tsx` — 多字段排序（名称、更新时间、创建时间），密码强度可视化（进度条+颜色），批量操作（checkbox 选择、批量删除/导出），筛选（全部/弱密码/重复/未同步/冲突）。
- `apps/web/components/credentials/credential-drawer.tsx` — 新增/编辑抽屉，使用 Drawer、Input、PasswordField、Button 组件。
- `apps/web/components/credentials/credential-filters.tsx` — 筛选栏组件。
- Dashboard 统计卡片（凭据总数、最近更新、同步状态、上次同步）。

验收：

- CRUD 与本地加密读写通过。
- CSV/plaintext localStorage 回归通过。

### UI-4: 扩展 popup

目标：

- 按本文档的 popup 文字规范重构。
- 中文状态文案。
- 候选选择、阻止原因、确认填充。

验收：

- extension unit + E2E 全部通过。
- popup 不展示密码。

### UI-5: 导入、恢复、同步与设备 — 已完成

目标：

- CSV 导入向导。
- 恢复码 modal。
- 同步与设备页。
- 冲突解决 UI。

已完成：

- `apps/web/components/import/csv-import.tsx` — 5 步导入向导：选择来源 → 选择文件 → 预览校验 → 确认导入 → 结果。支持 Chrome/Edge/Firefox CSV，明文风险警告，校验结果展示。
- `apps/web/components/recovery/recovery-setup.tsx` — 3 步恢复码向导：生成 → 保存（复制/打印）→ 确认（输入末尾 8 位验证）。
- `apps/web/components/recovery/recovery-modal.tsx` — 恢复码弹层，打印按钮，离线保存建议列表，确认 checkbox。
- `apps/web/components/recovery/recovery-entry.tsx` — 锁定态恢复入口，输入恢复码 + 新主密码。
- `apps/web/components/sync/sync-panel.tsx` — 同步面板，状态指示器，item-level sync 统计，进度条，活动日志。
- `apps/web/components/sync/sync-device-panel.tsx` — 设备管理面板，批准/拒绝/撤销，当前设备高亮，确认对话框。
- `apps/web/components/sync/conflict-resolution-panel.tsx` — 冲突解决面板，逐条/批量操作，本地 vs 远端对比，字段级差异高亮。
- `apps/web/components/settings/settings-page.tsx` — 设置页，5 个区块：基本设置、密码管理、账户管理、数据导出、同步配置。

验收：

- 高风险操作都有确认。
- 恢复码不发服务端。
- 冲突不自动覆盖。

### UI-6: 响应式与可访问性

目标：

- 完成桌面、平板、移动布局。
- 完成键盘导航和 focus 状态。
- 检查中文文本溢出。

验收：

- Playwright 或浏览器截图检查主要视口。
- WCAG AA 基本对比通过。

## 不在本轮前端重构中做的事

- 不实现移动端原生客户端。
- 不实现 Firefox 适配。
- 不引入静默填充。
- 不改 item-level sync 协议语义。
- 不把 R2/D1 后端迁移和 UI 重构耦合为同一阻塞任务。
- 不新增营销首页作为首屏。

## Claude Code 开发 Prompt

后续可以用以下 `/goal` prompt 推进前端重构：

```text
/goal
你是 Zero Vault 前端重构总协调 agent。请基于 docs/ui-development.md 的文字规范，把 Web Vault 与 Chrome/Edge 扩展界面重构为默认中文的暗色 Web3 风格安全控制台。当前模型不支持多模态，不要读取、分析或依赖 UI/ 目录图片；图片文件名只作为人类追溯依据。必须遵守 AGENT.md、docs/security-model.md、docs/threat-model.md、docs/autofill.md、docs/ui-development.md。

硬约束：
- 不改加密/同步/恢复/设备信任协议语义，除非测试和安全文档同步更新。
- 服务器、localStorage、sessionStorage、extension storage、日志、测试快照不能出现明文 password/origin/username/notes、master password、derived key、recovery code。
- 不做静默填充，不自动提交，不填 HTTP、hidden、invisible、disabled、readonly、cross-origin iframe。
- Web Vault 锁定后必须清空 extension session credentials。
- 首选语言为中文。界面文案优先集中管理，避免散落硬编码。

开启 5 个 subagent 并行：

Subagent 1: Design System
- 建立颜色、排版、间距、radius、shadow token。
- 建立 Button、Input、PasswordField、Badge、Panel、Drawer、Modal、CredentialRow 基础组件。
- 只参考 docs/ui-development.md 中的设计系统文字规范：8px 内圆角、暗色安全控制台风格、cyan/mint/amber/rose 状态色、lucide 图标。
- 验收：apps/web typecheck/test 通过。

Subagent 2: Web Shell + Credentials
- 重构 Web Vault shell、sidebar、top status bar、锁定态、凭据列表、新增/编辑抽屉。
- 只参考 docs/ui-development.md 中的锁定态、仪表盘、凭据工作台、凭据抽屉文字规范。
- 默认中文，保留现有 CRUD、搜索、复制、密码生成、自动锁定。
- 验收：锁定态不渲染明文；CSV/localStorage 明文回归通过；apps/web test 通过。

Subagent 3: Import + Recovery + Sync/Device UI
- 重构 CSV 导入、恢复码、同步与设备、冲突解决。
- 只参考 docs/ui-development.md 中的 CSV 导入、恢复码、同步与设备文字规范。
- 冲突操作包含保留本地、采用云端、创建副本、跳过。
- 验收：恢复码不发送服务端；冲突不自动覆盖；apps/web test 通过。

Subagent 4: Extension Popup UI
- 重构 MV3 popup 为中文候选选择器。
- 只参考 docs/ui-development.md 中的浏览器扩展 popup 和网页填充确认文字规范。
- 展示当前 origin、匹配状态、阻止原因、候选凭据、确认填充按钮；不展示密码。
- 验收：extension build/test/e2e 通过，HTTP/iframe/hidden/readonly/disabled blocked。

Subagent 5: Docs + QA
- 更新 docs/ui-development.md、docs/development.md、docs/roadmap.md 中 UI 状态。
- 增加可访问性、中文文案、截图验证清单。
- 协调最终全仓验证。

最终验证：
- npx pnpm typecheck
- npx pnpm test
- npx pnpm build
- npx pnpm --filter @zero-vault/extension test:e2e
- cargo test --manifest-path crates/crypto-core/Cargo.toml
- npx pnpm wasm:build

最终汇报：完成项、截图/视觉检查结果、测试结果、未完成风险、下一步建议。
```
