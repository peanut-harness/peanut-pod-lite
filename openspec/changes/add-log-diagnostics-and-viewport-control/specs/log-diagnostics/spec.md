## Purpose

为当前绑定的 Creator 工程提供可分页、有容量边界且保留原始错误上下文的日志诊断能力，让 AI 能辨别观测范围、日志代次变化及读取失败，并且不会把搜索结果误用作工程验收。

## ADDED Requirements

### Requirement: Bounded project log observation
系统 SHALL 仅查询当前绑定工程的 project.log，以 tail、delta、search 提供有界结果、续读游标、来源与完整性字段；默认最多100条和64KiB返回、每次最多扫描1MiB。

#### Scenario: Large log and keyword context
- **GIVEN** 当前工程日志超过扫描上限并包含中文、多行堆栈
- **WHEN** AI 查询关键词及前后各2行上下文
- **THEN** 保留原文、返回不超过容量边界、标记截断并提供续读游标，不宣称工程验收通过

#### Scenario: Missing or unreadable log
- **WHEN** 日志不存在或无法读取
- **THEN** 返回不同于空日志成功的结构化失败，不允许传任意文件路径替代

### Requirement: Generation-bound safe continuation
系统 SHALL 验证游标的工程、日志代次及偏移，检测轮转、清空和替换，保护 UTF-8 字符与未完成行的连续读取。

#### Scenario: Append and rotation
- **GIVEN** 已读取日志且取得游标
- **WHEN** 日志追加、轮转或替换后继续读取
- **THEN** 追加按序返回；失效游标明确标记resetDetected并要求重新开始，不静默遗漏数据

#### Scenario: Partial line
- **WHEN** 尾部包含未完成行或UTF-8字符
- **THEN** 增量游标保留该片段，补全后可读取且不产生损坏字符
