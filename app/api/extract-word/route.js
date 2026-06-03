import { NextResponse } from 'next/server';
import mammoth from 'mammoth';

export const runtime = 'nodejs';
export const maxDuration = 60;

// 提取 Word 文档（.docx）中的文本
export async function POST(req) {
  try {
    const buffer = Buffer.from(await req.arrayBuffer());
    
    // 使用 mammoth 提取文本
    const result = await mammoth.extractRawText({ buffer });
    const text = result.value.trim();
    
    if (!text) {
      return NextResponse.json({ 
        error: 'Word 文档为空或无法提取文本' 
      }, { status: 400 });
    }
    
    console.log(`[Word] 提取文本 ${text.length} 字符`);
    return NextResponse.json({ text });
  } catch (e) {
    console.error('[Word] 提取失败:', e);
    return NextResponse.json({ 
      error: `Word 文档解析失败: ${e.message}` 
    }, { status: 500 });
  }
}
