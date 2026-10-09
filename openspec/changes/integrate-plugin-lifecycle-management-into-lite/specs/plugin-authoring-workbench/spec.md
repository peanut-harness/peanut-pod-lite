# Spec Delta

## Purpose

为 Lite 用户提供一个可发现、可重复的 Peanut 插件开发入口，使用户能从模板创建插件、校验和打包，并在当前 Creator 工程中安装本地开发包。

## ADDED Requirements

### Requirement: Create a plugin from a supported template
共享插件面板 SHALL 提供创建插件流程，收集插件名称与稳定 ID，生成符合当前 Peanut 插件契约的最小工程；无效或已占用的 ID MUST 在写入前拒绝。

#### Scenario: Create a valid plugin
- **WHEN** 用户填写有效名称、未使用的插件 ID 并选择受支持模板
- **THEN** 系统在用户选择的位置生成可检查的插件源文件，并在面板中显示生成路径和后续打包操作

#### Scenario: Plugin ID is invalid or already used
- **WHEN** 用户提交格式无效或与现有插件冲突的 ID
- **THEN** 系统说明具体冲突且不创建或覆盖任何文件

### Requirement: Validate and package a plugin from the shared panel
共享插件面板 SHALL 能校验本地插件结构、入口、manifest 与包文件，并生成包含版本身份和完整性摘要的 Peanut 目录包；校验失败 MUST 阻止生成可安装包。

#### Scenario: Package a valid plugin
- **WHEN** 用户选择有效插件源并执行打包
- **THEN** 系统生成可由 Lite 安装流程消费的版本化目录包，并展示包 ID、版本、位置和摘要

#### Scenario: Package validation fails
- **WHEN** manifest、入口、文件布局或完整性校验失败
- **THEN** 系统列出稳定的诊断结果，不将失败产物登记为可安装包

### Requirement: Install a locally created or selected package
共享插件面板 SHALL 支持将本地创建或用户明确选择的 Peanut 目录包安装到当前工程，并在写入前展示包身份、版本和操作类型；失败时 MUST 保持已生效版本可用。

#### Scenario: Install a local development package
- **WHEN** 用户选择校验通过的本地包并确认安装
- **THEN** 系统安装到当前工程的 Peanut 插件目录并在插件列表中显示活动版本

#### Scenario: Local package is invalid
- **WHEN** 用户选择缺少必需清单、文件摘要不符或格式不支持的包
- **THEN** 系统拒绝安装，保留现有活动版本并显示可操作的错误信息
