# 项目风险识别 AI（Next.js 版）

导入项目过程资料（PDF），自动对照公司**全量风控标准**识别风险。基于 DeepSeek，API Key 放在服务端、不暴露给浏览器。

## 一、首次运行（3 步）

需要先装 [Node.js](https://nodejs.org)（18 以上）。在本文件夹打开终端：

```bash
npm install      # 安装依赖（只需一次）
npm run dev      # 启动
```

然后浏览器打开 http://localhost:3000

## 二、怎么用

1. 填项目名称（可选）
2. 把项目文件夹里的 PDF 拖进去（可多选）
3. 点「识别项目风险」→ 几十秒出结构化报告（高/中/低分级 + 判断依据 + 管控建议），可导出

## 三、维护：加资料 / 改规则（重点）

`参考资料/` 文件夹是 AI 的判断依据（公司风控制度全文）。

- **加新标准**：把文件丢进 `参考资料/` 即可，支持 `.txt`、`.pdf`、`.docx`，**无需改代码**，重启后生效。
- **改规则**：直接编辑 `参考资料/` 里对应的 `.txt`。
- 老格式 `.doc / .docm / .pptx`：请先「另存为」`.docx` 或 `.pdf` 再放入。
- 当前已内置 23 份资料，约 8 万字。

## 四、配置

编辑 `.env.local`：

```
DEEPSEEK_API_KEY=你的key
DEEPSEEK_MODEL=deepseek-chat
MAX_INPUT_CHARS=90000     # 上下文上限保护
```

想换 Kimi/其他兼容模型，改 `DEEPSEEK_BASE_URL` 和 `DEEPSEEK_MODEL` 即可。

## 五、扫描件 OCR（重要）

你的项目 PDF 大多是**扫描件（图片）**，文字提取为 0。程序会自动识别：某 PDF 平均每页文字 < 30 字时，**逐页渲染成图片交给视觉大模型 OCR**，再把识别出的文字交给 DeepSeek 分析。

启用步骤：去 [智谱开放平台](https://open.bigmodel.cn) 注册，拿一个 key，填到 `.env.local` 的 `VISION_API_KEY`。默认模型 `glm-4v-flash` 为**免费档**。

```
VISION_API_KEY=你的智谱key
VISION_MODEL=glm-4v-flash
```

不填则扫描件无法识别（文字版 PDF 不受影响）。

## 六、已知限制

- OCR 逐页调用视觉模型，**扫描件多、页数多时较慢**（每页约 1-3 秒），且印章/手写签字识别可能有误差。
- 单次资料过长会自动截断项目资料部分（参考资料优先保全）；超大项目建议拆分。

## 结构

```
risk-app/
├── 参考资料/            ← 风控标准知识库（你维护这里）
├── app/
│   ├── page.js          前端界面
│   ├── layout.js
│   └── api/analyze/route.js   后端：读参考资料+调DeepSeek
├── lib/loadReference.js  读取参考资料
└── .env.local            key 与配置
```
