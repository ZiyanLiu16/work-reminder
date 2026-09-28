# Work Reminder：第一版技术设计

状态：本地 MVP 已实现，构建输出位于 `dist/`。实际验收记录见 `TEST_REPORT.md`。2026-09-17。

实现调整：为减少本地部署依赖，使用原生 JavaScript ES modules 和 Node 构建脚本，无生产依赖。提醒实际展示于扩展 origin 的 iframe，Shadow DOM 用于框架内样式隔离，避免目标和项目片段暴露给宿主网页脚本。首次安装、更新、测试和已知边界见 `README.md`。

## 1. 产品目的与选型

在用户长时间浏览指定网站时，用个人目标、项目片段或鼓励内容帮助用户重新做出选择。第一版不使用 LLM、不需要账号或服务器，也不判断用户的情绪。

推荐先实现 Chrome Manifest V3 扩展。默认关注 youtube.com、bilibili.com、xiaohongshu.com 及其子域名。支持 macOS 上的 Chrome，架构也可用于其他桌面系统的 Chrome。

| 形态 | 目标网站前台计时 | 桌面微信计时 | 本地项目读取 | 第一版结论 |
| --- | --- | --- | --- | --- |
| 普通网站 | 不能直接观察其他网站和应用 | 不能 | 用户主动选取文件或目录 | 不适合作为检测主体 |
| Chrome 扩展 | 可以观察标签页、URL 和浏览器窗口焦点 | 不能 | 用户选择目录后导入 | 最小可行方案 |
| macOS 菜单栏应用 | 单凭前台应用只能知道 Chrome，识别网站还需额外方案 | 可以观察应用在前台，不能据此判断聊天目的 | 用户授权选择目录 | 第二阶段 |
| 扩展 + macOS 辅助应用 | 可以 | 可以 | 辅助应用读取授权目录 | 覆盖更全面，但安装和通信更复杂 |

macOS 版本若需要开发，选择菜单栏常驻应用；桌面 Widget 作为状态展示入口，不承担核心持续检测。未来通过 Native Messaging 连接扩展和本地辅助程序。

## 2. 第一版范围

必须包含：

- 填写一个最想实现的目标；默认提醒阈值 15 分钟，可修改。
- 可选导入 1–2 个本地项目目录；不导入也能使用目标和鼓励提醒。
- 三个目标网站跨标签、跨 Chrome 窗口累计前台使用时长。
- 达到阈值后在当前目标网页显示一张可关闭的提醒卡。
- 三类提醒按顺序轮换；没有有效内容的类别跳过。
- 暂停提醒、稍后提醒、学习模式、预览提醒，以及明确的当前计时状态。
- 本地保存设置与片段；不上传 repo 或浏览记录。

后续范围：桌面微信、自动刷新项目内容、在线帖文抓取、LLM 生成建议、移动端。第一版不承诺这些能力。

## 3. 怎样定义“刷了 15 分钟”

系统只检测“指定网站的前台使用”，不声称知道用户是否在工作。YouTube 和 B 站可能用于学习，因此提供“本标签页学习模式 60 分钟”，期间排除此标签页；刷新保留，关闭标签或浏览器重启后清除。

默认规则：

1. Chrome 窗口有焦点，并且该窗口的 active tab 是目标网站，才有资格计时。
2. 所有目标网站共用一个累计计时器，不为每个网站单独重新计算。
3. 切到编辑器、其他应用、非目标网站或浏览器失去焦点：暂停计时。
4. 暂停不足 5 分钟时保留已累计时长；连续暂停至少 5 分钟后开始新的会话。
5. 系统 locked：暂停。系统 idle 且没有可观测的前台视频播放：暂停。
6. 系统 idle 但当前可见目标网页有正在播放的 HTML video：继续计时。没有鼠标键盘输入不等于没在看视频。视频暂停、结束、持续缓冲时不使用此例外。
7. PiP 和后台播放第一版不计时；页面可见与视频播放仅是近似信号，不能证明人确实在看。
8. 第一次达到 15 分钟显示一次提醒；卡片未处理时不叠加。关闭卡片后，再累计 15 分钟才提醒下一次。“再看 5 分钟”改为再累计 5 分钟。
9. 锁屏与异常长采样间隔均不补记整段时间。浏览器重启后新开计时会话。

例：B 站 8 分钟 → YouTube 7 分钟，应提醒；B 站 8 分钟 → 编辑器 2 分钟 → YouTube 7 分钟，也应提醒；编辑器连续工作 5 分钟后，下一次目标网站浏览从零开始。

局限：闲置阅读可能被漏计，自动播放可能被计入。第一版用透明规则和用户控制来处理，不引入情绪识别或内容语义分类。

## 4. 检测与计时实现

技术栈：Manifest V3、TypeScript、Vite、原生 HTML/CSS。界面较小，第一版不必引入 React。使用本地解压加载验证，再考虑商店发布。

