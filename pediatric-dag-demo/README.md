# ClinGraph v4.1 · 口腔科 Q1–Q13 问答式 DAG

这是一套**完整、零 npm 依赖**的口腔科诊断知识图工作台，实现 ClinGraph v4.1 的三栏布局、医生–Agent 对话、Question/Choice/Outcome 三类可视节点、Evidence 属性编辑、增量 Patch 审核、撤销/重做、导入/导出与缩放操作。

> 这次使用用户提供的 **原始口腔科 Q1–Q13 JSON**，而不再使用儿科 4 Question/8 Outcome 默认图。初始数据位于 `data/oral_original.json`，原始字段 `root / evidence_status / source / nodes / choices / next / evidence` 保留。

## 1. Ubuntu 安装与运行

推荐先备份旧工程，在旧版网页中点击 **「导出 JSON」** 备份历史修改。

```bash
cd ~/DAG_generate/demo
cp -a pediatric-dag-demo pediatric-dag-demo-v4.1-backup
unzip -o "$HOME/Downloads/ClinGraph_v4.1_口腔科DAG_完整工程.zip" -d "$HOME/DAG_generate/demo"
cd pediatric-dag-demo
node standalone/server.mjs
```

随后打开 **http://localhost:3001**，按 **Ctrl+Shift+R** 强制刷新。无需 `npm install`。也可执行 `npm start` / `./start.sh`。

**旧 `.env` 兼容**：压缩包不包含 `.env`，如果你原来已经在项目中设置了阿里云百炼 API Key，覆盖解压不会删除或覆盖该文件。

如果想重新配置，复制 `.env.example` 为 `.env`，设置：

```ini
OPENAI_API_KEY=sk-替换为你的真实密钥
OPENAI_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
OPENAI_MODEL=qwen-plus
PORT=3001
```

也可使用早期的 `LLM_API_KEY`、`LLM_API_HOST`、`LLM_MODEL` 变量。服务器将 API Key 保存在后端，不返回浏览器。状态显示已配置 Key 并不保证模型实际可调用，首次发送需验证权限/网络。

## 2. 与此前 v4.1 的关键兼容点

- **不同 Question 的 Choice ID 可以相同**：`Q1/a1`、`Q2/a1`、`Q9/a1` 分别作为独立图节点，并用复合 ID `c:Q1:a1` 定位，不互相覆盖。
- **原始 JSON 不需要 `type` 字段**：`nodes` 只包含 Question；Outcome 从 choice.next 的疾病名称推导，并共享同一个 Outcome 节点。多条 Choice 可以汇合到同一个疾病。导出继续沿用口腔版 JSON 结构。
- **数据统计**：13 个 Question、32 个 Choice、15 个不同 Outcome，共 60 个可视节点、64 条连线。
- **医学证据**：`evidence` 是 Choice 的临床线索关键词；不显示在图上，仅在节点详情编辑，不重复显示 Evidence 标签列表。
- **修改图**：医生能编辑问题、Choice 回答、Evidence、Next、医学备注；可以新增 Choice、Question、Outcome、插入临床问题及重连分支。新的未决 Choice 允许 `next: null` 草稿。
- **Agent**：`局部编辑(Patch)` / `知识缺口检查(Audit)` / `整图生成(Generate)`；所有 Agent 改动只产生候选，经过服务端结构校验并由医生点击确认才实际写入。
- **快捷按钮**：给 Question 加 Choice、在 Choice 后插入问题、补 Evidence、增加疾病、优化节点、检查知识缺口。
- **避免无效链接**：模型新增 Choice 时误指向尚未创建的 Q14，系统会先将该 Choice 的 next 改为 null，并明确提示；已经存在的分支则不能静默修改。

## 3. 网页交互

- 鼠标在 DAG 区域：**Ctrl+滚轮** 缩放 DAG；普通滚轮自然上下滚动；拖动空白处平移。
- 顶部「收起对话」「收起详情」「专注 DAG」动态扩展画布；「显示全图」适配全图；「适配宽度」优先保证可读性。
- 顶部「⌕ 定位节点」可直接找到某个 Question、Choice 或 Outcome，并自动放大到方便阅读的大小。
- 点击一个 **Choice**，右侧即可编辑 Choice 文本、下游 Next、Evidence（每行一个）和医学备注；不会再展示重复 Evidence 小标签。
- 点击一个 **Outcome**，切换右侧「路径与变更」查看从 Q1 到该疾病的不同路径。
- 点击「恢复原始 Q1–Q13」可恢复默认口腔科图；在当前浏览器可撤销。如果旧浏览器仍显示儿科图，注意新版使用不同的 localStorage 键，不会自动读取儿科历史图。
- 当前口腔科编辑存在浏览器 localStorage 中，**与旧儿科数据隔离**。请定期点击「导出 JSON」备份；清理浏览器数据会清空未导出的修改。

## 4. 文件与接口

- `data/oral_original.json`：用户提供的原始口腔科 JSON（不增加红色新节点）。
- `server/oral-dag.mjs`：复合 Choice ID、图结构校验、Patch、离线演示。
- `standalone/server.mjs`：HTTP 服务与 OpenAI 兼容 LLM API（百炼可用）。
- `standalone/index.html`, `app.css`, `app.js`：v4.1 口腔科 Web UI。
- `tests/oral-dag.test.mjs`：回归测试。
- `GET /api/bootstrap`：原始口腔图，`GET /api/status`：模型配置状态。
- `POST /api/validate`：验证导入图；`POST /api/patch/preview`：安全的候选修改预演；`POST /api/agent`：三种模型模式。

## 5. 启动后的推荐验证

1. 右上角应显示 `13 Question · 32 Choice · 15 Outcome`。
2. 通过定位框找到 `Q8 · a2`，点开后应看见四条 Evidence：触碰刺激痛、食物刺激痛、冷热刺激痛、敏感发酸。
3. 点开 `Q2 · a1`，应看见智齿问题相关的三个 Evidence；不能错误显示 Q8 的 `a1`。
4. 点开 `急性牙髓炎` Outcome → 「路径与变更」应列出 **Q9/a2 与 Q9/a3** 两条入路。
5. 选中 `Q2`，点击「给 Question 加 Choice」，应产生待确认的 `Q2/a3`，不影响其他 Question 的 `a3`。

## 6. 运行测试

```bash
npm test
```

**注意**：这份口腔科 DAG 是你提供的医学知识原文，程序不会自动验证其临床准确性。新增内容及模型建议应由医生确认，本工具不用于患者个体诊疗决策。
