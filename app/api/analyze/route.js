import { NextResponse } from 'next/server';
import { loadReference } from '../../../lib/loadReference';

export const runtime = 'nodejs';
export const maxDuration = 120;

const SYSTEM = `你是中国移动数智工程/政企项目的资深合规风控专家。
你将拿到两部分内容：
（A）《风控参考资料》——这是公司全部风险防控制度、判定标准、负面清单的原文，是你判断风险的唯一依据；
（B）《待识别项目资料》——某个具体项目的过程资料（立项、甄选、投标、评审、资金、合同等）。

请严格对照（A）中的标准，逐条审查（B）项目资料，识别其中存在或可能存在的风险点。
要求：
1. 判断依据必须引用（A）参考资料里的具体条款/标准，以及（B）项目资料里的具体事实，二者对照说明。
2. 不要泛泛而谈，只输出真正有依据的风险；资料不足以判断但属高敏感项的，标为「待核实」并说明需补充什么材料。
3. 覆盖维度：虚假项目/虚增收入、空转走单、效益异常(净额毛利率<5%升级、<3%禁做)、转包及违法分包、资金落实/客户信用、供应商履约、决策流程与层级、异地项目、投标合规(造假/围标串标)、合同条款、预付款及资金"严禁"清单、虚假贸易、政企负面清单、廉洁法律等。

【输出格式】严格只输出 JSON，无任何额外文字或 markdown 代码块标记：
{"summary":"整体风险概述2-3句","risks":[{"title":"风险点标题","category":"所属阶段/类别","level":"高|中|低","basis":"判断依据：引用参考资料条款 + 项目资料事实，对照说明","suggestion":"管控建议"}]}
按风险等级 高→中→低 排序。`;

function stripJSON(s) {
  s = s.trim().replace(/^```json/i, '').replace(/^```/, '').replace(/```$/, '').trim();
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a >= 0 && b >= 0) s = s.slice(a, b + 1);
  return JSON.parse(s);
}

export async function POST(req) {
  try {
    const { projectName, documents } = await req.json(); // documents: [{name,text}]
    if (!documents || !documents.length) {
      return NextResponse.json({ error: '未收到项目资料文本' }, { status: 400 });
    }

    // 1) 载入全量参考资料
    const refs = await loadReference();
    const refText = refs.map(r => `【参考资料：${r.name}】\n${r.text}`).join('\n\n');

    // 2) 项目资料
    let projText = documents.map(d => `【项目文件：${d.name}】\n${d.text}`).join('\n\n');

    // 3) 上下文长度保护：参考资料优先，项目资料超出部分截断
    const MAX = parseInt(process.env.MAX_INPUT_CHARS || '90000', 10);
    let truncated = false;
    const budgetForProj = Math.max(8000, MAX - refText.length);
    if (projText.length > budgetForProj) {
      projText = projText.slice(0, budgetForProj) + '\n…（项目资料过长，已截断。如需完整分析请拆分项目或启用分块识别）';
      truncated = true;
    }

    const userContent =
      `==================== A. 风控参考资料（判断依据）====================\n${refText}\n\n` +
      `==================== B. 待识别项目资料：${projectName || '未命名项目'} ====================\n${projText}`;

    // 4) 调用 DeepSeek（服务端，key 不暴露）
    const deepseekKey = process.env.DEEPSEEK_API_KEY;
    const deepseekModel = 'deepseek-chat';
    const deepseekUrl = 'https://api.deepseek.com/v1/chat/completions';
    
    if (!deepseekKey) {
      return NextResponse.json({ error: '服务器配置错误：未配置 DEEPSEEK_API_KEY' }, { status: 500 });
    }

    const resp = await fetch(deepseekUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + deepseekKey,
      },
      body: JSON.stringify({
        model: deepseekModel,
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: userContent },
        ],
        temperature: 0.2,
        max_tokens: 8000,
        stream: false,
      }),
    });

    if (!resp.ok) {
      const t = await resp.text();
      return NextResponse.json({ error: `DeepSeek 接口 ${resp.status}: ${t.slice(0, 400)}` }, { status: 502 });
    }
    const j = await resp.json();
    const raw = j.choices?.[0]?.message?.content || '';
    let data;
    try { data = stripJSON(raw); }
    catch (e) { return NextResponse.json({ error: 'AI 返回解析失败', raw }, { status: 500 }); }

    return NextResponse.json({
      ...data,
      meta: {
        refCount: refs.length,
        refChars: refText.length,
        projChars: projText.length,
        truncated,
        usage: j.usage || null,
      },
    });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
