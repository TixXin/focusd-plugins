# focusd-plugins

[FocuSD Island](https://github.com/TixXin/fly-island) 插件市场的索引仓库。The plugin market index of FocuSD Island.

- **提交插件 / Submit a plugin**：见 [CONTRIBUTING.md](CONTRIBUTING.md)。
- **报告插件问题 / Report a plugin**：[开一个 issue](../../issues/new/choose)。

## 仓库结构

```text
plugins/<id>.json          作者提交：插件仓库、发布者、分类
index.json / index.json.sig       CI 生成并签名，不接受手工修改
revoked.json / revoked.json.sig   下架名单（维护者修改，CI 签名）
keys/trusted.json          岛屿信任的签名公钥（与岛屿仓库的 plugins/signing-keys.json 一致）
scripts/                   索引构建、PR 检查、签名
```

## 工作方式

| 工作流 | 触发 | 做什么 |
|---|---|---|
| `Check submission` | 每个 PR | 只读权限、没有密钥。检查提交格式、所有权，下载并校验插件包，把权限等信息写进运行摘要 |
| `Update index` | 每小时、`main` 变化时、手动 | 找出每个插件的最新 Release，校验后更新 `index.json`，用 `release` 环境里的密钥签名并提交 |

- 已上架的版本不会重新下载，也不会改变。
- 新版本申请更多权限、加入 webview 页面或换了运行时，不会自动上架，而是开一个 `review-needed` issue；维护者审核后在 `plugins/<id>.json` 写 `"approved": "<版本>"`。
- 官方插件（发布者 `TixXin`）可以用 `"package"` 指定固定的下载地址，更新时由维护者改这个地址。

## 维护者

- 签名私钥只存在 `release` 环境的 secret `FOCUSD_PLUGIN_SIGNING_KEY` 里，该环境只允许 `main` 分支使用。
- 换密钥：先在岛屿的 `plugins/signing-keys.json` 加入新公钥并发布岛屿新版本，再更新这里的 `keys/trusted.json` 和 secret。
- 下架：在 `revoked.json` 加一项 `{ "id", "versions": "*" | ["1.2.0"], "reason": { "zh-CN", "en" }, "action": "disable" | "uninstall" }`，合并后 CI 会重新签名。
- 本地检查：`npm ci && npm test && node scripts/sign.mjs --check`。
