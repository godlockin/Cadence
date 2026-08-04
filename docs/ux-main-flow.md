# 主线场景 UX 极简审计

## 主线用户故事

作为非技术用户小王,想"每天早上 9 点检查域名是否过期,过期了给我发邮件提醒":

1. 注册/登录 → 2. 点"+ New Task" → 3. 输入名字 → 4. 选触发方式 → 5. 填 cron + 时区 → 6. 选执行内容 → 7. 配置步骤 → 8. 保存 → 9. 看到"下一次触发" → 10. 等 9 点看执行历史

---

## 当前实现的痛点

| 步骤                      | 学习成本 | 卡点                                                           |
| ------------------------- | -------- | -------------------------------------------------------------- |
| 注册                      | 2        | displayName vs username?                                       |
| 登录                      | 1        | OK                                                             |
| 创建任务-入口             | 2        | "+ New Task" 在 sidebar                                        |
| 选 triggerKind            | 3        | "cron/manual/webhook/event" 4选1                               |
| **填 cron**               | **5**    | **致命** — `0 9 * * *` 普通人写不出                            |
| **选时区**                | **4**    | **致命** — 默认 UTC,需手写 Asia/Shanghai                       |
| **选 payloadKind**        | **5**    | **致命** — 5种: pipeline/command/http/script/webhook           |
| **填 payload JSON**       | **5**    | **致命** — 直接 textarea,需写合法 JSON                         |
| **填 triggerConfig JSON** | **5**    | **致命** — 又一个 JSON textarea                                |
| **Pipeline 6 节点**       | **5**    | **致命** — Input/Process/Output 6 个 section,每个 node 配 JSON |
| **保存**                  | 2        | 无"下一步触发"预览                                             |
| **查看执行历史**          | 1        | OK                                                             |

---

## 必卡的 8 个点

### 1. cron 表达式(致命)

```
❌ 当前: Input placeholder="0 9 * * *"
❌ 普通人: "这是什么? 0 是秒吗? 9 是几点?"
✅ 修复: 时间选择器(时/分) + 频率选择(每天/每周/每月)
```

### 2. 时区(致命)

```
❌ 当前: Input placeholder="UTC", 默认 Asia/Shanghai
❌ 普通人: "UTC 是什么? 我在中国该填什么?"
✅ 修复: 自动检测浏览器时区 Intl.DateTimeFormat().resolvedOptions().timeZone
```

### 3. payloadKind 5 选 1(致命)

```
❌ 当前: Select [pipeline, command, http, script, webhook]
❌ 普通人: "我该选哪个? pipeline 是什么?"
✅ 修复: 隐藏,按模板自动设置
```

### 4. JSON payload textarea(致命)

```
❌ 当前: <Textarea className="font-mono" rows={10}>
❌ 普通人: "JSON 是什么? 大括号怎么写?"
✅ 修复: 动态表单(URL / Method / Headers / Body)
```

### 5. JSON triggerConfig textarea(致命)

```
❌ 当前: <Textarea rows={3} className="font-mono">
❌ 普通人: 又一个 JSON, 不知道填什么
✅ 修复: cron 模式下自动生成,无需用户编辑
```

### 6. Pipeline 6 节点(致命)

```
❌ 当前: Input / InputValidate / Process / ResultValidate / PostProcess / Output
❌ 普通人: "我要做一件事,为什么需要 6 个步骤?"
✅ 修复: 默认隐藏,点"展开高级"才显示
```

### 7. Pipeline Node Config JSON(致命)

```
❌ 当前: 每个 node 有 Config (JSON) Input
❌ 普通人: "type=fetch, config 填什么?"
✅ 修复: 表单化(URL / Method / Timeout),不暴露 JSON
```

### 8. 无"下一步触发时间"预览

```
❌ 当前: 保存后看不到"下次 09:00 触发"
❌ 普通人: "我怎么知道设置成功了?"
✅ 修复: 实时预览"下一次: 明天 09:00 (还有 23h)"
```

---

## 重新设计:零学习成本任务创建

### 方案 A: Wizard 4 步(推荐)

