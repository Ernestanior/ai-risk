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
    
    // 第二步：逐页处理 - 文字足够且质量高就用文字，否则 OCR
    let out = '';
    const pageDetails = []; // 记录每页使用的方法
    
    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      const pageNum = i + 1;
      
      // 判断这一页是否有足够的高质量文字内容
      const hasEnoughText = page.txt.length >= 100; // 提高阈值到100字符
      const isGoodQuality = !isLowQualityOCR(page.txt);
      
      if (hasEnoughText && isGoodQuality) {
        // 文字页：直接使用提取的文本
        onProgress && onProgress(pageNum, pages.length, 'text');
        out += page.txt + '\n';
        pageDetails.push({ page: pageNum, method: 'text', chars: page.txt.length });
      } else {
        // 图片页或扫描件或低质量文本：使用 GLM OCR 识别
        onProgress && onProgress(pageNum, pages.length, 'ocr');
        const img = await renderPage(page.pg);
        const ocrText = await ocrImage(img);
        out += ocrText + '\n';
        pageDetails.push({ 
          page: pageNum, 
          method: 'glm-ocr', 
          chars: ocrText.length,
          reason: !hasEnoughText ? '文本不足' : '低质量OCR'
        });
      }
    }
    
    // 将页面处理详情附加到结果
    out = out.trim();
    out._pageDetails = pageDetails; // 附加元数据
    return out;
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
        const text = await extract(files[i], onProg);
        
        // 保存文本和页面处理详情
        const docInfo = { 
          name: files[i].name, 
          text: typeof text === 'string' ? text : text.toString()
        };
        
        // 如果是 PDF，保存页面处理详情
        if (text._pageDetails) {
          docInfo.pageDetails = text._pageDetails;
        }
        
        docs.push(docInfo);
      }
      setStatus('正在对照风控标准识别风险，请稍候');
      const r = await fetch('/api/analyze', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectName: projectName || files[0].name, documents: docs }),
      });
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

        {analysisInput && (
          <section className="debug-section">
            <button 
              className="ghost" 
              onClick={() => setShowAnalysisInput(!showAnalysisInput)}
              style={{ marginTop: '20px' }}
            >
              {showAnalysisInput ? '隐藏分析数据' : '查看 AI 分析的数据（调试）'}
            </button>
            
            {showAnalysisInput && (
              <div className="extracted-text-panel">
                <div className="analysis-summary">
                  <h3>📊 数据概览</h3>
                  <div className="summary-grid">
                    <div className="summary-item">
                      <div className="summary-label">项目名称</div>
                      <div className="summary-value">{analysisInput.projectName}</div>
                    </div>
                    <div className="summary-item">
                      <div className="summary-label">文档数量</div>
                      <div className="summary-value">{analysisInput.documents.length} 个</div>
                    </div>
                    <div className="summary-item">
                      <div className="summary-label">项目资料字符</div>
                      <div className="summary-value">
                        {analysisInput.documents.reduce((sum, d) => sum + d.text.length, 0).toLocaleString()} 字符
                      </div>
                    </div>
                    {analysisInput.meta && (
                      <>
                        <div className="summary-item">
                          <div className="summary-label">参考资料</div>
                          <div className="summary-value">{analysisInput.meta.refCount} 份风控制度</div>
                        </div>
                        <div className="summary-item">
                          <div className="summary-label">参考资料字符</div>
                          <div className="summary-value">{(analysisInput.meta.refChars / 1000).toFixed(1)} 千字</div>
                        </div>
                        {analysisInput.meta.usage && (
                          <div className="summary-item">
                            <div className="summary-label">Token 用量</div>
                            <div className="summary-value">{analysisInput.meta.usage.total_tokens.toLocaleString()}</div>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>

                <div className="key-data-section">
                  <h3>🔑 识别的关键数据</h3>
                  {analysisInput.documents.map((doc, i) => {
                    const text = doc.text;
                    const keyDataPatterns = [
                      { label: '金额', regex: /(\d+\.?\d*)\s*万元/g, icon: '💰' },
                      { label: '毛利率', regex: /(毛利率|净额毛利率)[：:]\s*(\d+\.?\d*)\s*%/g, icon: '📊' },
                      { label: '百分比', regex: /(\d+\.?\d*)\s*%/g, icon: '📈' },
                      { label: '日期', regex: /\d{4}\s*年\s*\d{1,2}\s*月/g, icon: '📅' },
                    ];
                    
                    // 检查是否识别数据太少
                    const totalDataCount = keyDataPatterns.reduce((sum, pattern) => {
                      return sum + [...text.matchAll(pattern.regex)].length;
                    }, 0);
                    
                    const hasLowQualityOCR = text.length < 3000 && (
                      text.includes('公开招标 | 招标方式') || 
                      /(.{2,10}\s*\|\s*){10,}/.test(text)
                    );
                    
                    return (
                      <div key={i} className="key-data-doc">
                        <h4>📄 {doc.name}</h4>
                        
                        {/* 显示 PDF 页面处理详情 */}
                        {doc.pageDetails && doc.pageDetails.length > 0 && (
                          <div className="page-details">
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
                                        📝 文字提取 {textPages.length} 页
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
                        
                        {hasLowQualityOCR && (
                          <div className="ocr-warning">
                            ⚠️ 检测到低质量 OCR 文本层，已自动切换至 GLM 视觉识别。如仍有重复内容，建议上传 Word/Excel 原件。
                          </div>
                        )}
                        {keyDataPatterns.map((pattern, pi) => {
                          const matches = [...text.matchAll(pattern.regex)];
                          const uniqueMatches = [...new Set(matches.map(m => m[0]))].slice(0, 10);
                          if (uniqueMatches.length === 0) return null;
                          return (
                            <div key={pi} className="key-data-group">
                              <span className="key-data-icon">{pattern.icon}</span>
                              <span className="key-data-label">{pattern.label}：</span>
                              <span className="key-data-values">
                                {uniqueMatches.join(' · ')}
                                {matches.length > 10 && ` 等 ${matches.length} 项`}
                              </span>
                            </div>
                          );
                        })}
                        {totalDataCount === 0 && !hasLowQualityOCR && (
                          <div className="no-key-data">未识别到结构化数据</div>
                        )}
                      </div>
                    );
                  })}
                </div>

                <details className="full-text-details">
                  <summary>📝 查看完整的项目资料文本</summary>
                  {analysisInput.documents.map((doc, i) => (
                    <div key={i} className="extracted-text-item">
                      <h4>📄 {doc.name} ({doc.text.length} 字符)</h4>
                      <pre className="extracted-text-content">{doc.text}</pre>
                    </div>
                  ))}
                </details>
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
