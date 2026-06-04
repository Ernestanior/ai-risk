'use client';
import { useState, useEffect, useRef } from 'react';

export default function Home() {
  const [files, setFiles] = useState([]);
  const [projectName, setProjectName] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState(null);
  const [over, setOver] = useState(false);
  const [analysisInput, setAnalysisInput] = useState(null); // 改：保存发送给AI的完整输入
  const [showAnalysisInput, setShowAnalysisInput] = useState(false);
  const [forceOCR, setForceOCR] = useState(false); // 强制使用视觉识别
  const [visionModel, setVisionModel] = useState('glm-4v'); // 视觉模型选择：glm-4v 或 glm-5v
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

  async function renderPage(pg, scale = 2.5) {
    const vp = pg.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = vp.width; 
    canvas.height = vp.height;
    
    // 使用最高质量渲染
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    
    await pg.render({ 
      canvasContext: ctx, 
      viewport: vp,
      intent: 'print'
    }).promise;
    
    // 使用 PNG 保留细节
    return canvas.toDataURL('image/png');
  }

  async function ocrImage(dataURL) {
    const r = await fetch('/api/ocr', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: dataURL, model: visionModel }),
    });
    
    // 检查响应类型
    const contentType = r.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
      const text = await r.text();
      console.error('[OCR] 非 JSON 响应:', text.slice(0, 500));
      throw new Error(`OCR API 返回了非 JSON 响应（${r.status}）`);
    }
    
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
    
    const contentType = r.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
      const text = await r.text();
      console.error('[Word] 非 JSON 响应:', text.slice(0, 500));
      throw new Error(`Word API 返回了非 JSON 响应（${r.status}）`);
    }
    
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
    
    const contentType = r.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
      const text = await r.text();
      console.error('[Excel] 非 JSON 响应:', text.slice(0, 500));
      throw new Error(`Excel API 返回了非 JSON 响应（${r.status}）`);
    }
    
    const j = await r.json();
    if (!r.ok || j.error) throw new Error(j.error || 'Excel 提取失败');
    return j.text || '';
  }

  // 检测低质量 OCR 文本（嵌入式 OCR 层质量差）
  function isLowQualityOCR(text) {
    if (!text || text.length < 50) return true;
    
    // 检测重复模式（如 "项目类别 | 集团内 | 项目规模" 重复多次）
    const words = text.split(/\s+/);
    if (words.length < 10) return true;
    
    // 检测短词高频重复
    const wordCount = {};
    words.forEach(w => {
      if (w.length >= 2) {
        wordCount[w] = (wordCount[w] || 0) + 1;
      }
    });
    
    const repeatWords = Object.values(wordCount).filter(c => c > 5);
    if (repeatWords.length > 3) return true; // 有3个以上词出现5次以上
    
    // 检测管道符密度（表格特征）
    const pipeCount = (text.match(/\|/g) || []).length;
    if (pipeCount > text.length / 20) return true; // 每20字符就有一个管道符
    
    return false;
  }

  // PDF 提取逻辑
  async function extractPDF(f, onProgress, forceGLM = false) {
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
    
    // 第二步：逐页处理 - 文字足够且质量高就用文字，否则 OCR
    let out = '';
    const pageDetails = []; // 记录每页使用的方法
    
    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      const pageNum = i + 1;
      
      // 判断这一页是否有足够的高质量文字内容
      const hasEnoughText = page.txt.length >= 100; // 提高阈值到100字符
      const isGoodQuality = !isLowQualityOCR(page.txt);
      
      // 强制模式：所有页都用 GLM OCR
      if (forceGLM || !hasEnoughText || !isGoodQuality) {
        // 使用 GLM OCR 识别
        onProgress && onProgress(pageNum, pages.length, 'ocr');
        const img = await renderPage(page.pg);
        const ocrText = await ocrImage(img);
        out += ocrText + '\n';
        pageDetails.push({ 
          page: pageNum, 
          method: 'glm-ocr', 
          chars: ocrText.length,
          reason: forceGLM ? '强制GLM模式' : (!hasEnoughText ? '文本不足' : '低质量OCR')
        });
      } else {
        // 文字页：直接使用提取的文本
        onProgress && onProgress(pageNum, pages.length, 'text');
        out += page.txt + '\n';
        pageDetails.push({ page: pageNum, method: 'text', chars: page.txt.length });
      }
    }
    
    // 返回文本和页面处理详情
    return {
      text: out.trim(),
      pageDetails: pageDetails
    };
  }

  // 统一的文件提取入口
  async function extract(f, onProgress, forceGLM = false) {
    const fname = f.name.toLowerCase();
    
    if (fname.endsWith('.pdf')) {
      return await extractPDF(f, onProgress, forceGLM);
    } else if (fname.endsWith('.docx') || fname.endsWith('.doc')) {
      onProgress && onProgress(1, 1, 'word');
      const text = await extractWord(f);
      return { text };
    } else if (fname.endsWith('.xlsx') || fname.endsWith('.xls')) {
      onProgress && onProgress(1, 1, 'excel');
      const text = await extractExcel(f);
      return { text };
    } else {
      throw new Error(`不支持的文件格式: ${fname}`);
    }
  }

  async function run() {
    if (!files.length) return alert('请先导入项目资料');
    setBusy(true); setReport(null); setAnalysisInput(null);
    try {
      const docs = [];
      for (let i = 0; i < files.length; i++) {
        const onProg = (cur, tot, mode) => {
          const modeMap = {
            'ocr': 'GLM 视觉识别',
            'text': '文字提取',
            'word': 'Word 文档解析',
            'excel': 'Excel 表格解析'
          };
          const modeText = modeMap[mode] || mode;
          setStatus(`正在处理文件 ${i + 1}/${files.length} · 第 ${cur}/${tot} 页 · ${modeText}`);
        };
        setStatus(`正在解析文档 ${i + 1}/${files.length} · ${files[i].name}`);
        const result = await extract(files[i], onProg, forceOCR);
        
        // 处理返回结果（可能是对象或字符串）
        const docInfo = { 
          name: files[i].name, 
          text: typeof result === 'string' ? result : result.text
        };
        
        // 如果有页面处理详情（PDF），保存它
        if (result.pageDetails) {
          docInfo.pageDetails = result.pageDetails;
        }
        
        docs.push(docInfo);
      }
      setStatus('正在对照风控标准识别风险，请稍候');
      const r = await fetch('/api/analyze', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectName: projectName || files[0].name, documents: docs }),
      });
      
      // 检查响应类型
      const contentType = r.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        const text = await r.text();
        console.error('[分析] 非 JSON 响应:', text.slice(0, 500));
        throw new Error(`服务器返回了非 JSON 响应（${r.status}）。可能是 API 路由错误或服务器问题。`);
      }
      
      const data = await r.json();
      if (!r.ok || data.error) throw new Error(data.error || '请求失败');
      
      // 保存分析输入数据
      setAnalysisInput({
        projectName: projectName || files[0].name,
        documents: docs,
        meta: data.meta
      });
      
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

          <div className="panel-row">
            <label className="lbl">识别模型选择</label>
            <div style={{ display: 'flex', gap: '15px', marginTop: '5px' }}>
              <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
                <input 
                  type="radio" 
                  name="visionModel"
                  value="glm-4v"
                  checked={visionModel === 'glm-4v'} 
                  onChange={(e) => setVisionModel(e.target.value)}
                  style={{ marginRight: '6px' }}
                />
                GLM-4V-Flash（默认）
              </label>
              <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
                <input 
                  type="radio" 
                  name="visionModel"
                  value="glm-5v"
                  checked={visionModel === 'glm-5v'} 
                  onChange={(e) => setVisionModel(e.target.value)}
                  style={{ marginRight: '6px' }}
                />
                GLM-5V-Turbo（备选）
              </label>
            </div>
            <div style={{ fontSize: '12px', color: 'var(--ink-3)', marginTop: '5px' }}>
              💡 GLM-4V-Flash 速度快，GLM-5V-Turbo 识别精度更高
            </div>
          </div>

          <div className="panel-row">
            <label className="lbl">
              <input 
                type="checkbox" 
                checked={forceOCR} 
                onChange={(e) => setForceOCR(e.target.checked)}
                style={{ marginRight: '8px', verticalAlign: 'middle' }}
              />
              强制使用视觉识别（忽略 PDF 文本层，所有页面都用 OCR）
            </label>
            <div style={{ fontSize: '12px', color: 'var(--ink-3)', marginTop: '5px', marginLeft: '24px' }}>
              ⚠️ 开启后处理速度较慢，但可以看到视觉模型真实识别效果
            </div>
          </div>

          <div className="actions">
            <button className="run" disabled={busy} onClick={run}>
              {busy ? '识别中…' : '开始风险识别'}
            </button>
            {status && <span className={'status' + (isErr ? ' err' : '')}>{!isErr && <span className="dot" />}{status}</span>}
          </div>
        </section>

        {report && false && (
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

        {analysisInput && (
          <section className="debug-section">
            <h2 style={{ fontSize: '20px', marginBottom: '20px', color: 'var(--ink)' }}>
              📄 识别出的原始文本（发送给 DeepSeek 的内容）
            </h2>
            
            {analysisInput.documents.map((doc, i) => (
              <div key={i} className="extracted-text-panel" style={{ marginBottom: '30px' }}>
                <h3 style={{ fontSize: '16px', fontWeight: '600', marginBottom: '15px', color: 'var(--ink-2)' }}>
                  📄 {doc.name} ({doc.text.length} 字符)
                </h3>
                
                {/* 显示 PDF 页面处理详情 */}
                {doc.pageDetails && doc.pageDetails.length > 0 && (
                  <div className="page-details" style={{ marginBottom: '15px' }}>
                    <div className="page-details-summary">
                      <strong>处理方式：</strong>
                      {(() => {
                        const ocrPages = doc.pageDetails.filter(p => p.method === 'glm-ocr');
                        const textPages = doc.pageDetails.filter(p => p.method === 'text');
                        return (
                          <>
                            {ocrPages.length > 0 && (
                              <span className="method-badge ocr-badge">
                                🤖 GLM 视觉识别 {ocrPages.length} 页
                              </span>
                            )}
                            {textPages.length > 0 && (
                              <span className="method-badge text-badge">
                                📝 PDF文字提取 {textPages.length} 页
                              </span>
                            )}
                          </>
                        );
                      })()}
                    </div>
                    <details className="page-details-list">
                      <summary>查看每页详情</summary>
                      <table>
                        <thead>
                          <tr>
                            <th>页码</th>
                            <th>处理方式</th>
                            <th>字符数</th>
                            <th>备注</th>
                          </tr>
                        </thead>
                        <tbody>
                          {doc.pageDetails.map((p, pi) => (
                            <tr key={pi}>
                              <td>第 {p.page} 页</td>
                              <td>
                                {p.method === 'glm-ocr' ? (
                                  <span className="method-tag ocr-tag">🤖 GLM OCR</span>
                                ) : (
                                  <span className="method-tag text-tag">📝 文字提取</span>
                                )}
                              </td>
                              <td>{p.chars} 字符</td>
                              <td>{p.reason || '-'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </details>
                  </div>
                )}
                
                {/* 原始文本内容 */}
                <div style={{ 
                  background: '#f5f5f5', 
                  border: '1px solid var(--line)', 
                  borderRadius: '4px',
                  padding: '20px',
                  maxHeight: '600px',
                  overflowY: 'auto'
                }}>
                  <pre style={{ 
                    margin: 0,
                    fontSize: '14px',
                    lineHeight: '1.8',
                    whiteSpace: 'pre-wrap',
                    wordWrap: 'break-word',
                    color: 'var(--ink)',
                    fontFamily: "'PingFang SC', 'Microsoft YaHei', sans-serif"
                  }}>{doc.text}</pre>
                </div>
              </div>
            ))}
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