```
Step 1: 你想做什么?(模板选择)
┌─────────────────────────────────────────────┐
│  🔔 域名到期提醒                            │
│  📰 RSS 订阅摘要                            │
│  🌐 网站健康检查                            │
│  📧 定时发送邮件                            │
│  ⏰ 自定义...                               │
└─────────────────────────────────────────────┘

Step 2: 什么时候?
┌─────────────────────────────────────────────┐
│  频率: [每天 ▼]                             │
│  时间: [09] : [00]  (当前时区: Asia/Shanghai)│
│  ████ 预览: 下一次触发: 明天 09:00 (23h后)  │
│  [ ] 高级: 自定义 cron 表达式                │
└─────────────────────────────────────────────┘

Step 3: 做什么?
  模板不同,表单不同:

  域名到期提醒:
  ┌─────────────────────────────────────────┐
  │  域名: [________________] [+ 添加更多]   │
  │  检查方式: [Whois 查询 ▼]                │
  │  过期前 [30] 天提醒                      │
  │  通知方式: [邮件 ▼] 收件人: [___________]│
  └─────────────────────────────────────────┘

  网站健康检查:
  ┌─────────────────────────────────────────┐
  │  URL: [https://example.com______________]│
  │  期望状态码: [200]                       │
  │  超时: [10] 秒                           │
  └─────────────────────────────────────────┘

Step 4: 测试 & 保存
┌─────────────────────────────────────────────┐
│  ✓ 配置预览                                 │
│  下一次触发: 明天 09:00 Asia/Shanghai       │
│                                             │
│  [🚀 立即测试]          [💾 保存任务]       │
└─────────────────────────────────────────────┘
```

### 方案 B: 模板库(20+ 预设)

| 模板         | 字段数 | 字段                          |
| ------------ | ------ | ----------------------------- |
| 域名到期提醒 | 3      | 域名列表,提前天数,通知邮箱    |
| 网站健康检查 | 2      | URL,期望状态码                |
| RSS 摘要     | 3      | Feed URL,关键词过滤,发送时间  |
| 定时邮件     | 4      | 收件人,主题,内容模板,发送时间 |
| 数据库备份   | 3      | 连接信息,备份路径,保留份数    |
| 服务器监控   | 4      | 主机,指标,阈值,通知方式       |

### 方案 C: LLM 自然语言(Phase 2)

用户输入:

```
"每天 9 点检查 godaddy.com 域名是否在 30 天内过期,过期了发邮件到 me@example.com"
```

后端 LLM 解析为:

```json
{
  "triggerKind": "cron",
  "cron": "0 9 * * *",
  "timezone": "Asia/Shanghai",
  "payloadKind": "http",
  "payload": { "url": "https://api.godaddy.com/...", "method": "GET" }
}
```

---

## cron 表达式人性化

```typescript
// 前端: 时分选择器 → 后端: cron
function timeToCron(hour: number, minute: number, freq: 'daily' | 'weekly' | 'monthly'): string {
  switch (freq) {
    case 'daily':
      return `${minute} ${hour} * * *`
    case 'weekly':
      return `${minute} ${hour} * * 1` // 周一
    case 'monthly':
      return `${minute} ${hour} 1 * *` // 每月 1 号
  }
}

// 实时预览
const next = cronParser.next().toISOString()
```

---

## Pipeline 6 节点人性化

```typescript
// 普通人模式: 模板选择
type TaskTemplate = 'domain-check' | 'http-monitor' | 'rss-digest' | 'email-notify'

// 每个模板自动配置 6 节点,用户只需填 2-3 个字段
const DOMAIN_CHECK_TEMPLATE: PipelinePayload = {
  input: { nodes: [{ type: 'fetch', config: { url: '${DOMAINS}' } }] },
  inputValidate: { nodes: [{ type: 'condition', config: { ... } }] },
  process: { nodes: [{ type: 'fetch', config: { url: 'whois-api' } }] },
  resultValidate: { nodes: [] },
  postProcess: { nodes: [{ type: 'transform', config: { ... } }] },
  output: { nodes: [{ type: 'action', config: { notify: 'email' } }] },
}
```

---

## 验收清单

- [ ] 普通人能在 3 分钟内创建第一个定时任务
- [ ] cron 表达式对用户不可见(除非点"高级")
- [ ] 所有 JSON textarea 替换为动态表单
- [ ] 时区自动检测,无需手动输入
- [ ] 实时预览"下一步触发时间"
- [ ] "立即测试"按钮在新建/编辑模式都可用
- [ ] Pipeline 6 节点默认折叠,高级用户展开
- [ ] 模板库覆盖 80% 常见场景

---

## 实现优先级

| 优先级 | 改动                     | 工作量 |
| ------ | ------------------------ | ------ |
| P0     | cron 表达式 → 时间选择器 | 中     |
| P0     | 时区自动检测             | 小     |
| P0     | payload JSON → 动态表单  | 大     |
| P1     | 模板库 + Wizard          | 大     |
| P1     | Pipeline 折叠 + 表单化   | 中     |
| P2     | LLM 自然语言(Phase 2)    | 待定   |
