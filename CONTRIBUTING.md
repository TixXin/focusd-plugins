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

## 市场上的说明和版本历史

岛屿的插件市场在详情里显示插件的 `README.md` 和 `CHANGELOG.md`（各最多 16 KB，超出部分截掉）。构建索引时先在插件包里找这两个文件；包里没有（例如写进了 `.focusdignore`）时，到你的仓库读 Release 标签处 `path` 文件夹里的同名文件。它们和索引一起签名，跟着版本走：改了说明要发新版本才会更新。

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
| `path` | 可选，插件所在的文件夹（例如 `plugins/clock`），用来找 `README.md` 和 `CHANGELOG.md`；默认是仓库根目录 |
| `domain` | 可选，你的域名（例如 `example.com`），用来成为「已验证」发布者，见下文 |
| `signingKeys` | 可选，你的签名公钥，`npx fly-island-plugin keygen` 打印的 `[{ "keyId", "publicKey" }]`，见下文「作者签名」 |

PR 会自动检查：

- 你是 `repo` 的所有者，或者是其所属组织的**公开**成员；
- 能找到最新 Release 和附件，zip 不超过 20 MB，能通过 `fly-island-plugin validate`，清单的 id、版本与提交和标签一致；
- 检查结果（申请的权限、运行时、是否有自定义网页界面）列在 Actions 的运行摘要里，供审核参考。

检查通过后，维护者会**阅读插件源码**，再合并。合并后一小时内，插件出现在岛屿的插件市场里。

## 已验证发布者

市场在发布者名字旁显示「已验证」，表示这个发布者确实是它的名字所指的组织或个人（不代表插件安全）。两种方式，满足一种即可：

- **GitHub 组织**：组织已经在 GitHub 上验证了域名（组织主页显示 Verified），不用做任何事。
- **自己的域名**：在提交里写 `"domain": "example.com"`，并让 `https://example.com/.well-known/focusd-publisher.json` 返回 `{ "github": "<你的 publisher>" }`（HTTPS，不跳转，不超过 4 KB）。PR 会当场检查。

索引每次构建（每小时）都会重新检查；文件没了或组织不再是已验证状态，标记就会去掉。暂时连不上时保留原来的状态。

## 作者签名

可选，但**只有签了名的插件会在用户的岛屿上自动更新**。岛屿还会记下第一次看到的密钥，之后换了密钥（或去掉签名）的版本要用户在插件市场确认两次才会安装，所以即使你的 GitHub 账号或仓库被盗，攻击者也不能悄悄更新用户装好的插件。

1. 只需一次：`npx fly-island-plugin keygen`，把打印的 `{ keyId, publicKey }` 写进提交的 `"signingKeys": [ ... ]`。**备份私钥**（`~/.fly-island-plugin/signing.key`）。
2. 每次发版：`npx fly-island-plugin pack --sign`，把 `<id>-<version>.zip` 和 `<id>-<version>.zip.sig` 一起附到 Release。
3. 第一次登记 `signingKeys` 的 PR 会检查最新 Release 已经带着用这把密钥做的签名，证明你持有私钥。

登记之后，没有签名或签名不对的新版本**不会上架**，会开一个 `review-needed` issue；维护者写 `approved` 也不能让它上架，只能由作者补上签名。已上架但还没有签名的版本，补上 `.zip.sig` 后下一次构建会给它加上签名。**换密钥**（旧密钥还在）：运行 `npx fly-island-plugin keys rotate`，把它打印的新条目（带 `endorsedBy`，旧密钥的证明）加在 `signingKeys` 里旧密钥的后面，开 PR；CI 会核对证明。合并后用新密钥签名发版，用户的岛屿会自动接受新密钥。旧密钥可以留一段时间再删。**丢了旧密钥**或想停用签名：开 PR 直接换掉或删掉，维护者核实身份后才合并，之后的第一个更新每个用户都要手动确认。

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
   Optional: `path`, the folder of the plugin in the repository, where the market looks for `README.md` / `CHANGELOG.md` when the package leaves them out (shown in the market's details, 16 KB each, fixed per version).
4. Checks run automatically; a maintainer reads the source and merges. The plugin appears in the market within an hour.
   Optional author signing: `npx fly-island-plugin keygen` once and list the printed key as `"signingKeys"`, then `npx fly-island-plugin pack --sign` and attach `<zip>.sig` too. Only signed plugins update by themselves on users' islands, and an update signed by another key waits for each user's confirmation. With `signingKeys`, unsigned versions are never listed, approved or not.
   Optional "verified" mark: a GitHub organization with a verified domain gets it automatically; otherwise list `"domain": "example.com"` and serve `https://example.com/.well-known/focusd-publisher.json` with `{ "github": "<publisher>" }`.
5. New versions: just publish a new release. Updates that ask for new permissions, add a webview page or change the runtime wait for a maintainer, who approves them with `"approved": "<version>"`.
