# Rules

规则源是 `webroot-src/data/options.json`。

构建时会生成：

- `webroot/data/options.json`
- `webroot/data/rule-props.tsv`
- `webroot/data/rule-conflicts.json`

同一个 prop 只能有一个最终 owner。冲突解析优先选择非危险档中的最低风险规则，危险档重复项只作为被遮蔽候选保留解释信息。

危险档规则在自动生成和默认配置中强制关闭，只有 WebUI 完成危险模式解锁后才允许进入保存作用域。

