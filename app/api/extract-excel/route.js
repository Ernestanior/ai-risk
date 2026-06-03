import { NextResponse } from 'next/server';
import * as XLSX from 'xlsx';

export const runtime = 'nodejs';
export const maxDuration = 60;

// 提取 Excel 文件（.xlsx, .xls）中的文本
export async function POST(req) {
  try {
    const buffer = Buffer.from(await req.arrayBuffer());
    
    // 使用 xlsx 读取工作簿
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    
    let text = '';
    
    // 遍历所有工作表
    workbook.SheetNames.forEach((sheetName, index) => {
      const worksheet = workbook.Sheets[sheetName];
      
      // 将工作表转换为 CSV 格式（保留表格结构）
      const csv = XLSX.utils.sheet_to_csv(worksheet, { FS: ' | ', RS: '\n' });
      
      if (csv.trim()) {
        text += `\n========== 工作表 ${index + 1}: ${sheetName} ==========\n`;
        text += csv + '\n';
      }
    });
    
    text = text.trim();
    
    if (!text) {
      return NextResponse.json({ 
        error: 'Excel 文件为空或无法提取数据' 
      }, { status: 400 });
    }
    
    console.log(`[Excel] 提取 ${workbook.SheetNames.length} 个工作表，${text.length} 字符`);
    return NextResponse.json({ text });
  } catch (e) {
    console.error('[Excel] 提取失败:', e);
    return NextResponse.json({ 
      error: `Excel 文件解析失败: ${e.message}` 
    }, { status: 500 });
  }
}
