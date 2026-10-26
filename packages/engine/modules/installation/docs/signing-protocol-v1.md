# Pod 签名协议 v1

`PodSigningProtocol` 将签名字段按下表固定顺序编码为紧凑 UTF-8 JSON。签名和验证入口 MUST 拒绝缺失字段，不能任意序列化调用方 JSON。Pod 产品候选与远程插件目录使用独立的生产信任锚。

| 用途 | `kind` | 签名字段顺序 |
| --- | --- | --- |
| Pod Lite 产品候选 | `lite-product-v1` | `schemaVersion`, `kind`, `id`, `version`, `channel`, `sourceCommit`, `hostUrl`, `hostSha256`, `hostPackageDigest`, `coreUrl`, `coreSha256`, `corePackageDigest`, `creatorProfiles` |
| Pod 插件目录 | `lite-plugin-catalog-v1` | `schemaVersion`, `kind`, `channel`, `generatedAt`, `catalogDigest` |

`schemaVersion` 固定为数字 `1`；`creatorProfiles` 保留声明顺序。发行 URL MUST 为不可变 HTTPS 地址，同一版本 MUST NOT 以不同字节或身份重新发布。目录条目的每个产品身份、Creator 范围、归档摘要与目录包摘要都进入 `catalogDigest`，目录签名不能替代安装前的包文件核验。

信任锚轮换时，可在明确公告的过渡期同时保留当前与下一公钥；发行物必须恰有一个声明的信任锚验证通过。移除旧锚是单独的发布步骤。运行时环境变量不得替代已配置的生产信任锚。

`tests/fixtures/signing-vectors.json` 仅保存公开测试公钥、签名载荷及签名，不含私钥。其中 `cpm-release-v1` 是历史互操作向量，不属于 Pod 当前发行或安装前置。旧 `CpmSigningProtocol` 名称仅作过渡别名；Pod 生产代码调用 `PodSigningProtocol`。后续候选发布脚本会从独立 CPM 签名输入迁出，在此之前不得将旧脚本回执认作自有安装验收。
