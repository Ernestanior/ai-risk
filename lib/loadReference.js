import fs from 'fs';
import path from 'path';

const REF_DIR = path.join(process.cwd(), '参考资料');

// 读取「参考资料」文件夹下所有资料，返回 {name, text} 列表。
// 支持 .txt（直接读）、.pdf、.docx（运行时解析）。
// 老格式 .doc/.docm/.pptx 请先另存为 txt 或 pdf 再放入。
export async function loadReference() {
  if (!fs.existsSync(REF_DIR)) return [];
  const files = fs.readdirSync(REF_DIR).filter(f => !f.startsWith('.'));
  const out = [];
  for (const f of files) {
    const full = path.join(REF_DIR, f);
    if (fs.statSync(full).isDirectory()) continue;
    const ext = f.toLowerCase().split('.').pop();
    let text = '';
    try {
      if (ext === 'txt' || ext === 'md') {
        text = fs.readFileSync(full, 'utf-8');
      } else if (ext === 'pdf') {
        const pdfParse = (await import('pdf-parse')).default;
        text = (await pdfParse(fs.readFileSync(full))).text;
      } else if (ext === 'docx') {
        const mammoth = await import('mammoth');
        text = (await mammoth.extractRawText({ buffer: fs.readFileSync(full) })).value;
      } else {
        continue; // 不支持的格式跳过
      }
    } catch (e) {
      console.error('参考资料解析失败:', f, e.message);
      continue;
    }
    text = text.replace(/\n{3,}/g, '\n\n').trim();
    if (text.length > 3) out.push({ name: f.replace(/\.[^.]+$/, ''), text });
  }
  return out;
}