组件：

```text
设置页 → 目标、项目导入、阈值 → 本地存储
标签/窗口事件 + idle 状态 + 页面视频状态
                    ↓
             service worker
        计时状态机 → 提醒内容选择
                    ↓
           当前网页的提醒卡片
```

- `tabs.onActivated`、`tabs.onUpdated`、`tabs.onRemoved`：切换、导航、关闭时更新状态。
- `windows.onFocusChanged`：区分当前前台窗口与最后使用过的窗口；不能仅靠 `lastFocusedWindow` 判断前台。
- `idle.onStateChanged`：识别 active / idle / locked；idle 阈值建议 120 秒。
- 目标网站 content script：只报告本页面可见性与 video 播放状态。采用事件和稀疏心跳，SPA 页面新增 video 时重新绑定。
- `chrome.alarms`：约 30 秒一次检查阈值、状态和心跳。不是精确计时器；浏览器调度和睡眠可能使提醒延迟。
- Service worker 会停止运行，不使用常驻 `setInterval` 累加时间，也不依赖全局变量长期存活。

状态至少包含：`sessionId`、`eligible`、`accumulatedMs`、`lastObservedAt`、`inactiveSince`、`nextReminderAtMs`、`pendingReminderId`、`reminderIndex`。

每个事件先结算上一段状态，再读取最新焦点、标签与 idle 状态，最后保存新状态。异步处理串行化，避免同一时间段重复计入。内存只是缓存，持久状态为准。

计时状态保存在 `chrome.storage.session`，可跨 worker 重启但随浏览器会话结束清除；用户设置与片段放在 `chrome.storage.local`，不使用 sync。普通检查间隔内按时间戳结算；超过 90 秒的异常间隔保守丢弃，重新采样，不把睡眠时间算进观看。这会少算部分时间，是 MVP 明示的取舍。

Worker 每次启动检查并补建 alarm。触发提醒前重新验证目标标签仍在前台。达到阈值但页面无法显示时保留 pending，下次有效前台页面再尝试；同一提醒使用稳定 ID 去重，并由页面确认展示。

提醒卡使用 Shadow DOM 隔离样式，内容以文本渲染。全屏播放需要监听 `fullscreenchange`：能够在全屏元素内显示时插入；原生视频全屏等无法覆盖的情况延迟至退出全屏，同时在扩展 badge 标记待提醒。全屏、播放器 DOM 与网站改版需要真实浏览器验证。

权限控制：`storage`、`alarms`、`idle`，以及三个目标域名的 host permissions/content script matches。匹配站点的 host permissions 可提供目标标签 URL，无需默认请求所有网站权限。`activeTab` 的一次点击授权不足以支撑自动持续检测。第一版不依赖系统通知，不要求 notifications 权限。

## 5. 三类提醒

### 目标提醒

必填一个目标，多个固定句式随机选择，并避免连续重复：

> 你还记得想要「完成论文的第一个实验」吗？现在回来做一小步也不晚。

### 项目片段

在设置页点击“选择项目文件夹”，主动选择 1–2 个目录。仅填写 `/Users/…/repo` 路径不能授予浏览器文件系统读取权限。

MVP 使用文件夹选择输入 `input[type=file][webkitdirectory]` 导入快照，不长期持有目录访问权限。候选文件筛选后才读取内容。以后可以评估 File System Access API 的目录句柄与重新授权流程，或原生辅助应用的自动刷新。

导入规则：

- 优先 README、TODO、docs 下 Markdown，其次注释及小段源代码；保留标题段落或完整小段，避免纯随机截断。
- 默认排除隐藏目录、依赖、构建产物、锁文件、二进制、压缩包，以及 `.env`、密钥和证书；过滤不能保证识别所有敏感信息，导入预览允许取消任一片段。
- 单文件最多读取 200 KB，每个项目至多处理 100 个候选文件，生成至多 30 个片段，每段 5–15 行或约 500 字。目录枚举本身可能耗时，提供进度和取消。
- 保存项目名称、相对路径、行号、片段文本和导入时间；总片段容量设上限，不保存完整 repo。
- 用户点击“刷新项目片段”重新选择目录；明确展示当前是快照而非实时内容。
- 没有合适片段时跳过这一类别。

卡片示例：

> 这是你项目 `graph-experiments` 中的一段内容。
> `README.md:42` · 导入于 9 月 17 日
> …片段…
> 要不要先回去看看这一小段？

固定提示只邀请用户回到项目，不把随机片段包装成理解项目后生成的建议。Chrome 扩展不承诺一键打开本地编辑器；第一版允许复制相对路径。

### 鼓励内容

