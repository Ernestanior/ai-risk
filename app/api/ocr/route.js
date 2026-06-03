import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 120;

// Vercel 配置：增加请求体大小限制
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
};

// 接收一页扫描图片(base64 data URL)，调用视觉大模型转写为文字。
export async function POST(req) {
  try {
    const { image } = await req.json(); // data:image/png;base64,xxx
    if (!image) return NextResponse.json({ error: '缺少图片' }, { status: 400 });

    // 检查图片大小（Base64 编码后的大小）
    const imageSize = image.length;
    const imageSizeMB = (imageSize / 1024 / 1024).toFixed(2);
    console.log(`[OCR] 图片大小: ${imageSizeMB}MB`);
    
    if (imageSize > 10 * 1024 * 1024) {
      return NextResponse.json({ 
        error: `图片过大 (${imageSizeMB}MB)，请降低 PDF 渲染分辨率` 
      }, { status: 413 });
    }

    const base = process.env.VISION_BASE_URL || 'https://open.bigmodel.cn/api/paas/v4/chat/completions';
    const key = process.env.VISION_API_KEY;
    const model = process.env.VISION_MODEL || 'glm-4v-plus';
    
    if (!key) {
      console.error('[OCR] 环境变量 VISION_API_KEY 未配置');
      return NextResponse.json({ 
        error: '服务器配置错误：未配置 VISION_API_KEY' 
      }, { status: 500 });
    }

    console.log('[OCR] 环境:', process.env.VERCEL_ENV || 'local');
    console.log('[OCR] 调用视觉模型:', model, '| URL:', base);

    const resp = await fetch(base, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
      body: JSON.stringify({
        model,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: '请逐字转写这张图片中的全部文字内容（包括表格、印章、手写签字、数字、金额）。只输出文字本身，按原排版分行，不要任何解释或评论。表格用 | 分隔单元格。' },
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
