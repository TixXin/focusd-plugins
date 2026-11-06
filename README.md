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
| `Check submission` | 每个 PR | 只读权限、没有密钥。检查提交格式、所有权，下载并校验插件包，扫描包里遗留的密钥（`scripts/lib/secrets.mjs`），把权限等信息写进运行摘要 |
| `Update index` | 每小时、`main` 变化时、手动 | 找出每个插件的最新 Release，校验后更新 `index.json`，用 `release` 环境里的密钥签名并提交 |

- 已上架的版本不会重新下载，也不会改变。
- 新版本申请更多权限、加入 webview 页面或换了运行时，不会自动上架，而是开一个 `review-needed` issue；维护者审核后在 `plugins/<id>.json` 写 `"approved": "<版本>"`。
- 官方插件（发布者 `TixXin`）可以用 `"package"` 指定固定的下载地址，更新时由维护者改这个地址（岛屿仓库里 `pnpm plugins:index` 打好新包后，把这里的地址改成新 zip）。作者签名取地址加 `.sig`（`pnpm plugins:index` 一起写出），用官方作者密钥 `0c663505c8e1d524` 签名。
- 已验证发布者：每次构建检查 GitHub 组织的 `is_verified`，或提交里 `domain` 的 `https://<domain>/.well-known/focusd-publisher.json`；通过时条目带 `"verified": { "via": "github" }` 或 `{ "via": "domain", "domain": "..." }`，检查失败（网络问题）时保留原状态。官方发布者不检查。
- 提交写了 `signingKeys` 的插件只收录作者签了名的版本（Release 里的 `<zip>.sig`），签名和作者公钥写进索引条目的 `authorSignature`、`authorKeys`，由岛屿校验。见 [CONTRIBUTING.md](CONTRIBUTING.md#作者签名)。
- 市场详情里的说明和版本历史取自插件包里的 `README.md` / `CHANGELOG.md`，包里没有时取插件仓库 Release 标签处（官方插件为默认分支）`path` 文件夹里的同名文件。
- 切换到本仓库之前发布的岛屿仍然读岛屿仓库 `plugins/index.json`（旧密钥签名，只含官方插件），那份索引在岛屿仓库里继续维护。

## 维护者

- 签名私钥只存在 `release` 环境的 secret `FOCUSD_PLUGIN_SIGNING_KEY` 里，该环境只允许 `main` 分支使用。
- 换密钥：先在岛屿的 `plugins/signing-keys.json` 加入新公钥并发布岛屿新版本，再更新这里的 `keys/trusted.json` 和 secret。
- 下架：在 `revoked.json` 加一项 `{ "id", "versions": "*" | ["1.2.0"], "reason": { "zh-CN", "en" }, "action": "disable" | "uninstall" }`，合并后 CI 会重新签名。
- 本地检查：`npm ci && npm test && node scripts/sign.mjs --check`。
