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
    let totalChars = 0;
    for (let p = 1; p <= pdf.numPages; p++) {
      const pg = await pdf.getPage(p);
      const c = await pg.getTextContent();
      const txt = c.items.map(i => i.str).join(' ').trim();
      pages.push({ pg, txt });
      totalChars += txt.length;
    }
    if (totalChars / pdf.numPages >= 30) return pages.map(x => x.txt).join('\n');
    let out = '';
    for (let i = 0; i < pages.length; i++) {
      onProgress && onProgress(i + 1, pages.length);
      const img = await renderPage(pages[i].pg);
      out += (await ocrImage(img)) + '\n';
    }
    return out.trim();
  }

  async function run() {
    if (!files.length) return alert('请先导入项目资料');
    setBusy(true); setReport(null);
    try {
      const docs = [];
      for (let i = 0; i < files.length; i++) {
        const onProg = (cur, tot) =>
          setStatus(`正在 OCR 识别扫描件 · 文件 ${i + 1}/${files.length} · 第 ${cur}/${tot} 页`);
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
      <style>{CSS}</style>

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

const CSS = `
:root{
  --paper:#F6F4EF; --card:#FFFFFF; --ink:#1B1A17; --ink-2:#52504A; --ink-3:#8B887F;
  --line:#E4E0D7; --line-2:#EFECE4; --accent:#7A1F1A;
  --high:#9A2B1E; --mid:#9A6A1E; --low:#3C6B4A;
  --serif:"Songti SC","STSong",Georgia,"Times New Roman",serif;
  --sans:"Inter","PingFang SC","Hiragino Sans GB","Microsoft YaHei",system-ui,sans-serif;
}
*{box-sizing:border-box}
body{margin:0}
.app{min-height:100vh;background:var(--paper);color:var(--ink);font-family:var(--sans);
  -webkit-font-smoothing:antialiased;font-size:15px;line-height:1.65}
.masthead{display:flex;justify-content:space-between;align-items:center;
  padding:18px 40px;border-bottom:1px solid var(--line);background:rgba(246,244,239,.85);
  backdrop-filter:saturate(1.2) blur(6px);position:sticky;top:0;z-index:5}
.brand{display:flex;align-items:center;gap:12px}
.mark{width:30px;height:30px;border-radius:3px;background:
  linear-gradient(135deg,var(--accent),#4a110d);display:inline-block;
  box-shadow:inset 0 0 0 1px rgba(255,255,255,.12)}
.brand-name{font-family:var(--serif);font-size:18px;font-weight:600;letter-spacing:.04em}
.brand-sub{font-size:10px;letter-spacing:.32em;color:var(--ink-3);margin-top:1px}
.masthead-meta{font-size:12px;color:var(--ink-3);letter-spacing:.02em}

.sheet{max-width:880px;margin:0 auto;padding:56px 32px 40px}
.lede{margin-bottom:38px}
.lede h1{font-family:var(--serif);font-size:38px;font-weight:600;letter-spacing:.01em;margin:0 0 14px;line-height:1.2}
.lede p{font-size:15.5px;color:var(--ink-2);max-width:62ch;margin:0}

.panel{background:var(--card);border:1px solid var(--line);border-radius:6px;
  padding:30px 32px;box-shadow:0 1px 2px rgba(27,26,23,.03),0 8px 30px -22px rgba(27,26,23,.25)}
.panel-row{margin-bottom:26px}
.lbl{display:block;font-size:11px;letter-spacing:.16em;text-transform:uppercase;
  color:var(--ink-3);margin-bottom:10px;font-weight:600}
.opt{margin-left:10px;text-transform:none;letter-spacing:.02em;color:var(--ink-3);font-weight:400}
.field{width:100%;border:0;border-bottom:1px solid var(--line);background:transparent;
  padding:8px 2px;font-size:16px;color:var(--ink);font-family:var(--sans);transition:border-color .2s}
.field:focus{outline:none;border-color:var(--accent)}
.field::placeholder{color:#B7B4AB}

.drop{border:1px dashed #CFC9BC;border-radius:5px;padding:34px;text-align:center;cursor:pointer;
  transition:.2s;background:#FCFBF8}
.drop:hover,.drop.over{border-color:var(--accent);background:#FBF6F4}
.drop-title{font-size:15px;color:var(--ink);font-weight:500}
.drop-sub{font-size:12.5px;color:var(--ink-3);margin-top:5px}
.filelist{list-style:none;margin:14px 0 0;padding:0;border-top:1px solid var(--line-2)}
.filelist li{display:flex;justify-content:space-between;align-items:center;gap:12px;
  padding:10px 2px;border-bottom:1px solid var(--line-2);font-size:13.5px}
.fl-name{color:var(--ink-2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fl-x{border:0;background:transparent;color:var(--ink-3);font-size:12px;cursor:pointer;
  letter-spacing:.04em;flex:0 0 auto}
.fl-x:hover{color:var(--accent)}

.actions{display:flex;align-items:center;gap:18px;margin-top:30px;flex-wrap:wrap}
.run{background:var(--ink);color:#F6F4EF;border:0;border-radius:4px;padding:13px 30px;
  font-size:14.5px;font-weight:500;letter-spacing:.04em;cursor:pointer;font-family:var(--sans);
  transition:.2s;box-shadow:0 1px 2px rgba(0,0,0,.15)}
.run:hover:not(:disabled){background:var(--accent)}
.run:disabled{opacity:.5;cursor:default}
.status{display:inline-flex;align-items:center;gap:8px;font-size:13px;color:var(--ink-2)}
.status.err{color:var(--high)}
.dot{width:7px;height:7px;border-radius:50%;background:var(--accent);
  animation:pulse 1.1s ease-in-out infinite}
@keyframes pulse{0%,100%{opacity:.25}50%{opacity:1}}

.report{margin-top:46px;animation:rise .4s ease}
@keyframes rise{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
.rep-head{display:flex;justify-content:space-between;align-items:flex-end;
  padding-bottom:18px;border-bottom:2px solid var(--ink)}
.rep-kicker{font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:var(--ink-3);margin-bottom:6px}
.rep-head h2{font-family:var(--serif);font-size:25px;font-weight:600;margin:0;line-height:1.25}
.ghost{border:1px solid var(--line);background:var(--card);color:var(--ink-2);
  border-radius:4px;padding:9px 18px;font-size:13px;cursor:pointer;font-family:var(--sans);transition:.2s;flex:0 0 auto}
.ghost:hover{border-color:var(--ink);color:var(--ink)}
.rep-summary{font-size:16px;color:var(--ink);line-height:1.75;margin:22px 0 26px;
  padding-left:16px;border-left:2px solid var(--accent)}

.scoreboard{display:grid;grid-template-columns:repeat(4,1fr);border:1px solid var(--line);
  border-radius:5px;overflow:hidden;background:var(--card)}
.score{padding:18px 16px;text-align:center;border-right:1px solid var(--line-2)}
.score:last-child{border-right:0;background:#FAF8F3}
.score-n{font-family:var(--serif);font-size:30px;font-weight:600;line-height:1}
.score-l{font-size:11.5px;color:var(--ink-3);margin-top:7px;letter-spacing:.06em}
.score-high .score-n{color:var(--high)}
.score-mid .score-n{color:var(--mid)}
.score-low .score-n{color:var(--low)}

.provenance{font-size:12px;color:var(--ink-3);margin:14px 2px 28px;letter-spacing:.01em}

.risks{list-style:none;margin:0;padding:0}
.risk{display:flex;background:var(--card);border:1px solid var(--line);border-radius:5px;
  margin-bottom:14px;overflow:hidden;transition:box-shadow .2s,border-color .2s}
.risk:hover{box-shadow:0 10px 34px -24px rgba(27,26,23,.45);border-color:#D8D2C6}
.risk-rail{width:3px;flex:0 0 3px}
.risk-rail[data-tone=high]{background:var(--high)}
.risk-rail[data-tone=mid]{background:var(--mid)}
.risk-rail[data-tone=low]{background:var(--low)}
.risk-body{padding:20px 24px;flex:1;min-width:0}
.risk-top{display:flex;align-items:baseline;gap:12px}
.risk-idx{font-family:var(--serif);font-size:14px;color:var(--ink-3);flex:0 0 auto}
.risk-top h3{font-size:17px;font-weight:600;margin:0;flex:1;line-height:1.4;letter-spacing:.01em}
.tag{flex:0 0 auto;font-size:11px;font-weight:600;letter-spacing:.06em;padding:3px 11px;
  border-radius:2px;align-self:center}
.tag-high{color:var(--high);background:#F6E9E6;border:1px solid #E4C7C1}
.tag-mid{color:var(--mid);background:#F6F0E2;border:1px solid #E4D6B6}
.tag-low{color:var(--low);background:#E8F0E9;border:1px solid #C8DCCC}
.risk-cat{font-size:12px;color:var(--ink-3);margin:3px 0 0 26px;letter-spacing:.02em}
.risk dl{margin:16px 0 0 26px;display:grid;grid-template-columns:78px 1fr;gap:6px 16px}
.risk dt{font-size:11px;letter-spacing:.1em;color:var(--ink-3);text-transform:uppercase;
  font-weight:600;padding-top:2px}
.risk dd{margin:0;font-size:14px;color:var(--ink-2);line-height:1.7}

.foot{text-align:center;font-size:12px;color:var(--ink-3);padding:28px 20px 40px;
  border-top:1px solid var(--line);margin-top:30px;letter-spacing:.02em}

@media(max-width:680px){
  .masthead{padding:14px 18px}.masthead-meta{display:none}
  .sheet{padding:34px 18px}.lede h1{font-size:29px}.panel{padding:22px 18px}
  .scoreboard{grid-template-columns:repeat(2,1fr)}
  .score:nth-child(2){border-right:0}.score:nth-child(-n+2){border-bottom:1px solid var(--line-2)}
  .risk dl{grid-template-columns:1fr;gap:2px 0;margin-left:0}.risk dt{margin-top:8px}
  .risk-cat{margin-left:0}
}
`;
