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

禁用、删除和页面离开会解除事件、观察器、待执行的动画帧及界面节点。重复启动先销毁旧实例。不会在这些操作中删除、重置或上传磁盘收藏。目录记忆沿用原版本的 IndexedDB 名称，收藏数据格式继续为 schema 1；旧收藏不自动改写。

`capability-contract.json` 列出所需能力。运行时检查宿主接口，选择文件夹时检查安全环境和 `showDirectoryPicker`。没有用户真实环境快照，尚未执行“已安装环境能力通过”的判定。

## HTML 和筛选

管理界面使用独立 Shadow DOM，收藏 HTML 用 `sandbox="allow-scripts"` 的 iframe，没有 `allow-same-origin`、目录句柄或酒馆写入接口。页面自身仍可按原代码请求外部资源；隔离预览不等于完整离线。

筛选基于源文本，先找配对的提取标签，再合并排除范围。未找到提取标签、配对错误、结果为空均阻止保存。生效后不复用原显示快照或页面，而是从过滤后的原文重新生成所有副本；规则写入 `source.selection`。测试同时检查原文、快照、页面和元数据中不存在排除标记。

## 仍需真实酒馆检查

在获授权的目标酒馆确认版本、扩展管理器安装、刷新加载、楼层按钮、禁用/启用、外部电脑文件夹选择与授权、重开后读取、实际角色卡 HTML 与主题兼容。合成预览、静态清单校验和浏览器内部文件读写均不替代这些项目。
