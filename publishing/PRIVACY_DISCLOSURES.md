# Chrome Web Store privacy declarations

## Single purpose

帮助用户控制在自行选择的网站上的浏览时间，并在达到自定时间后，用用户保存的目标、项目片段或鼓励内容提醒用户把注意力带回当前目标。

## Permission justifications

### storage

在本机保存用户主动填写的目标、提醒间隔、网站列表、项目文本片段和鼓励内容，并保存当前浏览计时状态。数据不使用同步存储，不发送到开发者或第三方服务器。

### alarms

定期唤醒扩展后台服务，检查当前浏览状态并更新累计时间。Chrome 可能暂停后台 service worker，因此需要 alarms 保持提醒功能持续工作。

### idle

判断设备是否处于空闲或锁屏状态。用户离开设备时暂停累计时间，避免把无人使用电脑的时间算成浏览时间。

### scripting

用户在设置页主动添加网站并授予对应网站权限后，动态注册或移除该网站的内容脚本。内容脚本只读取页面可见性、窗口焦点以及视频是否正常播放，并负责显示扩展自己的提醒 iframe。

### Required host permissions

访问 YouTube、哔哩哔哩和小红书，用于默认的网站计时功能以及在达到时间后显示提醒。扩展不读取页面正文、账号资料、表单内容、Cookie 或网络请求。

### Optional host permissions

允许用户自行添加其他 HTTP 或 HTTPS 网站。扩展仅在用户点击“保存网站列表”时，针对用户填写的具体域名调用 Chrome 权限请求；不会在安装时申请所有网站访问权，也不会在未经用户操作时扩大访问范围。

## Data usage selections

Declare the following data types because Chrome requires disclosure even when processing remains local:

- Web history: the active tab URL/domain is checked to determine whether the current site is on the user's reminder list.
- User activity: foreground state, page visibility, device idle state, elapsed browsing time, and whether a visible video is playing.
- User-provided content: goals, selected local project text snippets, reminder-site domains, and encouragement links/excerpts.

The extension does not collect personally identifiable information, authentication information, financial information, health information, personal communications, precise location, or website page content.

Certifications:

- Data is used only to provide the extension's stated attention-reminder feature.
- No user data is sold or transferred to third parties.
- No user data is used for advertising, creditworthiness, or unrelated purposes.
- No human reads user data.
- All handled data remains on the user's device in Chrome extension storage.
