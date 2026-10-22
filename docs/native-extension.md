# 原生扩展接口与兼容边界

本项目是浏览器侧 UI 扩展，入口为根目录 `manifest.json` 和 `index.js`，无需酒馆助手、服务端插件或外部打包运行时。

## 依据

接口核对到 SillyTavern 官方提交 `06bde939fb1e9c4c8d8641d810f0a916b5bce127`，该提交的 `package.json` 版本为 **1.19.0**。它是本次声明的版本下限与源码依据，不代表用户安装的实际版本，也不证明所有更高版本均兼容。

- [官方扩展指南](https://docs.sillytavern.app/for-contributors/writing-extensions/)：扩展清单、ES 模块、生命周期、设置区域。
- [官方 getContext 源码](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/public/scripts/st-context.js)：聊天、角色、群组、事件源和事件名称。
- [官方扩展加载器](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/public/scripts/extensions.js)：加载入口及调用清单声明的钩子。
- [官方服务端安装接口](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/src/endpoints/extensions.js)：服务器通过 HTTP(S) 仓库地址执行 Git 克隆；浏览器 GitHub 登录状态不会传递为服务器 Git 凭据。

## 使用的接口

`SillyTavern.getContext()` 提供当前聊天和事件。采集读取 `context.chat[id].mes`，消息版本记录 `swipe_id`，避免把编辑后的当前正文替换成旧的 swipe 缓存。不调用显示变换、宏、消息更新或生成接口。

事件通过 `eventSource.on` 订阅，以 `removeListener` 清理。优先用 `eventTypes`，兼容官方仍保留的 `event_types`。使用聊天切换、消息渲染/更新/切换和旧楼加载事件；DOM 变化也会补齐已显示楼层的按钮。楼层选择器为 `#chat .mes[mesid]`、`.mes_text`、`.mes_buttons`，缺少该位置时仍可从独立窗口按编号收藏。实际主题和 DOM 变动须在目标酒馆确认。

扩展设置入口优先放入 `#extensions_settings2`，其次 `#extensions_settings`；同时保留浮动入口。

## 生命周期与本地数据

清单中的 `activate / enable / disable / delete` 对应导出的 `onActivate / onEnable / onDisable / onDelete`。启动的同步部分挂接界面和监听；目录恢复异步进行，不等待文件系统操作完成才返回激活钩子。

禁用、删除和页面离开会解除事件、观察器、待执行的动画帧及界面节点。重复启动先销毁旧实例。不会在这些操作中删除、重置或上传磁盘收藏。目录记忆沿用原版本的 IndexedDB 名称，收藏库根配置仍为 schema 1；未编辑的旧收藏不自动改写。v0.3.0 编辑提交后的单条记录使用 schema 2，`content.storageId` 指向该条当前内容集，旧版不能读取这类记录。

`capability-contract.json` 列出所需能力。运行时检查宿主接口，选择文件夹时检查安全环境和 `showDirectoryPicker`。没有用户真实环境快照，尚未执行“已安装环境能力通过”的判定。

## HTML 和筛选

管理界面使用独立 Shadow DOM，收藏 HTML 用 `sandbox="allow-scripts"` 的 iframe，没有 `allow-same-origin`、目录句柄或酒馆写入接口。页面自身仍可按原代码请求外部资源；隔离预览不等于完整离线。

筛选基于源文本，先找配对的提取标签，再合并排除范围。未找到提取标签、配对错误、结果为空均阻止保存。生效后不复用原显示快照或页面，而是从过滤后的原文重新生成所有副本；规则写入 `source.selection`。测试同时检查原文、快照、页面和元数据中不存在排除标记。

## 仍需真实酒馆检查

在获授权的目标酒馆确认版本、扩展管理器安装、刷新加载、楼层按钮、禁用/启用、外部电脑文件夹选择与授权、重开后读取、实际角色卡 HTML 与主题兼容。合成预览、静态清单校验和浏览器内部文件读写均不替代这些项目。

## 内容编辑与本地提交

双击列表、标题、原文或 HTML 正文可打开草稿；也有明确的编辑按钮。页面端可发送“请求打开编辑栏”或“按 Escape 还原阅读区”的消息，接收方检查当前 iframe 窗口、隔离来源和本次预览标记。消息不携带文件句柄，不提供保存命令，写盘仍需用户点击“确认保存到本地”。桥接脚本只在预览时加入，不写入收藏原文或页面文件。

未确认时编辑内容只存在内存中，关闭即丢弃。确认后先写入并逐文件核对一个完整内容集，再通过关闭 `entry.json` 的写入流切换引用。已有来源、收藏编号、分类和 savedAt 保留；记录 editedAt。按用户要求不保留历史：随后清理原文件和工具拥有的旧内容目录。未知文件夹和不属于工具的文件不会被当作版本清理。

提交前比对打开编辑栏时的内容标记、收藏库编号和磁盘原文哈希。过期编辑、换库或原文被外部改写会停止写入；不承诺阻止所有绕过浏览器锁的外部程序并发。提交状态无法核实时保留文件并提示重新读取；新内容提交成功但清理失败则返回明确的待清理状态，用户可重试。没有自动备份、历史浏览或撤销入口。

相关浏览器依据：[关闭写入流后才更新文件](https://developer.mozilla.org/en-US/docs/Web/API/FileSystemFileHandle/createWritable)、[目录条目清理](https://developer.mozilla.org/en-US/docs/Web/API/FileSystemDirectoryHandle/removeEntry)、[跨窗口消息来源和目标](https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage)。这些资料说明接口语义，实际外部文件夹仍需在用户环境中验证。

## 正文展开布局

v0.3.2 的展开只改变阅读区的展示状态：收起阅读头部与工具、让正文和 iframe 占满右侧区域，桌面分类和列表保留。悬浮还原按钮保持可见；原文视图的 Escape 在宿主内处理，隔离 HTML 页的 Escape 经同一来源/窗口/预览标记校验后仅请求还原。该请求不携带保存数据或目录接口。

切换使用 CSS 展示状态和焦点管理，不重建 iframe、不重新运行页面脚本，也不更新磁盘内容。无选中记录、关闭窗口或返回列表时清理展开状态。页面自身的宽度及排版不被重写。
