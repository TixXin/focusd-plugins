# 提交插件 / Submitting a plugin

FocuSD Island 的插件市场从这个仓库读取 `index.json`。你的插件包放在**你自己仓库的 GitHub Release** 里，这个仓库只记录插件在哪里。

English summary at the end.

## 准备插件

1. 用脚手架创建插件并开发：`npm create fly-island-plugin@latest`（开发说明见 [FocuSD Island 插件文档](https://github.com/TixXin/fly-island/tree/main/docs/plugins)）。
2. 确认通过校验：`npx fly-island-plugin validate`。
3. 打包：`npx fly-island-plugin pack`，得到 `.package/<id>-<version>.zip`。请用这个命令打包：同样的文件总是得到同样的 zip，审核时能重新打包核对。
4. 在你的仓库发布 GitHub Release：
   - 标签是清单里的 `version`，可以带 `v`，例如 `v1.2.0` 或 `1.2.0`；
   - 附件是第 3 步的 `<id>-<version>.zip`，文件名不能改；
   - 不要标成 Draft；标成 Pre-release 的版本只在提交里写了 `"preRelease": true` 时才会收录。

一个仓库里放了多个插件时，给标签加前缀（例如 `clock-v1.2.0`），并在提交里写 `"tagPrefix": "clock-"`。

## 第一次提交

向本仓库开 PR，只新增一个文件 `plugins/<插件 id>.json`：

```json
{
  "id": "com.example.clock",
  "repo": "example/focusd-clock",
  "publisher": "example",
  "categories": ["utilities"]
}
```

| 字段 | 说明 |
|---|---|
| `id` | 与清单 `id` 相同，文件名必须是 `<id>.json`。不能包含 `focusd`（官方保留），也不能和已有 id 只差点号或连字符 |
| `repo` | 插件仓库 `owner/name`，必须公开 |
| `publisher` | 仓库所有者（GitHub 用户或组织），市场上显示为发布者 |
| `categories` | 可选：`productivity`、`todos`、`developer`、`media`、`messages`、`information`、`utilities` |
| `preRelease` | 可选，`true` 时收录 Pre-release |
| `tagPrefix` | 可选，标签前缀 |

PR 会自动检查：

- 你是 `repo` 的所有者，或者是其所属组织的**公开**成员；
- 能找到最新 Release 和附件，zip 不超过 20 MB，能通过 `fly-island-plugin validate`，清单的 id、版本与提交和标签一致；
- 检查结果（申请的权限、运行时、是否有自定义网页界面）列在 Actions 的运行摘要里，供审核参考。

检查通过后，维护者会**阅读插件源码**，再合并。合并后一小时内，插件出现在岛屿的插件市场里。

## 发布新版本

在你的仓库发布新的 Release 即可，不需要再开 PR。本仓库每小时检查一次，用同样的规则校验后更新索引。

以下情况新版本**不会自动上架**，会开一个 `review-needed` issue 等维护者审核：

- 申请了新的权限；
- 第一次加入自定义网页界面（webview 页面）；
- 运行时变了（例如从 Node.js 改成 exe）。

审核通过后，维护者在 `plugins/<id>.json` 里写上 `"approved": "<版本>"`，下一次构建就会上架。

已经上架的版本不能替换：同一个版本号的 zip 内容变了会被拒绝，请发新版本号。

## 下架与问题报告

发现插件有问题，请用 issue 模板「报告插件问题」。维护者可以把版本写进 `revoked.json`：已安装的岛屿会在下次刷新市场时停用（`disable`）或卸载（`uninstall`）它。

---

## English summary

1. Build your plugin with `npm create fly-island-plugin@latest`, check it with `npx fly-island-plugin validate`, and pack it with `npx fly-island-plugin pack`.
2. Publish a GitHub release in your repository: tag = manifest `version` (optionally prefixed with `v`), asset = `<id>-<version>.zip`.
3. Open a pull request here that adds only `plugins/<id>.json` (fields above). You must own `repo`, or be a public member of the organization that owns it. Ids containing `focusd` are reserved.
4. Checks run automatically; a maintainer reads the source and merges. The plugin appears in the market within an hour.
5. New versions: just publish a new release. Updates that ask for new permissions, add a webview page or change the runtime wait for a maintainer, who approves them with `"approved": "<version>"`.
