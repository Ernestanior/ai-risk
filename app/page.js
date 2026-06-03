'use client';
import { useState, useEffect, useRef } from 'react';

export default function Home() {
  const [files, setFiles] = useState([]);
  const [projectName, setProjectName] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState(null);
  const [over, setOver] = useState(false);
  const inputRef = useRef();

  useEffect(() => {
    if (window.pdfjsLib)
      window.pdfjsLib.GlobalWorkerOptions.workerSrc =
        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  }, []);

  function addFiles(fl) {
    const next = [...files];
    for (const f of fl)
      if (f.name.toLowerCase().endsWith('.pdf') && !next.find(x => x.name === f.name)) next.push(f);
    setFiles(next);
  }

  async function renderPage(pg, scale = 1.8) {
    const vp = pg.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = vp.width; canvas.height = vp.height;
    await pg.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
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

  async function extract(f, onProgress) {
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

  async function run() {
    if (!files.length) return alert('请先导入项目资料');
    setBusy(true); setReport(null);
    try {
      const docs = [];
      for (let i = 0; i < files.length; i++) {
        const onProg = (cur, tot, mode) => {
          const modeText = mode === 'ocr' ? 'OCR 识别' : '文字提取';
          setStatus(`正在处理文件 ${i + 1}/${files.length} · 第 ${cur}/${tot} 页 · ${modeText}`);
        };
        setStatus(`正在解析文档 ${i + 1}/${files.length} · ${files[i].name}`);
        docs.push({ name: files[i].name, text: await extract(files[i], onProg) });
      }
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
            <label className="lbl">项目资料<span className="opt">PDF · 可多选</span></label>
            <div className={'drop' + (over ? ' over' : '')}
              onClick={() => inputRef.current.click()}
              onDragOver={e => { e.preventDefault(); setOver(true); }}
              onDragLeave={() => setOver(false)}
              onDrop={e => { e.preventDefault(); setOver(false); addFiles(e.dataTransfer.files); }}>
              <div className="drop-title">将项目文件夹中的 PDF 拖入此处</div>
              <div className="drop-sub">或点击选择文件 · 扫描件将自动 OCR 识别</div>
            </div>
            <input ref={inputRef} type="file" accept=".pdf" multiple style={{ display: 'none' }}
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
