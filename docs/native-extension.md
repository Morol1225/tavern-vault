# 原生扩展接口与存储约定

这是浏览器侧 SillyTavern UI 扩展，根入口为 `manifest.json` 和 `index.js`，不依赖酒馆助手或服务端插件。

## 宿主依据与生命周期

接口核对到官方提交 `06bde939fb1e9c4c8d8641d810f0a916b5bce127`，对应版本 1.19.0，不代表用户的实际安装版本。

- [官方扩展指南](https://docs.sillytavern.app/for-contributors/writing-extensions/)：清单、模块与设置。
- [getContext](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/public/scripts/st-context.js)：聊天和事件接口。
- [扩展加载器](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/public/scripts/extensions.js)：清单及钩子。
- [安装接口](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/src/endpoints/extensions.js)：服务端 Git 克隆，浏览器登录不会成为 Git 凭据。

使用 `SillyTavern.getContext()`，从当前 `chat[id].mes` 读取正文，不用旧 swipe 缓存替换当前编辑内容，不执行宏、消息更新或生成接口。聊天/渲染/更新事件用 `eventSource.on` 和 `removeListener` 成对订阅清理，兼容 `eventTypes` 与 `event_types`。MutationObserver 补齐旧楼层按钮。

清单钩子导出 `onActivate / onEnable / onDisable / onDelete`。同步挂接界面，异步尝试恢复目录；禁用、删除和页面离开解除事件、观察器、动画帧和节点，不删除磁盘收藏。设置入口优先 `#extensions_settings2`；自身按钮固定横向显示，不受宿主 min-content 挤压。

## TXT 与集中索引

v0.5.0 的根配置 `tavern-vault.json` 使用格式 2，包含原有库编号、分类、修订号，以及 `entries` 和暂未清理完的 `deleted`。不包含正文副本。每条 `entries` 记录格式为 4：稳定编号、标题、分类、收藏/修改时间、`source` 和 `content`。

`source` 仅保存 `chatId / characterName / messageId`；收藏时间为 `savedAt`。管理界面仅在标题旁显示这四项，不再有来源标签页。编辑时间和哈希仅供内部识别内容变化，界面不堆放宿主版本、消息版本、地址或筛选过程。

正文唯一文件为 `items/<标题>.txt`，正文逐字保存，不附带来源头。`content.originalFile` 是经校验的单个 TXT 文件名；正文哈希和页面标签用于索引，不保存 HTML 字符串或 HTML 路径。预览从 TXT 临时提取 HTML，纯文字预览也在内存中生成。原文视图使用 textContent。

文件名处理沿用 NFC、禁用字符替换、尾部空格/句点和系统保留名处理、长度缩短。重名使用 `(2)` 起的序号；匹配时保守地规范化大小写，不覆盖目录中任何已有名字，包括未登记文件。原文件与类别整理只影响这一份 TXT。

目录句柄沿用 IndexedDB 名称，仅记入口，不缓存正文。数据以外部目录为准，读取已登记 TXT 时重新计算页面及哈希，支持用户外部改写后刷新；陌生 TXT 不自动登记。清单能力契约保持不变：目录选择、安全环境、读写和 removeEntry 必需，IndexedDB 可降级。

## 确认、失败与清理

编辑只有明确确认才写入同一 TXT，createWritable 关闭后重读核对。先写 TXT 再更新集中索引；未保留旧正文副本。若正文已提交而索引更新失败，明确提示这项部分成功状态，重新读取仍能读到 TXT，再次确认可补全记录。新建或改名使用新文件名，索引未提交时只清理本次创建且内容仍匹配的文件。

整理新标题时先写完整新 TXT，再提交文件名索引，最后清理旧名称。旧名称清理要求文件内容哈希仍匹配，且不被活动收藏引用。失败保留明确的待清理信息，可重试，不把已提交内容删除。

删除必须经过界面确认及库编号/打开记录标记检查。先登记待删除操作并从活动列表移除，再删除对应 TXT 或已确认的旧目录；清理成功后清除操作标记，没有回收站或旧版本。根索引写入失败不开始删文件。清理失败时隐藏收藏但保留全局重试按钮，刷新后仍可继续，不丢失清理对象。

同库浏览器操作使用 navigator.locks（可用时）和单实例队列。过期编辑、整理、删除和换库阻止提交；不能承诺阻止不遵守浏览器锁的所有外部程序。

## 旧记录兼容与整理

读取格式 1、2、3 的原编号目录；连接和刷新不迁移。旧记录可继续阅读原存储页面。明确确认“旧收藏整理为 TXT”后，写出原文并登记简要来源，随后删除已识别旧原文、显示副本、页面和归属明确的内容目录。不把快照塞回根 JSON，也不改变原文来夹带它。

转换期间只对本条已验证的目录与已知文件清理，记录目录里的额外文件保留并提示。正文仅在旧快照中存在的显示处理不会再保留。旧记录确认正文修改或新标题后也转为 TXT；单改分类不触发转换。未转换记录可直接确认删除。新版根格式要求 v0.5.0 或以上。

## 隔离预览与真实环境边界

Shadow DOM 管理界面，HTML 使用 `sandbox="allow-scripts"` 的 iframe，不给 same-origin、目录句柄或酒馆写入接口。预览消息仅允许打开编辑草稿或还原阅读区，核对当前窗口、隔离来源和预览标记，不提供保存/删除命令。桥接脚本只在预览生成时加入，不写进 TXT。

标签筛选先提取再排除；缺失、错误配对或空结果停止保存。筛选后不复用旧显示副本，所有预览由过滤后的 TXT 内容生成。

展开仅改变阅读区 CSS 状态，收起辅助栏，保留桌面列表；还原按钮和 Escape 不重建 iframe 或写盘。移动宽度、真实按钮交互和浏览器内部文件系统均有合成检查；实际酒馆安装、外部目录选择/权限恢复和用户体验仍需目标环境验收。
