# Cadence 零学习成本实测报告

## 测试人

- 角色: 非技术网店老板,小王,不懂 cron 不懂 JSON
- 任务: 每天 9 点检查域名过期并邮件提醒
- 日期: 2026-08-02

## 实测结果

| 步骤 | 操作                | 用时     | 结果 | 卡点                                               |
| ---- | ------------------- | -------- | ---- | -------------------------------------------------- |
| 1    | 打开 localhost:5173 | 3s       | OK   | 无                                                 |
| 2    | 注册账号            | 45s      | FAIL | 需填 4 个字段(密码要敲两遍),无社交登录             |
| 3    | 登录                | 10s      | OK   | 直接进 dashboard,体验流畅                          |
| 4    | 找 "+ New Task"     | 5s       | OK   | dashboard 有 "+" 按钮                              |
| 5    | 输入任务名          | 5s       | OK   | name 字段在顶部                                    |
| 6    | 选 cron             | **FAIL** | FAIL | cron input placeholder 是 `0 9 * * *`,普通人看不懂 |
| 7    | 选 timezone         | **FAIL** | FAIL | text input placeholder 是 `UTC`,无下拉             |
| 8    | 选 payloadKind      | 8s       | OK   | 下拉可选 http/pipeline/scripted                    |
| 9    | 填 HTTP payload     | **FAIL** | FAIL | Textarea 要求写 JSON,普通人不会写                  |
| 10   | 填 triggerConfig    | **FAIL** | FAIL | 又一个 Textarea,要求 JSON,默认 `{}`                |
| 11   | 保存                | -        | -    | 前置步骤全部卡死                                   |

## 必卡点分析

### 卡点 1: cron 字段 — **BLOCKER**

**现状** (task-form.tsx:310):

```tsx
<Input id="cron" placeholder="0 9 * * *" {...form.register('cron')} />
```

直接暴露原始 cron 表达式。普通人看到 `0 9 * * *` 是一头雾水。

**改造建议**:

- 默认展示为: "每天 9:00 (Asia/Shanghai)"
- 点击后展开可视化选择器:
  - 频率: 每天 / 每周 / 每月 / 自定义
  - 时间: 时分选择器(24h)
  - 星期: 多选 Mon-Sun
  - 时区: 下拉(自动检测浏览器时区作为默认)
- 底层存 cron,UI 只展示自然语言

### 卡点 2: timezone 字段 — **BLOCKER**

**现状** (task-form.tsx:314):

```tsx
<Input id="timezone" placeholder="UTC" {...form.register('timezone')} />
```

text input,无验证,无提示。填 `Asia/Shanghai` 算蒙对,填 `北京时间` 直接报错。

**改造建议**:

- 改为 Select 下拉,默认浏览器时区
- 搜索过滤: 用户敲 "北京" 能找到 "Asia/Shanghai"

### 卡点 3: HTTP payload Textarea — **BLOCKER**

**现状** (task-form.tsx:396-405):

```tsx
<Textarea
  value={payloadText}
  onChange={(e) => setPayloadText(e.target.value)}
  className="min-h-[160px] font-mono text-xs"
/>
```

要求手写 JSON。普通用户:

- 不知道 `{ "url": "..." }` 格式
- 不知道 HTTP 方法、headers、timeout 怎么填
- 不知道 godaddy API 的端点是什么

**改造建议**:

- HTTP 模式下自动展开为表单字段:
  - Method: GET/POST/PUT/DELETE (下拉,默认 GET)
  - URL: text input
  - Headers: key-value 对列表(可增删)
  - Body: textarea(仅 POST/PUT 显示)
  - Timeout: number input(ms,默认 10000)
- 高级模式切换到 Raw JSON 编辑器(带语法高亮)

### 卡点 4: Pipeline 模式 — **BLOCKER x2**

**现状** (pipeline-editor.tsx):

- 6 个阶段: input / inputValidate / process / resultValidate / postProcess / output
- 每个阶段可添加多个 Node,每个 Node 有 type 下拉 + JSON config
- node type 包括: transform / fetch / email / webhook 等(30+种)
- Config 全是 JSON,无表单输入

**改造建议**:

- 提供任务模板选择器,覆盖 80% 场景:
  - "定时 HTTP GET"
  - "定时检查域名过期"
  - "定时发邮件"
  - "定时 POST 数据"
- 模板直接渲染为简化的 3 步表单(来源/处理/目标)
- Pipeline 模式保留给高级用户,但默认折叠所有中间阶段

### 卡点 5: triggerConfig Textarea — **BLOCKER**

**现状** (task-form.tsx:372-380):

```tsx
<Textarea value={triggerText} onChange={(e) => setTriggerText(e.target.value)} rows={3} />
```

默认 `{}`,要求 JSON object。普通人不知道这是什么。

**改造建议**:

- 移除此字段,triggerKind 切换时自动生成对应 triggerConfig
- cron 时: `{}` 自动生效
- manual 时: 无 triggerConfig
- interval 时: 显示间隔输入(数字 + 单位下拉:秒/分/时)

## 改造优先级

| 优先级 | 改动                               | 复杂度 | 影响              |
| ------ | ---------------------------------- | ------ | ----------------- |
| P0     | cron input → 自然语言 + 时间选择器 | 高     | 解除最大 BLOCKER  |
| P0     | timezone input → Select 下拉       | 低     | 解除输入错误      |
| P0     | HTTP payload textarea → 表单字段   | 中     | 解除 80% 用户卡死 |
| P1     | triggerConfig textarea → 自动生成  | 低     | 移除无效字段      |
| P2     | Pipeline 模板选择器                | 中     | 覆盖 80% 场景     |
| P2     | Pipeline 6 阶段默认折叠            | 低     | 降低认知负担      |

## 验收标准

- [ ] cron 字段: 无需文档,5 秒内填好
- [ ] timezone 字段: 下拉选,无手填
- [ ] HTTP payload: 表单填,无 JSON
- [ ] triggerConfig: 用户无感知
- [ ] 整条主线 < 5 分钟

## 结论

**当前状态: 不可用。**

非技术用户到步骤 6(cron 字段)直接卡死,无法完成"每天 9 点检查域名"这个最基本任务。

改造后预期: P0 改完后,主线可达 3 分钟以内。
