'use client';
import { useState, useEffect, useRef } from 'react';

export default function Home() {
  const [files, setFiles] = useState([]);
  const [projectName, setProjectName] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState(null);
  const [over, setOver] = useState(false);
  const [extractedTexts, setExtractedTexts] = useState([]); // 新增：保存识别的文本
  const [showExtractedText, setShowExtractedText] = useState(false); // 新增：是否显示文本
  const inputRef = useRef();

  useEffect(() => {
    if (window.pdfjsLib)
      window.pdfjsLib.GlobalWorkerOptions.workerSrc =
        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  }, []);

  function addFiles(fl) {
    const next = [...files];
    const allowedExts = ['.pdf', '.docx', '.doc', '.xlsx', '.xls'];
    for (const f of fl) {
      const fname = f.name.toLowerCase();
      const isAllowed = allowedExts.some(ext => fname.endsWith(ext));
      if (isAllowed && !next.find(x => x.name === f.name)) {
        next.push(f);
      }
    }
    setFiles(next);
  }

  async function renderPage(pg, scale = 2.0) {
    const vp = pg.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = vp.width; canvas.height = vp.height;
    
    // 使用更好的渲染质量
    const ctx = canvas.getContext('2d');
    await pg.render({ 
      canvasContext: ctx, 
      viewport: vp,
      intent: 'print' // 使用打印质量
    }).promise;
    
    // 使用 PNG 格式以保留更多细节（对于表格数据）
    return canvas.toDataURL('image/png');
  }

  async function ocrImage(dataURL) {
    const r = await fetch('/api/ocr', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: dataURL }),
    });
    const j = await r.json();
    if (!r.ok || j.error) throw new Error(j.error || 'OCR 失败');
    return j.text || '';
  }

  // 处理 Word 文件（.docx）
  async function extractWord(file) {
    const buf = await file.arrayBuffer();
    const r = await fetch('/api/extract-word', {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: buf,
    });
    const j = await r.json();
    if (!r.ok || j.error) throw new Error(j.error || 'Word 提取失败');
    return j.text || '';
  }

  // 处理 Excel 文件（.xlsx, .xls）
  async function extractExcel(file) {
    const buf = await file.arrayBuffer();
    const r = await fetch('/api/extract-excel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: buf,
    });
    const j = await r.json();
    if (!r.ok || j.error) throw new Error(j.error || 'Excel 提取失败');
    return j.text || '';
  }

  // PDF 提取逻辑
  async function extractPDF(f, onProgress) {
    const buf = await f.arrayBuffer();
    const pdf = await window.pdfjsLib.getDocument({ data: buf }).promise;
    const pages = [];
    
    // 第一步：提取所有页的文本内容
    for (let p = 1; p <= pdf.numPages; p++) {
      const pg = await pdf.getPage(p);
      const c = await pg.getTextContent();
      const txt = c.items.map(i => i.str).join(' ').trim();
      pages.push({ pg, txt });
    }
    
    // 第二步：逐页处理 - 文字足够就用文字，否则 OCR
    let out = '';
    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      const pageNum = i + 1;
      
      // 判断这一页是否有足够的文字内容（至少30个字符）
      if (page.txt.length >= 30) {
        // 文字页：直接使用提取的文本
        onProgress && onProgress(pageNum, pages.length, 'text');
        out += page.txt + '\n';
      } else {
        // 图片页或扫描件：使用 OCR 识别
        onProgress && onProgress(pageNum, pages.length, 'ocr');
        const img = await renderPage(page.pg);
        const ocrText = await ocrImage(img);
        out += ocrText + '\n';
      }
    }
    
    return out.trim();
  }

  // 统一的文件提取入口
  async function extract(f, onProgress) {
    const fname = f.name.toLowerCase();
    
    if (fname.endsWith('.pdf')) {
      return await extractPDF(f, onProgress);
    } else if (fname.endsWith('.docx') || fname.endsWith('.doc')) {
      onProgress && onProgress(1, 1, 'word');
      return await extractWord(f);
    } else if (fname.endsWith('.xlsx') || fname.endsWith('.xls')) {
      onProgress && onProgress(1, 1, 'excel');
      return await extractExcel(f);
    } else {
      throw new Error(`不支持的文件格式: ${fname}`);
    }
  }

  async function run() {
    if (!files.length) return alert('请先导入项目资料');
    setBusy(true); setReport(null); setExtractedTexts([]);
    try {
      const docs = [];
      const texts = []; // 保存识别的文本
      for (let i = 0; i < files.length; i++) {
        const onProg = (cur, tot, mode) => {
          const modeMap = {
            'ocr': 'OCR 识别',
            'text': '文字提取',
            'word': 'Word 文档解析',
            'excel': 'Excel 表格解析'
          };
          const modeText = modeMap[mode] || mode;
          setStatus(`正在处理文件 ${i + 1}/${files.length} · 第 ${cur}/${tot} 页 · ${modeText}`);
        };
        setStatus(`正在解析文档 ${i + 1}/${files.length} · ${files[i].name}`);
        const text = await extract(files[i], onProg);
        docs.push({ name: files[i].name, text });
        texts.push({ name: files[i].name, text }); // 保存用于查看
      }
      setExtractedTexts(texts); // 设置识别的文本
      setStatus('正在对照风控标准识别风险，请稍候');
      const r = await fetch('/api/analyze', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectName: projectName || files[0].name, documents: docs }),
      });
      const data = await r.json();
      if (!r.ok || data.error) throw new Error(data.error || '请求失败');
      setReport(data); setStatus('');
    } catch (e) {
      setStatus('错误：' + e.message);
    } finally { setBusy(false); }
  }

  function exportReport() {
    let t = `项目风险识别报告\n项目：${projectName}\n\n概述：${report.summary}\n\n`;
    (report.risks || []).forEach((r, i) => {
      t += `${i + 1}. [${r.level}风险] ${r.title}\n   类别：${r.category}\n   依据：${r.basis}\n   建议：${r.suggestion}\n\n`;
    });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([t], { type: 'text/plain' }));
    a.download = `风险识别报告_${projectName || '项目'}.txt`; a.click();
  }

  const cnt = { 高: 0, 中: 0, 低: 0 };
  (report?.risks || []).forEach(r => (cnt[r.level] = (cnt[r.level] || 0) + 1));
  const isErr = status.startsWith('错误');

  return (
    <div className="app">
      <header className="masthead">
        <div className="brand">
          <span className="mark" />
          <div>
            <div className="brand-name">风控审视</div>
            <div className="brand-sub">PROJECT RISK REVIEW</div>
          </div>
        </div>
        <div className="masthead-meta">数智工程 · 政企项目合规审查</div>
      </header>

      <main className="sheet">
        <section className="lede">
          <h1>项目风险识别</h1>
          <p>导入项目过程资料，系统将逐项对照公司风控制度与负面清单，识别立项、甄选、投标、合同、资金与合规等环节的潜在风险。</p>
        </section>

        <section className="panel">
          <div className="panel-row">
            <label className="lbl">项目名称</label>
            <input className="field" value={projectName} placeholder="例如：惠来县教育专网信息化服务项目"
              onChange={e => setProjectName(e.target.value)} />
          </div>

          <div className="panel-row">
            <label className="lbl">项目资料<span className="opt">支持 PDF / Word / Excel · 可多选</span></label>
            <div className={'drop' + (over ? ' over' : '')}
              onClick={() => inputRef.current.click()}
              onDragOver={e => { e.preventDefault(); setOver(true); }}
              onDragLeave={() => setOver(false)}
              onDrop={e => { e.preventDefault(); setOver(false); addFiles(e.dataTransfer.files); }}>
              <div className="drop-title">将项目文件拖入此处</div>
              <div className="drop-sub">或点击选择文件 · 支持 PDF、Word、Excel · 扫描件自动 OCR 识别</div>
            </div>
            <input ref={inputRef} type="file" accept=".pdf,.docx,.doc,.xlsx,.xls" multiple style={{ display: 'none' }}
              onChange={e => addFiles(e.target.files)} />
            {files.length > 0 && (
              <ul className="filelist">
                {files.map((f, i) => (
                  <li key={i}>
                    <span className="fl-name">{f.name}</span>
                    <button className="fl-x" onClick={() => setFiles(files.filter((_, j) => j !== i))}>移除</button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="actions">
            <button className="run" disabled={busy} onClick={run}>
              {busy ? '识别中…' : '开始风险识别'}
            </button>
            {status && <span className={'status' + (isErr ? ' err' : '')}>{!isErr && <span className="dot" />}{status}</span>}
          </div>
        </section>

        {report && (
          <section className="report">
            <div className="rep-head">
              <div>
                <div className="rep-kicker">风险识别报告</div>
                <h2>{projectName || (files[0] && files[0].name) || '项目'}</h2>
              </div>
              <button className="ghost" onClick={exportReport}>导出报告</button>
            </div>

            <p className="rep-summary">{report.summary}</p>

            <div className="scoreboard">
              <Score n={cnt.高 || 0} l="高风险" tone="high" />
              <Score n={cnt.中 || 0} l="中风险" tone="mid" />
              <Score n={cnt.低 || 0} l="低风险" tone="low" />
              <Score n={(report.risks || []).length} l="风险项合计" tone="total" />
            </div>

            {report.meta && (
              <div className="provenance">
                对照 {report.meta.refCount} 份风控制度（{(report.meta.refChars / 1000).toFixed(0)} 千字）
                {report.meta.truncated ? ' · 项目资料过长已截断' : ''}
                {report.meta.usage ? ` · 用量 ${report.meta.usage.total_tokens} tokens` : ''}
              </div>
            )}

            <ol className="risks">
              {(report.risks || []).map((r, i) => (
                <li key={i} className="risk">
                  <div className="risk-rail" data-tone={tone(r.level)} />
                  <div className="risk-body">
                    <div className="risk-top">
                      <span className="risk-idx">{String(i + 1).padStart(2, '0')}</span>
                      <h3>{r.title}</h3>
                      <span className={'tag tag-' + tone(r.level)}>{r.level}风险</span>
                    </div>
                    <div className="risk-cat">{r.category}</div>
                    <dl>
                      <dt>判断依据</dt><dd>{r.basis}</dd>
                      <dt>管控建议</dt><dd>{r.suggestion}</dd>
                    </dl>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        )}

        {extractedTexts.length > 0 && (
          <section className="debug-section">
            <button 
              className="ghost" 
              onClick={() => setShowExtractedText(!showExtractedText)}
              style={{ marginTop: '20px' }}
            >
              {showExtractedText ? '隐藏识别文本' : '查看识别文本（调试用）'}
            </button>
            
            {showExtractedText && (
              <div className="extracted-text-panel">
                {extractedTexts.map((doc, i) => (
                  <div key={i} className="extracted-text-item">
                    <h3>📄 {doc.name}</h3>
                    <div className="extracted-text-stats">
                      识别字符数: {doc.text.length} · 
                      包含"毛利率": {doc.text.includes('毛利率') ? '✅ 是' : '❌ 否'} · 
                      包含"5.02": {doc.text.includes('5.02') ? '✅ 是' : '❌ 否'}
                    </div>
                    <pre className="extracted-text-content">{doc.text}</pre>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}
      </main>

      <footer className="foot">DeepSeek 推理 · 智谱 GLM-4V 识别 · 仅供合规辅助参考，最终判断以评审决策为准</footer>
    </div>
  );
}

function Score({ n, l, tone }) {
  return (
    <div className={'score score-' + tone}>
      <div className="score-n">{n}</div>
      <div className="score-l">{l}</div>
    </div>
  );
}
function tone(lv) { return lv === '高' ? 'high' : lv === '中' ? 'mid' : 'low'; }
