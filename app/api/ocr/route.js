import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 120;

// 接收一页扫描图片(base64 data URL)，调用视觉大模型转写为文字。
export async function POST(req) {
  try {
    const { image, model = 'glm-5v' } = await req.json(); // data:image/png;base64,xxx
    if (!image) return NextResponse.json({ error: '缺少图片' }, { status: 400 });

    // 检查图片大小（Base64 编码后的大小）
    const imageSize = image.length;
    const imageSizeMB = (imageSize / 1024 / 1024).toFixed(2);
    console.log(`[OCR] 图片大小: ${imageSizeMB}MB, 模型: ${model}`);
    
    if (imageSize > 10 * 1024 * 1024) {
      return NextResponse.json({ 
        error: `图片过大 (${imageSizeMB}MB)，请降低 PDF 渲染分辨率` 
      }, { status: 413 });
    }

    // 智谱 GLM 模型配置
    const apiKey = process.env.VISION_API_KEY;
    const modelName = model === 'glm-5v' ? 'glm-5v-turbo' : 'glm-4v-flash';
    const baseUrl = 'https://open.bigmodel.cn/api/paas/v4/chat/completions';
    
    if (!apiKey) {
      console.error('[OCR] 环境变量 VISION_API_KEY 未配置');
      return NextResponse.json({ 
        error: '服务器配置错误：未配置 VISION_API_KEY' 
      }, { status: 500 });
    }

    console.log('[OCR] 环境:', process.env.VERCEL_ENV || 'local');
    console.log('[OCR] 调用视觉模型:', modelName);

    const resp = await fetch(baseUrl, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json', 
        Authorization: 'Bearer ' + apiKey 
      },
      body: JSON.stringify({
        model: modelName,
        messages: [{
          role: 'user',
          content: [
            { 
              type: 'text', 
              text: `请仔细识别这张图片中的所有文字内容，特别注意：
1. 表格中的数字、百分比、金额等数据（如：5.02%、1907万元）
2. 表格的行列结构，用 | 分隔不同列
3. 印章、手写签字、备注等内容
4. 按原排版分行输出

只输出识别的文字，不要任何解释。`
            },
            { type: 'image_url', image_url: { url: image } },
          ],
        }],
        temperature: 0.1,
      }),
    });
    
    if (!resp.ok) {
      const t = await resp.text();
      console.error('[OCR] 视觉模型错误:', resp.status, t);
      return NextResponse.json({ error: `视觉模型 ${resp.status}: ${t.slice(0, 300)}` }, { status: 502 });
    }
    
    const j = await resp.json();
    console.log('[OCR] 响应:', JSON.stringify(j).slice(0, 200));
    const text = j.choices?.[0]?.message?.content || '';
    return NextResponse.json({ text });
  } catch (e) {
    console.error('[OCR] 异常:', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
