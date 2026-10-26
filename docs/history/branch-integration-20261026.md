# 分支归并与清理留档

仓库：`peanut-pod-lite`。记录日期：2026-10-26。

用户已授权清理除 QA 外已合并的本地和远端分支，各仓库只保留 `main`；历史留档保存在本文，不创建备份分支或标签。

清理核对基线：`ff75a26ca5f8213c7279afcd9e3981a71c3b4914`。下表各提交均已核实是该 main 的祖先；删除分支名称不会删除这些提交或其文件历史。

## 当前代码与历史实现的边界

普通增量已按此前验收结论合入 main；仅删除已合并分支的名称，不改运行源码或扩大既有产品验收结论。

## 已归并的分支名称与提交

以下为清理前冻结清单，不是仍在使用的分支。`refs/heads/` 表示本地分支，`refs/remotes/origin/` 表示 origin 对应分支。main 本身保留。

| 原分支引用 | 最后提交 | 清理范围 |
| --- | --- | --- |
| `refs/heads/change/add-log-diagnostics-and-viewport-control` | `bc75b522d1a9f3696116d5c07f408dc6a9fdcf91` | 删除已合并分支名称 |
| `refs/heads/change/publish-signed-public-cpm-release-4-3` | `36acb56af736044e214a0c51dce1fd3074cf0af9` | 删除已合并分支名称 |
| `refs/heads/change/receive-actor-http-v1-account-responses` | `ff75a26ca5f8213c7279afcd9e3981a71c3b4914` | 删除已合并分支名称 |
| `refs/heads/change/stabilize-editor-operations-and-bulk-file-io` | `cf0bf8906024a47f3e8a486e891bab9ec25c15e3` | 删除已合并分支名称 |
| `refs/heads/checkpoint/nonqa-clear-20261026-receive-actor-http-v1-account-responses` | `ff75a26ca5f8213c7279afcd9e3981a71c3b4914` | 删除已合并分支名称 |
| `refs/heads/main` | `ff75a26ca5f8213c7279afcd9e3981a71c3b4914` | 保留 main |
| `refs/remotes/origin/change/add-log-diagnostics-and-viewport-control` | `bc75b522d1a9f3696116d5c07f408dc6a9fdcf91` | 删除已合并分支名称 |
| `refs/remotes/origin/change/publish-signed-public-cpm-release` | `0f1c94814c985c95bed3d38d2ac0619d27cd738b` | 删除已合并分支名称 |
| `refs/remotes/origin/change/publish-signed-public-cpm-release-4-3` | `36acb56af736044e214a0c51dce1fd3074cf0af9` | 删除已合并分支名称 |
| `refs/remotes/origin/change/stabilize-editor-operations-and-bulk-file-io-business-logic` | `15925c4d43b089bc5ae8a8399d44122938ab7e92` | 删除已合并分支名称 |
| `refs/remotes/origin/checkpoint/nonqa-clear-20261026-receive-actor-http-v1-account-responses` | `ff75a26ca5f8213c7279afcd9e3981a71c3b4914` | 删除已合并分支名称 |
| `refs/remotes/origin/codex/archive-and-plan-lite-assetdb` | `93c1b135fdf840130fb8a44d35b0bdd0c1b046fa` | 删除已合并分支名称 |
| `refs/remotes/origin/codex/lite-conformance-lumen` | `bed9a53898748f356612175d71718706a766cb51` | 删除已合并分支名称 |
| `refs/remotes/origin/codex/lite-resource-scheduler` | `df2a970a009fe1a0c0e41f81f4f717ca946fc66b` | 删除已合并分支名称 |
| `refs/remotes/origin/codex/plan-signed-cpm-release` | `90269d05644e66a39f7dd86dce80a1b382d6a166` | 删除已合并分支名称 |
| `refs/remotes/origin/codex/plan-single-project-throughput` | `040894638f3a3b6fe1935107b7bb49db42993097` | 删除已合并分支名称 |
| `refs/remotes/origin/feat/preview-start-readiness` | `21b8424ba2ec3f04059e8eb9808b55dc0c1e8127` | 删除已合并分支名称 |
| `refs/remotes/origin/main` | `ff75a26ca5f8213c7279afcd9e3981a71c3b4914` | 保留 main |

## 查看历史

使用上表的完整提交 SHA 查看历史及原文件；无需保留同名分支：

```sh
git show <commit>
git show <commit>:<repository-relative-path>
git log main -- <repository-relative-path>
```

本记录证明历史归并及清理范围，不替代原任务的运行验收。远端分支是否清理完成，以清理后的远端分支列表回读为准；GitHub Actions 未核实。