用户通过设置页第三步保存最多 20 条 HTTP/HTTPS 鼓励链接，可附文案和作者；保存后立即用于轮换，无需修改代码。仅有链接时展示收藏入口，不冒充已抓取正文。没有自定义内容时使用内置鼓励。开发者维护内置 `encouragements.json`：`id`、`text`、`author`、`sourceUrl`。第一版使用开发者自写文案或用户提供且适合使用的内容；没有提供真实帖子前只用明确标记的示例，不伪造引用。

仅有小红书链接不等于能取得帖文。第一版手动整理文案与来源，不依赖登录态、爬虫或页面嵌入。卡片直接呈现内容，“查看来源”为次要操作，避免必须回到信息流才能阅读提醒。

## 6. 界面与交互

首次安装自动打开设置页，提供三个带引导词和完成状态的输入入口：个人目标、可选项目目录、可选鼓励链接。默认 15 分钟，可预览提醒，全部配置可随时从工具栏重新打开修改。用户无需在聊天中向开发者提供配置。

工具栏 popup：本轮累计时长、当前计时/暂停原因、启用开关、设置入口、本标签学习模式。

网页提醒卡：一条目标/片段/鼓励内容，加“回到目标”“再看 5 分钟”和关闭操作。

“回到目标”打开扩展内的目标与项目片段页并重置本轮计时，不声称检测到用户已经工作；用户自主切换编辑器。“再看 5 分钟”只更改下一次提醒的累计时长，不强制关闭网页或暂停视频。

## 7. 验收与开发顺序

第一步完成检测闭环，用 30 秒测试阈值验证，不必每次等待 15 分钟；正式默认仍为 15 分钟。

第二步加入目标配置、项目导入预览和三类提醒轮换。

第三步验证真实 Chrome 行为与安装说明，再决定是否值得扩展桌面微信。

关键验收：

- 跨 B 站/YouTube 累计，切到编辑器暂停，离开 5 分钟重置。
- 多个 Chrome 窗口只统计真正有焦点窗口的 active tab；后台视频不累计。
- 无键鼠输入但前台视频播放仍累计；锁屏、合盖、唤醒不增加整段离开时间。
- Worker 停止再启动后累计不丢失、不重复，alarm 缺失可恢复；浏览器重启新会话。
- 标签切换与 alarm 同时发生时不重复计时、不重复弹卡。
- 前台阈值正常情况下约在下一次检查时提醒；不承诺严格 30 秒上限。
- 页面刷新、SPA 导航、进入/退出全屏、content script 不可用都有可解释行为。
- 无项目、无鼓励帖、无有效片段、导入取消均不阻塞目标提醒。
- 目录导入不读取被排除文件内容，片段预览可删，删除项目清除对应缓存。
- 学习模式与稍后提醒按约定生效；预览提醒不改动实际计时状态。

状态机用可注入时钟的单元测试覆盖跨站计时、暂停重置、恢复与去重；焦点、idle、全屏、导入和 worker 生命周期在真实 Chrome 中验收，不能仅靠 mock 声称已验证。

## 8. 官方依据

- [Chrome Tabs API](https://developer.chrome.com/docs/extensions/reference/api/tabs)：标签事件、active 与焦点的区别、host permissions 与 URL 读取。
- [Chrome Windows API](https://developer.chrome.com/docs/extensions/reference/api/windows)：窗口焦点变化。
- [Chrome Idle API](https://developer.chrome.com/docs/extensions/reference/api/idle)：输入闲置与锁定状态。
- [Chrome Alarms API](https://developer.chrome.com/docs/extensions/reference/api/alarms)：最小间隔、调度延迟与设备睡眠行为。
- [Extension service worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)：worker 停止与状态保存。
- [File System Access API](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access)：用户选取、权限、目录访问与文件夹输入回退。
- [NSWorkspace application activation](https://developer.apple.com/documentation/appkit/nsworkspace/didactivateapplicationnotification)：macOS 应用激活通知。
- [Chrome Native Messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging)：扩展与本地辅助程序通信。

## 0.2.0：用户网站列表

`storage.local.websites` 保存归一化域名，缺失时迁移使用三站默认值；空数组表示不监控。匹配采用域名相等或点分隔子域名，支持 HTTP/HTTPS；控制器和消息来源校验共享这一配置。用户目标、项目和鼓励数据结构不变。

新增 `scripting` 及 HTTP/HTTPS 的 `optional_host_permissions`。设置页直接在用户提交手势中请求具体域名权限，控制器再次校验授权后保存。`websites.js` 动态注册持久 content scripts，并注入已打开的授权页面；启动时根据保存配置与实际授权恢复注册。content script 在隔离世界设置单例标记，避免静态/动态/即时注入重复计时。仍仅向网页开放 reminder.html，私有内容通过扩展内部消息校验读取。移除站点立即停止匹配并更新动态注册；保留的旧内容脚本不能通过控制器的站点校验。Chrome 特权页面不支持。
