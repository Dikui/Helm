// 沿用 v4 的只读产出物抽屉；真实历史断言保持原文，未执行浏览器检查。
const artifactPreviews = {
  "evidence/002/assertions.txt": {
    "type": "text",
    "label": "浏览器检查 · 第一次尝试",
    "real": true,
    "evidence": true,
    "content": "PASS S01 1440×900 浅色视口\nPASS S01 图例说明强制边界的机制和建议边界的 verifier 核对\nPASS S01 阻塞分组包含 c1b 提问型和 c1d 达到上限型\nPASS S01 四个收件箱分组存在且无横向溢出\nPASS S02 技术可行性信息带含交付物、资料来源、上限及两条进度条\nPASS S02 t2 显示 ? 无法判定和两个仅供人工判定的按钮\nPASS S02 签收禁用并提示先人工判定；打回可用\nPASS S02 桌面三栏同一行且无横向溢出\nPASS S03 t2 证据展开，显示两条来源与独立代理复核方法\nFAIL S03 展开 t2 的证据可见修正记录（correction）；未找到可见文本「修正：」\nPASS S03 补充定位：具体修正记录位于 t3，不能替代 t2 的检查要求\nPASS S04 开发过程默认折叠\nPASS S04 执行记录默认页签显示 #1 失败与 #2 成功\nPASS S04 失败原因以错误色、背景和左边框醒目显示\nPASS S04 切换时间线后显示日志、隐藏执行记录\nPASS S05 判为通过后 t2 通过，签收按钮启用并记录人工判定\nPASS S05 接受签收 prompt 后出现已签收状态与保存为模板按钮\nPASS S06 接受默认模板名后侧栏新增技术可行性模板，原按钮变为已保存\nPASS S06 模板详情只读且保留需求、边界强制标记、测试类型和三栏\nPASS S07 已达上限横幅包含部分完成报告、未完成项、估计和三个操作\nPASS S07 token 进度达到 100%，使用错误色\nPASS S07 追加预算后执行中，token 上限 +50%，进度恢复强调色\nPASS S08 c2 强制边界显示锁与权限规则/确定性测试机制\nPASS S08 补充边界输入行旁有建议/强制下拉框，默认建议\nPASS S08 c2 桌面详情无横向溢出\nPASS S09 模态框显示 goal、inputs、rules、强制标记和复制/关闭按钮\nPASS S09 预览底部可阅读 rules 段并保留模态框（全部内容放得下时无需滚动）\nPASS S09 Esc 关闭模态框并恢复触发按钮焦点\nPASS S10 深色收件箱启用 dark 媒体查询及深色背景，保留边界说明和阻塞分组\nPASS S10 深色 c1a 详情含无法判定、两个人工按钮和禁用签收，三栏无溢出\nFAIL S10 深色人工判为通过按钮小号文字对比度达到 4.5:1；实测 2.16:1（rgb(255, 255, 255) / rgb(92, 196, 138)）\nPASS S11 375×812 收件箱无横向滚动条，侧栏与主内容为单列\nFAIL S11 补充可读性检查：窄屏收件箱十字以内短标题不超过两行；「竞品与市场规模调研」正文列仅 59.3px，短标题换为 3 行，影响提示占 221.7px\nPASS S11 375×812 c1a 无横向滚动条，需求/边界/测试三栏纵向排列\n"
  },
  "evidence/002/recheck-1/assertions.txt": {
    "type": "text",
    "label": "浏览器检查 · 第二次尝试",
    "real": true,
    "evidence": true,
    "content": "PASS S01 1440×900 浅色视口\nPASS S01 图例说明强制边界的机制和建议边界的 verifier 核对\nPASS S01 阻塞分组包含 c1b 提问型和 c1d 达到上限型\nPASS S01 四个收件箱分组存在且无横向溢出\nPASS S02 技术可行性信息带含交付物、资料来源、上限及两条进度条\nPASS S02 t2 显示 ? 无法判定和两个仅供人工判定的按钮\nPASS S02 签收禁用并提示先人工判定；打回可用\nPASS S02 桌面三栏同一行且无横向溢出\nPASS S03 t2 证据展开，显示两条来源与独立代理复核方法\nPASS S03 t3 redteam 检查链显示先不通过后通过、复核方法及通过后的修正记录\nPASS S04 开发过程默认折叠\nPASS S04 执行记录默认页签显示 #1 失败与 #2 成功\nPASS S04 失败原因以错误色、背景和左边框醒目显示\nPASS S04 切换时间线后显示日志、隐藏执行记录\nPASS S05 判为通过后 t2 通过，签收按钮启用并记录人工判定\nPASS S05 接受签收 prompt 后出现已签收状态与保存为模板按钮\nPASS S06 接受默认模板名后侧栏新增技术可行性模板，原按钮变为已保存\nPASS S06 模板详情只读且保留需求、边界强制标记、测试类型和三栏\nPASS S07 已达上限横幅包含部分完成报告、未完成项、估计和三个操作\nPASS S07 token 进度达到 100%，使用错误色\nPASS S07 追加预算后执行中，token 上限 +50%，进度恢复强调色\nPASS S08 c2 强制边界显示锁与权限规则/确定性测试机制\nPASS S08 补充边界输入行旁有建议/强制下拉框，默认建议\nPASS S08 c2 桌面详情无横向溢出\nPASS S09 模态框显示 goal、inputs、rules、强制标记和复制/关闭按钮\nPASS S09 预览底部可阅读 rules 段并保留模态框（全部内容放得下时无需滚动）\nPASS S09 Esc 关闭模态框并恢复触发按钮焦点\nPASS S10 深色收件箱启用 dark 媒体查询及深色背景，保留边界说明和阻塞分组\nPASS S10 深色 .count 对比度均 ≥ 4.5:1（实测 6.758225、6.758225）\nPASS S10 深色 c1a 详情含无法判定、两个人工按钮和禁用签收，三栏无溢出\nPASS S10 深色 button.ok 对比度均 ≥ 4.5:1（实测 8.379728）\nPASS S10 深色 button.primary 对比度均 ≥ 4.5:1（实测 6.786764）\nPASS S10 浅色 .count 对比度均 ≥ 4.5:1（实测 5.438402、5.438402）\nPASS S10 浅色 button.ok 对比度均 ≥ 4.5:1（实测 4.537390）\nPASS S10 浅色 button.primary 对比度均 ≥ 4.5:1（实测 5.902306）\nPASS S11 375×812 收件箱无横向滚动条，侧栏与主内容为单列\nPASS S11 补充可读性检查：窄屏收件箱十字以内短标题不超过两行\nPASS S11 375×812 c1a 无横向滚动条，需求/边界/测试三栏纵向排列\n"
  },
  "prototype/index.html": {
    "type": "diff",
    "label": "--ok 颜色变更",
    "real": true,
    "commit": "eeac9ad2a364203f1f888b168a4c75777fa9bdeb",
    "content": "diff --git a/prototype/index.html b/prototype/index.html\nindex 68de948..d15f82f 100644\n--- a/prototype/index.html\n+++ b/prototype/index.html\n@@ -9,8 +9,9 @@\n   --bg: #f6f6f3; --panel: #ffffff; --panel-2: #f0efea; --line: #e2e0d8;\n   --text: #1d1d1b; --muted: #6b6a64; --faint: #9a988f;\n   --accent: #2f5bd3; --accent-soft: #e6ecfb;\n-  --ok: #1f8a4c; --ok-soft: #e3f3ea; --warn: #b26a00; --warn-soft: #fbf0dc;\n+  --ok: #1f874c; --ok-soft: #e3f3ea; --warn: #b26a00; --warn-soft: #fbf0dc;\n   --bad: #c0392b; --bad-soft: #fbe6e3; --agent: #7a4fc4; --agent-soft: #efe8fa;\n+  --on-accent: #ffffff; --on-ok: #ffffff; --on-bad: #ffffff;\n   --overlay: #00000066;\n   --radius: 10px; --mono: ui-monospace, SFMono-Regular, Menlo, monospace;\n }\n"
  },
  "evidence/c1a/技术可行性.md": {
    "type": "markdown",
    "label": "技术可行性报告（示例）",
    "real": false,
    "content": "# 技术可行性报告（示例）\n\n本报告为模拟资料，结论仍需按卡片测试独立核对。\n\n## 评估范围\n\n- 现有调度引擎 v3，规模限于 200 台设备。\n- ERP 首期采用单向导入；双向同步需补充资料。\n\n## 示例核对记录\n\n```text\n设备上限：200 台\n插单场景：补充历史记录后复核\n结论：有条件可行，待确认 ERP 资料\n```\n\n1. 收集接口文档。\n2. 核对风险回应。\n"
  },
  "evidence/c1a/证据索引.md": {
    "type": "markdown",
    "label": "技术证据索引（示例）",
    "real": false,
    "content": "# 证据索引（示例）\n\n- 引擎规模：引用模拟基准摘要。\n- ERP 接口：等待资料核对。\n\n```text\n来源类型：示例\n核对要求：来源与结论逐项对应\n```\n"
  },
  "evidence/c1b/人员占用.csv": {
    "type": "csv",
    "label": "人员占用表（示例）",
    "real": false,
    "content": "成员,角色,本月占用率,可用人月\n张宁,实施顾问,75%,0.25\n李明,接口开发,50%,0.50\n王悦,测试,25%,0.75\n"
  },
  "evidence/c1b/人员占用-草稿.csv": {
    "type": "csv",
    "label": "人员占用草稿（示例）",
    "real": false,
    "content": "成员,角色,本月占用率,可用人月\n张宁,实施顾问,75%,0.25\n李明,接口开发,50%,0.50\n王悦,测试,25%,0.75\n"
  },
  "evidence/c1b/交付产能.md": {
    "type": "markdown",
    "label": "交付产能评估（示例）",
    "real": false,
    "content": "# 交付产能评估（示例）\n\n本资料为模拟内容，未知排期仍等待提问答复。\n\n- 基线：三位成员的当前占用。\n- 后续：核对 Q4 排期后再判断产能。\n\n```text\n当前示例可用人月：1.50\nQ4 可用产能：未知\n```\n"
  }
};
// ---------- 产出物预览：静态嵌入，所有正文均先转义 ----------
const artifactPreview = {path:null,line:null,returnFocus:null};
function artifactReference(reference) {
  const value=String(reference||'');
  const known=Object.keys(artifactPreviews).sort((a,b)=>b.length-a.length).find(path=>value.includes(path));
  const suffix=known?value.slice(value.indexOf(known)+known.length):value;
  const match=suffix.match(known?/^(?::|#L)(\d+)/:/(?:[:]|#L)(\d+)$/);
  return {path:known||value.replace(/(?::|#L)\d+$/,''),line:match?Number(match[1]):null};
}
function previewReference(reference,kind='evidence',label=null) {
  const value=String(reference||'');
  const paths=Object.keys(artifactPreviews).filter(path=>value.includes(path));
  const refs=paths.length?paths.map(path=>{const tail=value.slice(value.indexOf(path)+path.length).match(/^(?::|#L)\d+/);return path+(tail?.[0]||'');}):[value];
  return `${esc(label??value)}<span class="preview-links">${refs.map(ref=>`<button type="button" class="preview-trigger" data-preview-kind="${esc(kind)}" data-preview-reference="${esc(ref)}" onclick="openArtifactPreview(${esc(JSON.stringify(ref))},this)">预览 · ${esc(ref)}</button>`).join('')}</span>`;
}
function previewList(items,kind) {return items?.length?`<ul>${items.map(item=>`<li>${previewReference(item,kind)}</li>`).join('')}</ul>`:'<div class="empty">暂无</div>';}
function previewLineAttributes(number,selected,extra='') {const highlighted=Number.isInteger(number)&&number===selected;return `class="preview-line${highlighted?' preview-highlight':''}${extra?' '+extra:''}"${Number.isInteger(number)?' data-source-line="'+number+'"':''}${highlighted?' aria-current="location"':''}`;}
function previewTextLine(text,number,selected) {return `<span ${previewLineAttributes(number,selected)}><span class="preview-line-number" aria-label="第 ${number} 行">${number}</span><span class="preview-line-text">${esc(text)}</span></span>`;}
function renderTextPreview(content,selected=null) {return `<div class="preview-code">${content.split('\n').map((line,index)=>previewTextLine(line,index+1,selected)).join('')}</div>`;}
function renderMarkdown(content,selected=null) {
  const lines=content.split(/\r?\n/);let out='',paragraph=[],listType=null,inCode=false,code=[];
  const flushParagraph=()=>{if(paragraph.length){out+=`<p>${paragraph.join('<br>')}</p>`;paragraph=[];}};
  const closeList=()=>{if(listType){out+=`</${listType}>`;listType=null;}};
  const flushCode=()=>{out+=`<pre class="preview-code"><code>${code.join('')}</code></pre>`;code=[];};
  const marker=(line,number)=>`<span ${previewLineAttributes(number,selected,'preview-markdown-marker')} aria-label="第 ${number} 行${line?' · 代码块围栏':' · 空白行'}">${number===selected?esc(line||'（空白行）'):''}</span>`;
  lines.forEach((line,index)=>{
    const number=index+1;
    if(/^\s*```/.test(line)){flushParagraph();closeList();if(inCode){flushCode();inCode=false;out+=marker(line,number);}else {out+=marker(line,number);inCode=true;}return;}
    if(inCode){code.push(previewTextLine(line,number,selected));return;}
    if(!line.trim()){flushParagraph();closeList();out+=marker(line,number);return;}
    const heading=line.match(/^(#{1,6})\s+(.+)$/);
    if(heading){flushParagraph();closeList();out+=`<h${heading[1].length} ${previewLineAttributes(number,selected)}>${esc(heading[2])}</h${heading[1].length}>`;return;}
    const item=line.match(/^\s*(?:([-*+])|\d+[.)])\s+(.+)$/);
    if(item){flushParagraph();const type=item[1]?'ul':'ol';if(listType!==type){closeList();listType=type;out+=`<${type}>`;}out+=`<li ${previewLineAttributes(number,selected)}>${esc(item[2])}</li>`;return;}
    closeList();paragraph.push(`<span ${previewLineAttributes(number,selected)}>${esc(line)}</span>`);
  });
  flushParagraph();closeList();if(inCode)flushCode();return `<div class="preview-markdown">${out}</div>`;
}
function csvRecords(content) {
  const rows=[];let row=[],field='',quoted=false,line=1,start=1;
  for(let i=0;i<content.length;i++){
    const ch=content[i];
    if(ch==='"'){if(quoted&&content[i+1]==='"'){field+='"';i++;}else if(quoted||field==='')quoted=!quoted;else field+=ch;}
    else if(ch===','&&!quoted){row.push(field);field='';}
    else if((ch==='\n'||ch==='\r')&&!quoted){if(ch==='\r'&&content[i+1]==='\n')i++;row.push(field);rows.push({cells:row,line:start});row=[];field='';line++;start=line;}
    else {field+=ch;if(ch==='\n')line++;}
  }
  if(field!==''||row.length||quoted){row.push(field);rows.push({cells:row,line:start});}
  return rows;
}
function parseCSV(content) {return csvRecords(content).map(row=>row.cells);}
function renderCSV(content,selected=null) {
  const rows=csvRecords(content);if(!rows.length)return '<p>空表格</p>';
  const cells=(row,tag)=>`<tr ${previewLineAttributes(row.line,selected)}>${row.cells.map(value=>`<${tag}${tag==='th'?' scope="col"':''}>${esc(value)}</${tag}>`).join('')}</tr>`;
  return `<table class="preview-csv"><caption>CSV 资料 · ${rows.length-1} 条数据，${rows[0].cells.length} 列</caption><thead>${cells(rows[0],'th')}</thead><tbody>${rows.slice(1).map(row=>cells(row,'td')).join('')}</tbody></table>`;
}
function renderDiff(content,selected=null) {
  let oldLine=null,newLine=null;
  const rows=content.split('\n').map((line,index)=>{
    const hunk=line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    let oldNumber='—',newNumber='—',symbol='',kind='',text=line;
    if(hunk){oldLine=Number(hunk[1]);newLine=Number(hunk[2]);}
    else if(oldLine!==null&&!/^(?:---|\+\+\+|\\)/.test(line)){
      if(line.startsWith('+')){symbol='+';kind='preview-diff-add';newNumber=newLine++;text=line.slice(1);}
      else if(line.startsWith('-')){symbol='-';kind='preview-diff-delete';oldNumber=oldLine++;text=line.slice(1);}
      else if(line.startsWith(' ')){oldNumber=oldLine++;newNumber=newLine++;text=line.slice(1);}
    }
    const sourceNumber=Number.isInteger(newNumber)?newNumber:null;
    return `<span ${previewLineAttributes(sourceNumber,selected,kind)} data-diff-line="${index+1}" data-old-line="${oldNumber}" data-new-line="${newNumber}"><span class="preview-line-number" aria-label="原行 / 新行">${oldNumber} / ${newNumber}</span><span class="preview-diff-symbol" aria-label="${symbol==='+'?'新增':symbol==='-'?'删除':'上下文'}">${symbol||' '}</span><span class="preview-line-text">${esc(text)}</span></span>`;
  }).join('');
  return `<p class="preview-meta">行号：原行 / 新行 · + 新增 · - 删除</p><div class="preview-code preview-diff">${rows}</div>`;
}
function renderArtifactPreview(reference) {
  const {path,line}=artifactReference(reference),artifact=artifactPreviews[path];
  const title=artifact?.label||'引用路径';
  const body=artifact?(artifact.type==='markdown'?renderMarkdown(artifact.content,line):artifact.type==='csv'?renderCSV(artifact.content,line):artifact.type==='diff'?renderDiff(artifact.content,line):renderTextPreview(artifact.content,line)):'<p>此路径未嵌入内容。原型仅预置部分产出物，请选择已嵌入的报告、CSV、断言文件或颜色变更。</p>';
  return `<div class="artifact-backdrop" onclick="if(event.target===this)closeArtifactPreview()"><section class="artifact-drawer" role="dialog" aria-modal="true" aria-labelledby="artifact-title"><header class="artifact-header"><h2 id="artifact-title">产出物预览 · ${esc(title)}</h2><button id="artifact-close" onclick="closeArtifactPreview()">关闭</button></header><p class="preview-meta">${esc(path)}${line?' · 引用第 '+line+' 行':''}</p><p class="preview-meta">${artifact?.real?'真实历史内容'+(artifact.evidence?' · 原文保留当时术语':' · diff 片段'):artifact?'示例 · 模拟资料':'未嵌入'}${artifact?.commit?' · 提交 '+esc(artifact.commit):''}</p><div class="artifact-content" tabindex="0" aria-label="产出物正文"${artifact?.evidence?' data-real-evidence="true"':''}>${body}</div></section></div>`;
}
function openArtifactPreview(reference,trigger=document.activeElement) {
  if(!artifactPreview.path)artifactPreview.returnFocus=trigger;
  const {path,line}=artifactReference(reference);artifactPreview.path=path;artifactPreview.line=line;
  $('#artifact-root').innerHTML=renderArtifactPreview(reference);
  $('.app')?.setAttribute('inert','');
  $('#artifact-close').focus?.();
  if(line)$('#artifact-root [data-source-line="'+line+'"]')?.scrollIntoView?.({block:'center'});
  return {ok:true,path,line};
}
function closeArtifactPreview() {
  const trigger=artifactPreview.returnFocus;
  $('#artifact-root').innerHTML='';$('.app')?.removeAttribute('inert');
  artifactPreview.path=null;artifactPreview.line=null;artifactPreview.returnFocus=null;trigger?.focus?.();return {ok:true};
}


document.addEventListener('keydown',event=>{if(!artifactPreview.path)return;if(event.key==='Escape'){event.preventDefault();closeArtifactPreview();}else if(event.key==='Tab'){const first=$('#artifact-close'),last=$('.artifact-content');if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus?.();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus?.();}}});
