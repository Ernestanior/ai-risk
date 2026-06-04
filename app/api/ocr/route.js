import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 120;

// 接收一页扫描图片(base64 data URL)，调用视觉大模型转写为文字。
export async function POST(req) {
  try {
    const { image, model = 'glm-4v' } = await req.json(); // data:image/png;base64,xxx
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
    
    console.log('[OCR] 接收到的 model 参数:', model);
    console.log('[OCR] 将使用的 modelName:', modelName);
    console.log('[OCR] model === "glm-5v"?', model === 'glm-5v');
    
    if (!apiKey) {
      const errMsg = 'VISION_API_KEY 未配置';
      console.error(`[OCR] ${errMsg}`);
      return NextResponse.json({ 
        error: `服务器配置错误：${errMsg}。请在 Vercel 环境变量中添加此密钥。` 
      }, { status: 500 });
    }

    console.log('[OCR] 环境:', process.env.VERCEL_ENV || 'local');
    console.log('[OCR] 调用视觉模型:', modelName);
    console.log('[OCR] API Key 前4位:', apiKey.slice(0, 4));

    const requestBody = {
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
    };

    console.log('[OCR] 发送请求到:', baseUrl);
    
    const resp = await fetch(baseUrl, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json', 
        Authorization: 'Bearer ' + apiKey 
      },
      body: JSON.stringify(requestBody),
    });
    
    if (!resp.ok) {
      const t = await resp.text();
      const errMsg = `GLM API 错误 ${resp.status}: ${t.slice(0, 300)}`;
      console.error('[OCR]', errMsg);
      return NextResponse.json({ 
        error: `视觉模型调用失败（${resp.status}）。可能是 API Key 无效或模型不存在。错误: ${t.slice(0, 100)}` 
      }, { status: 502 });
    }
    
    const j = await resp.json();
    console.log('[OCR] 响应成功，content 长度:', j.choices?.[0]?.message?.content?.length || 0);
    const text = j.choices?.[0]?.message?.content || '';
    
    if (!text) {
      console.warn('[OCR] 警告: 识别结果为空');
    }
    
    return NextResponse.json({ text });
  } catch (e) {
    const errMsg = `OCR 异常: ${e.message}`;
    console.error('[OCR]', errMsg);
    console.error('[OCR] 堆栈:', e.stack);
    return NextResponse.json({ 
      error: `OCR 处理失败: ${e.message}` 
    }, { status: 500 });
  }
}
