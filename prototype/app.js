'use strict';
const STATUS={draft:'草稿',ready:'待开工',running:'进行中',review:'待验收',accepted:'已验收',integrated:'已合并 / 已登记',paused:'已暂停',cancelled:'已取消'};
const TEST_TYPES={deterministic:'确定性',evidence:'证据型',adversarial:'对抗型',judgment:'判断型'};
const RESULTS={pass:'通过',fail:'失败',unverifiable:'无法验证',unprocessed:'未处理'};
const GROUPS=['设计','开发','运行时设计','调研','缺陷','承接评估'];
const view={page:'project',id:'project-b',board:'graph',tab:'spec'};
const boardState={filters:{group:'',status:'',owner:'',mine:false},collapsedParents:new Set(),openColumns:new Set(['draft','ready','running','review','accepted','integrated'])};
const flowEditor={editing:false,selected:null,menu:null,notice:'',noticeKind:'success',drag:null,recentChanges:[]};
const $=selector=>document.querySelector(selector);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const js=value=>esc(JSON.stringify(value));
const getProject=id=>db.projects.find(p=>p.id===id);
const getCard=id=>db.cards[id];
const getAgent=id=>db.agents.find(a=>a.id===id);
const memberName=c=>db.members[c.memberId]?.name||'未指派';
const projectCards=p=>p.cardIds.map(getCard).filter(Boolean);
const cardChildren=id=>Object.values(db.cards).filter(c=>c.parentId===id);
const chip=status=>`<span class="chip s-${status}">${STATUS[status]}</span>`;
const groupIndex=name=>Math.max(0,GROUPS.indexOf(name));
const cardProgress=c=>`${c.tests.filter(t=>t.result==='pass').length}/${c.tests.length}`;
const cardVersions=c=>`规格 v${c.specVersion} · 产出 v${c.outputVersion}`;
function upstreamWarnings(c) {
 return [c.upstreamChanged?'⚠ 上游已变':'',c.dependencies.some(id=>getCard(id)?.status==='cancelled')?'⚠ 上游已取消':''].filter(Boolean);
}
function cardLines(c,width) {
 const version=cardVersions(c),extra=c.groups.slice(1).join(' · ');
 return [version+(extra?' · '+extra:''),c.statusLine||'尚未填写状态行',...(c.unread?['● 未读']:[]),...upstreamWarnings(c)].flatMap(text=>flowTextLines(text,width,12));
}
function projectEdges(p) {return projectCards(p).flatMap(c=>c.dependencies.map(from=>({from,to:c.id})));}
function parentHidden(c) {let id=c.parentId;const seen=new Set();while(id&&!seen.has(id)){seen.add(id);if(boardState.collapsedParents.has(id))return true;id=getCard(id)?.parentId;}return false;}
function filteredCards(p,{collapse=true}={}) {
 const f=boardState.filters;
 return projectCards(p).filter(c=>(!f.group||c.groups.includes(f.group))&&(!f.status||c.status===f.status)&&(!f.owner||db.members[c.memberId]?.agentId===f.owner)&&(!f.mine||inboxItems(p.id).some(item=>item.cardIds.includes(c.id)))&&(!collapse||!parentHidden(c)));
}
function boardProjection(p,{focusId}={}) {
 const all=projectEdges(p),cards=focusId?projectCards(p).filter(c=>c.id===focusId||all.some(e=>(e.from===focusId&&e.to===c.id)||(e.to===focusId&&e.from===c.id))):filteredCards(p);
 const ids=new Set(cards.map(c=>c.id));return {...p,cardIds:cards.map(c=>c.id),edges:all.filter(e=>ids.has(e.from)&&ids.has(e.to))};
}
function setBoardView(kind) {if(!['graph','columns','members'].includes(kind))return;cancelFlowDrag();view.board=kind;flowEditor.menu=null;render();}
function setFilter(name,value) {if(!Object.hasOwn(boardState.filters,name))return;cancelFlowDrag();boardState.filters[name]=value;flowEditor.menu=null;render();}
function resetFilters() {Object.assign(boardState.filters,{group:'',status:'',owner:'',mine:false});render();}
function toggleParent(id) {boardState.collapsedParents.has(id)?boardState.collapsedParents.delete(id):boardState.collapsedParents.add(id);render();}
function columnToggle(el,status) {el.open?boardState.openColumns.add(status):boardState.openColumns.delete(status);}
function enterFlowEdit() {flowEditor.editing=true;render();}
function leaveFlowEdit() {cancelFlowDrag();flowEditor.editing=false;flowEditor.menu=null;render();}
function go(page,id,trigger) {if(page==='card'||page==='node'){if(view.page!=='card'){panels.detailOrigin=flowMenuOrigin||focusDescriptor(trigger||document.activeElement);panels.detailReturn={page:view.page,id:view.id};}flowMenuOrigin=null;}cancelFlowDrag();flowEditor.menu=null;flowEditor.notice='';view.page=page==='node'?'card':page;view.id=id||null;if(view.page==='card')setUnread('card',view.id,false,false);sessionPanel.id=null;view.tab='spec';render({preserveScroll:false});$('#main').scrollTop=0;if(view.page==='card')$('#detail-close')?.focus?.();}
function setCardTab(tab) {view.tab=tab;render();}
function recordDecision(projectId,cardId,title,reason) {
 const d={id:'decision-'+(++db.serial),projectId,cardId,title,reason,decisionMaker:'你',adoptedAsIs:null,time:new Date().toLocaleString('zh-CN'),outcome:'立即生效'};
 db.decisions.push(d);flowEditor.recentChanges.push(d);return d;
}
function feedback(reason,kind=/^已取消操作/.test(reason)?'neutral':'error') {
 const menu=flowEditor.menu;
 if(menu?.kind==='groups')menu.groupsInput=$('#card-group-tags').value;
 if(menu?.kind==='add'){menu.titleInput=$('#card-new-title').value;menu.groupsInput=$('#card-new-groups').value;}
 flowEditor.notice=reason;flowEditor.noticeKind=kind;render();return {ok:false,reason};
}
function mutationDone(p,id,title,reason=title) {recordDecision(p.id,id,title,reason);p.spent=projectCards(p).reduce((sum,c)=>sum+c.spent,0);flowEditor.menu=null;flowEditor.notice='已生效：'+title;flowEditor.noticeKind='success';render();return {ok:true};}
function connectionReason(from,to) {
 const a=getCard(from),b=getCard(to);if(!a||!b)return '卡片不存在，请选择当前项目的卡片。';
 if(a.projectId!==b.projectId)return '拒绝跨项目连接。';if(from===to)return '不能连向自身。';
 if(b.dependencies.includes(from))return '重复依赖：这条连接已存在。';
 if(flowReachable(to,projectEdges(getProject(a.projectId))).has(from))return '形成循环依赖，连接已拒绝。';return '';
}
function impactDetails(ids) {
 const first=getCard(ids[0]),p=first&&getProject(first.projectId);if(!p)return {requiresConfirmation:false,affected:[],reason:''};
 const edges=projectEdges(p),affected=[...new Set(ids.flatMap(id=>[...flowReachable(id,edges)]))].map(getCard).filter(Boolean);
 const risky=affected.filter(c=>['running','review','accepted','integrated'].includes(c.status));
 return {requiresConfirmation:risky.length>0,affected:affected.map(c=>c.id),reason:'受影响的卡片及下游：'+affected.map(c=>`${c.title}（${STATUS[c.status]}）`).join('、')};
}
function confirmImpact(ids,action) {
 const impact=impactDetails(ids);return !impact.requiresConfirmation||confirm(`改动预览：${action}\n${impact.reason}\n确认后立即生效并写入决策记录。`);
}
function connectFlowNodes(from,to) {
 const reason=connectionReason(from,to);if(reason)return feedback(reason);
 const a=getCard(from),b=getCard(to);if(!confirmImpact([from,to],`添加依赖：${a.title} → ${b.title}`))return feedback('已取消操作，依赖保持原样。');
 b.dependencies.push(from);b.usedUpstreamVersions[from]=a.outputVersion;
 return mutationDone(getProject(a.projectId),to,`添加依赖：${a.title} → ${b.title}`);
}
function removeFlowEdge(from,to) {
 const a=getCard(from),b=getCard(to);if(!a||!b||!b.dependencies.includes(from))return feedback('这条依赖不存在。');
 if(!confirmImpact([from,to],`删除依赖：${a.title} → ${b.title}`))return feedback('已取消操作，依赖保持原样。');
 b.dependencies=b.dependencies.filter(id=>id!==from);delete b.usedUpstreamVersions[from];
 return mutationDone(getProject(b.projectId),to,`删除依赖：${a.title} → ${b.title}`);
}
function newCard(projectId,title,groups=[]) {
 const p=getProject(projectId);title=String(title||'').trim();groups=[...new Set(groups.map(g=>g.trim()).filter(Boolean))];
 if(!p||!title)return feedback('请输入卡片标题。');const id='card-'+(++db.serial);
 const c={id,projectId,title,requirements:[],boundaries:[],tests:[],deliverables:[],sources:[{path:'看板直接操作','note':'你新建的卡片'}],dependencies:[],groups,parentId:null,memberId:null,budget:0,spent:0,budgetNote:'尚未分配预算',specVersion:1,specHistory:[{version:1,requirements:[],boundaries:[],tests:[],note:'你新建的草稿'}],outputVersion:0,outputHistory:[],upstreamChanged:false,usedUpstreamVersions:{},statusLine:'等待讨论规格',status:'draft',attempts:[],example:false,recordNote:'你新建的草稿',independentVerification:null};
 db.cards[id]=c;p.cardIds.push(id);freezeHistories(c);mutationDone(p,id,`新建草稿卡：${title}`);return {ok:true,id};
}
function changeGroups(id,groups) {
 const c=getCard(id);if(!c)return feedback('卡片不存在。');const next=[...new Set(groups.map(g=>g.trim()).filter(Boolean))];
 if(!confirmImpact([id],`分组：${c.groups.join('、')||'未分组'} → ${next.join('、')||'未分组'}`))return feedback('已取消操作，分组保持原样。');
 c.groups=next;return mutationDone(getProject(c.projectId),id,`修改分组：${c.title}`,`改动后的标签：${next.join('、')||'未分组'}`);
}
function cancelCard(id) {
 const c=getCard(id);if(!c)return feedback('卡片不存在。');if(['integrated','cancelled'].includes(c.status))return feedback('已结束的卡片不能取消。');
 if(!confirmImpact([id],`取消卡片：${c.title}；下游将显示“上游已取消”`))return feedback('已取消操作，卡片状态保持原样。');
 const before=filteredCards(getProject(c.projectId)).map(c=>c.id),index=before.indexOf(id);c.status='cancelled';const result=mutationDone(getProject(c.projectId),id,`取消卡片：${c.title}`);if(view.page==='project'){const ids=filteredCards(getProject(c.projectId)).map(c=>c.id),next=ids.includes(id)?id:before.slice(index+1).find(id=>ids.includes(id))||before.slice(0,index).reverse().find(id=>ids.includes(id));restoreDescriptor({cardId:next});}return result;
}
function deepFreeze(o) {if(o&&typeof o==='object'){Object.values(o).forEach(deepFreeze);Object.freeze(o);}return o;}
function freezeHistories(c) {c.outputHistory=Object.freeze(c.outputHistory.map(deepFreeze));c.specHistory=Object.freeze(c.specHistory.map(deepFreeze));}
Object.values(db.cards).forEach(freezeHistories);
// 重开是一种转换，不是第九种状态。验收接口仅模拟硬约束，完整界面在第 4 批。
function reopenCard(id) {const c=getCard(id);if(c?.status!=='accepted')return feedback('只能重开已验收卡片。');c.status='running';c.independentVerification=null;return mutationDone(getProject(c.projectId),id,`重开卡片：${c.title}`);}
function acceptCard(id,actor='你') {
 const c=getCard(id);if(actor!=='你')return feedback('验收只能由你执行。');if(c?.status!=='review')return feedback('卡片尚未进入待验收。');if(!c.independentVerification?.sessionId)return feedback('验收前需要新会话的独立验证结论。');
 if(c.attempts.some(a=>a.sessionId===c.independentVerification.sessionId))return feedback('独立验证不能续接执行方的会话。');
 c.outputVersion++;c.outputHistory=Object.freeze([...c.outputHistory,deepFreeze({version:c.outputVersion,summary:'示例 · 本地验收产出',sources:c.deliverables.slice(),example:true})]);c.status='accepted';
 for(const downstream of projectCards(getProject(c.projectId)))if(downstream.dependencies.includes(id)&&downstream.usedUpstreamVersions[id]<c.outputVersion)downstream.upstreamChanged=true;
 return mutationDone(getProject(c.projectId),id,`验收卡片：${c.title} · 产出 v${c.outputVersion}`);
}
function crumb(p,label='') {return `<div class="crumb"><button onclick="go('projects')">项目</button><span>›</span><button onclick="go('project',${js(p.id)})">${esc(p.name)}</button>${label?`<span>› ${esc(label)}</span>`:''}</div>`;}
function cardLink(id) {const c=getCard(id);return c?`<button onclick="go('card',${js(id)},event.currentTarget)">${esc(c.title)}</button>`:'无';}
function renderSide() {
 $('#side').innerHTML=`<div class="brand">Helm<small>项目 · 看板 · 卡片</small></div><button class="nav-item ${view.page==='inbox'?'active':''}" onclick="go('inbox')">收件箱 · 全部项目<span>${inboxItems().length}</span></button><div class="section-label">项目</div>${db.projects.map(p=>`<button class="nav-item ${view.id===p.id||getCard(view.id)?.projectId===p.id?'active':''}" onclick="go('project',${js(p.id)})">${esc(p.name)}${p.example?' · 示例':''}</button>`).join('')}<div class="section-label">资料与记录</div>${[['timeline','消息时间线'],['team','团队'],['agents','代理库'],['experience','经验库'],['decisions','决策记录']].map(([page,title])=>`<button class="nav-item ${view.page===page?'active':''}" onclick="go(${js(page)},${js(getProject(view.id)?.id||getCard(view.id)?.projectId||'project-b')})">${title}</button>`).join('')}<button class="nav-item" onclick="toggleTheme()">切换明暗模式</button>`;
}
function toggleTheme() {const root=document.documentElement,theme=root.getAttribute('data-theme'),dark=theme==='dark'||!theme&&matchMedia('(prefers-color-scheme: dark)').matches;root.setAttribute('data-theme',dark?'light':'dark');}

function renderBudget(p) {return `<div class="budget"><span>预算 ¥${p.budget} · 已用 ¥${p.spent.toFixed(2)}</span><span>${esc(p.budgetNote)}</span><span>进行中 ${projectCards(p).filter(c=>c.status==='running').length} 张卡</span></div>`;}
function renderFilters(p) {
 const f=boardState.filters,groups=[...new Set(projectCards(p).flatMap(c=>c.groups))],owners=[...new Set(projectCards(p).map(c=>db.members[c.memberId]?.agentId).filter(Boolean))];
 const options=(values,value,label)=>`<option value="">全部${label}</option>`+values.map(([v,t])=>`<option value="${esc(v)}" ${value===v?'selected':''}>${esc(t)}</option>`).join('');
 return `<div class="card filters"><label>分组标签<select id="filter-group" onchange="setFilter('group',this.value)">${options(groups.map(g=>[g,g]),f.group,'分组')}</select></label><label>状态<select id="filter-status" onchange="setFilter('status',this.value)">${options(Object.entries(STATUS),f.status,'状态')}</select></label><label>负责人<select id="filter-owner" onchange="setFilter('owner',this.value)">${options(owners.map(id=>[id,getAgent(id)?.name||id]),f.owner,'负责人')}</select></label><div><label class="check"><input id="filter-mine" type="checkbox" ${f.mine?'checked':''} onchange="setFilter('mine',this.checked)">只看我要处理的</label><div class="src">匹配收件箱里所有与卡片相关的事项</div><button onclick="resetFilters()">清除筛选</button></div></div>`;
}
function renderProject(p) {
 $('#main').innerHTML=`<div id="board-content" class="board-content ${panels.conversation?'with-conversation':''}"><header class="project-topbar"><strong>${esc(p.name)}</strong><span>预算 ¥${p.budget} · 花费 ¥${p.spent.toFixed(2)}<span class="src"> · ${esc(p.budgetNote)}</span></span><span>活跃成员 ${activeMemberCount(p)}</span><button onclick="go('inbox')">本项目收件箱 ${inboxItems(p.id).length}</button><span id="unread-count" class="unread-marker">未读 ${unreadCount(p.id)}</span>${renderPauseSummary(p)}${renderRuntimeNotices(p.id)}<button id="pause-button" onclick="togglePause('project',${js(p.id)})">${p.paused?'恢复项目':'暂停'}</button><button id="conversation-toggle" aria-expanded="${panels.conversation}" onclick="toggleConversation(event.currentTarget)">${panels.conversation?'收起':'展开'}项目对话</button><span id="pause-notice" role="status">${esc(panels.notice)}</span></header>${crumb(p)}<div class="head"><div><h1>${esc(p.name)}${p.example?' · 示例':''}</h1><div class="meta">${esc(p.type)} · 项目负责人：${esc(getAgent(p.leaderId)?.name)} · 工作现场：${esc(p.site)}</div><p>${esc(p.goal)}</p></div><div class="actions"><button onclick="go('memory',${js(p.id)})">项目记忆</button><button onclick="go('settings',${js(p.id)})">项目设置</button><button onclick="go('timeline',${js(p.id)})">消息时间线</button><button onclick="go('team',${js(p.id)})">团队</button></div></div><div class="view-switch" aria-label="看板视图"><button aria-pressed="${view.board==='graph'}" onclick="setBoardView('graph')">依赖图</button><button aria-pressed="${view.board==='columns'}" onclick="setBoardView('columns')">状态列</button><button aria-pressed="${view.board==='members'}" onclick="setBoardView('members')">成员</button><button disabled title="第 5 批提供">回放 · 第 5 批</button></div>${renderFilters(p)}${renderBoardToolbar(p)}${flowEditor.notice?`<p class="notice notice-${flowEditor.noticeKind}" role="status">${esc(flowEditor.notice)}</p>`:''}<p id="board-drag-feedback" class="src" role="status" hidden></p>${renderFlowEditUI()}<div id="board-surface" tabindex="-1" aria-label="项目看板">${view.board==='graph'?renderFlowGraph(p):view.board==='members'?renderMembers(p):renderColumns(p)}</div>${flowEditor.recentChanges.filter(d=>d.projectId===p.id).length?`<details class="card" open><summary>改动预览与记录 · 已立即生效</summary>${flowEditor.recentChanges.filter(d=>d.projectId===p.id).slice(-5).map(d=>`<div class="row">${esc(d.title)}<div class="src">决策者：你 · ${esc(d.reason)}</div></div>`).join('')}</details>`:''}</div>${renderConversation(p)}`;
 if(window.innerWidth<=760&&panels.conversation)$('#board-content').setAttribute('inert','');
}
function renderCardTile(c) {
 const children=cardChildren(c.id);
 return `<article class="card board-card" data-card-id="${esc(c.id)}" data-state="${c.status}"><button class="card-title" onclick="go('card',${js(c.id)},event.currentTarget)">${esc(c.title)}</button> ${c.example?'<span class="tag">示例</span>':''}<p>${chip(c.status)} ${renderUnread(c)}</p>${renderStatusLine(c)}<div class="meta">负责人：${esc(memberName(c))}</div><div>${c.groups.map(g=>`<span class="tag">${esc(g)}</span>`).join('')||'<span class="tag">未分组</span>'}</div><div class="meta">测试 ${cardProgress(c)}（通过 / 总数）</div><div class="meta">${cardVersions(c)}</div>${upstreamWarnings(c).map(w=>`<p class="changed">${w}</p>`).join('')}<div class="actions"><button onclick="flowNodeMenu(${js(c.id)},event.currentTarget)">卡片菜单</button>${children.length?`<button onclick="toggleParent(${js(c.id)})" aria-expanded="${!boardState.collapsedParents.has(c.id)}">${boardState.collapsedParents.has(c.id)?'展开':'折叠'}子卡（${children.length}）</button>`:''}</div></article>`;
}
function renderColumns(p) {const cards=filteredCards(p);return `<div class="columns" data-board-view="columns">${Object.entries(STATUS).map(([status,label])=>`<details class="state-column" data-status="${status}" ${boardState.openColumns.has(status)?'open':''} ontoggle="columnToggle(this,${js(status)})"><summary>${label} · ${cards.filter(c=>c.status===status).length}</summary>${cards.filter(c=>c.status===status).map(renderCardTile).join('')||'<p class="empty">暂无卡片</p>'}</details>`).join('')}</div>`;}
function renderFlowSVG(project,options={}) {
 const p=project.edges?project:boardProjection(project,options),layout=layoutFlow(p,options),editing=flowEditor.editing&&!options.focusId,key=`graph-${p.id}-${options.focusId||'all'}`;
 const groups=layout.groups.map(g=>`<g class="group-${groupIndex(g.name)}" data-group="${esc(g.name)}" data-group-cards="${esc(g.ids.join(','))}"><rect class="flow-group" x="${g.x}" y="${g.y}" width="${g.width}" height="${g.height}" rx="9"/><text class="flow-group-label" x="${g.x+10}" y="${g.y+18}">${esc(g.name)}</text></g>`).join('');
 const edges=layout.edges.map(e=>`<g class="flow-edge" data-from="${esc(e.from)}" data-to="${esc(e.to)}" role="button" tabindex="0" aria-label="${esc(getCard(e.from).title+' → '+getCard(e.to).title+'，管理依赖')}" onclick="flowEdgeMenu(${js(e.from)},${js(e.to)},event.currentTarget)" onkeydown="if(event.key==='Enter'||event.key==='ContextMenu'){event.preventDefault();flowEdgeMenu(${js(e.from)},${js(e.to)},event.currentTarget);}"><path class="flow-edge-path" d="${e.path}" marker-end="url(#${key}-arrow)"/><path class="flow-edge-hit" d="${e.path}"/></g>`).join('');
 const nodes=layout.nodes.map(n=>{
  const c=getCard(n.id),children=cardChildren(c.id),warnings=new Set(upstreamWarnings(c)),open=editing?`flowNodeMenu(${js(c.id)},event.currentTarget)`:`go('card',${js(c.id)},event.currentTarget)`;
  return `<g class="flow-node" data-card-id="${esc(c.id)}" data-node-id="${esc(c.id)}" data-state="${c.status}" data-level="${n.level}" transform="translate(${n.x} ${n.y})" role="${editing?'button':'link'}" tabindex="0" aria-label="${esc([c.title,STATUS[c.status],c.statusLine,c.unread?'未读':'',memberName(c),c.groups.join('、'),'测试 '+cardProgress(c),cardVersions(c),...warnings,c.example?'示例':''].join('，'))}" onclick="${open}" onkeydown="flowNodeKeydown(event,${js(c.id)})" onmouseenter="highlightFlowNode(this,${js(c.id)})" onmouseleave="highlightFlowNode(this,null)" onfocus="flowEditor.selected=${js(c.id)};highlightFlowNode(this,${js(c.id)})" onblur="highlightFlowNode(this,null)"><title>${esc([c.title,STATUS[c.status],memberName(c),c.groups.join(' · '),'测试 '+cardProgress(c)+'（通过 / 总数）',cardVersions(c)].join('，'))}</title><rect class="flow-node-box" width="${n.width}" height="${n.height}" rx="6"/>${flowSVGText(n.titleLines,12,22,'flow-title',17)}<g class="flow-state"><rect class="flow-state-bg" x="12" y="${n.statusY}" width="${Math.max(...n.statusLines.map(line=>flowTextWidth(line,12)))+16}" height="${n.statusHeight}" rx="4"/>${flowSVGText(n.statusLines,20,n.statusY+14,'flow-state-text',15)}</g><text class="flow-meta" x="${n.width-66}" y="${n.statusY+14}"><title>测试通过数 / 测试总数</title>测试 ${cardProgress(c)}</text>${flowSVGText(n.agentLines,12,n.agentY,'flow-agent',15)}${n.metadata.map((line,i)=>flowSVGText([line],12,n.metaY+i*16,[...warnings].some(w=>w.includes(line))?'flow-warning':line==='● 未读'?'flow-unread':(c.statusLine||'尚未填写状态行').includes(line)?'flow-status-line':'flow-meta')).join('')}<g class="flow-card-menu" role="button" tabindex="0" aria-label="${esc(c.title)}的卡片菜单" onclick="event.stopPropagation();flowNodeMenu(${js(c.id)},event.currentTarget)" onkeydown="if(event.key==='Enter'){event.preventDefault();event.stopPropagation();flowNodeMenu(${js(c.id)},event.currentTarget);}"><text x="${n.width-22}" y="22">⋯</text></g>${children.length?`<g class="flow-child-toggle" role="button" tabindex="0" aria-expanded="${!boardState.collapsedParents.has(c.id)}" aria-label="${boardState.collapsedParents.has(c.id)?'展开':'折叠'}子卡" onclick="event.stopPropagation();toggleParent(${js(c.id)})" onkeydown="if(event.key==='Enter'){event.preventDefault();event.stopPropagation();toggleParent(${js(c.id)});}"><title>${boardState.collapsedParents.has(c.id)?'展开':'折叠'} ${children.length} 张子卡</title><text x="${n.width-68}" y="22">${boardState.collapsedParents.has(c.id)?'＋':'−'}子卡${children.length}</text></g>`:''}${editing&&!layout.vertical?`<circle class="flow-connect-port" cx="${n.width}" cy="${n.height/2}" r="7" aria-hidden="true" onpointerdown="beginFlowConnection(event,${js(c.id)})" onclick="event.stopPropagation()"><title>拖到目标卡片添加依赖</title></circle><g class="flow-drop-feedback" hidden><rect class="flow-drop-feedback-bg" x="8" y="${n.height+4}" width="${n.width-16}" height="22" rx="4"/><text class="flow-drop-label" x="16" y="${n.height+19}" hidden></text></g>`:''}</g>`;
 }).join('');
 return `<svg class="flow-svg" style="--graph-arrow-active:url(#${key}-active)" data-editing="${editing}" data-direction="${layout.vertical?'vertical':'horizontal'}" data-scrollable="${layout.scrollable}" width="${layout.width}" height="${layout.height}" viewBox="0 0 ${layout.width} ${layout.height}" role="group" aria-labelledby="${key}-title"><title id="${key}-title">${options.focusId?'卡片直接上下游':'项目看板依赖图'}；Tab 聚焦卡片，${editing?'Enter 打开菜单':'Enter 打开详情'}，菜单键管理依赖</title><defs><marker id="${key}-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth="9" markerHeight="9" orient="auto"><path class="flow-arrow" d="M 0 0 L 10 5 L 0 10 Z"/></marker><marker id="${key}-active" viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth="9" markerHeight="9" orient="auto"><path class="flow-arrow-active" d="M 0 0 L 10 5 L 0 10 Z"/></marker></defs>${groups}${edges}${nodes}<path class="flow-temporary-line" hidden/></svg>`;
}
function renderFlowGraph(p,options={}) {
 const graph=boardProjection(p,options),settings={...flowViewport(),...options},layout=layoutFlow(graph,settings);
 return `<section class="flow-diagram" data-project-id="${esc(p.id)}" data-focus-id="${esc(options.focusId||'')}" aria-label="${options.focusId?'直接上下游小图':'看板依赖图'}"><div class="flow-canvas" role="region" aria-label="依赖图，可在图内滚动" tabindex="0">${renderFlowSVG(graph,settings)}</div><p class="flow-scroll-hint" ${layout.scrollable?'':'hidden'}>↔ 图较宽，可在图内左右滚动；聚焦图区域后也可使用方向键。</p>${options.focusId?'':`<div class="flow-legend">${Object.keys(STATUS).map(chip).join('')}<span class="changed">⚠ 上游已变 / 上游已取消</span></div>`}<ul class="visually-hidden" aria-label="卡片依赖列表">${graph.edges.map(e=>`<li>${esc(getCard(e.from).title)} → ${esc(getCard(e.to).title)}</li>`).join('')||'<li>无依赖</li>'}</ul>${graph.cardIds.length?'':'<p class="empty">没有匹配的卡片</p>'}</section>`;
}
function highlightFlowNode(element,id) {
 const diagram=element.closest?.('.flow-diagram');if(!diagram)return;const edges=projectEdges(getProject(diagram.dataset.projectId)),up=flowReachable(id,edges,true),down=flowReachable(id,edges);
 for(const e of diagram.querySelectorAll('.flow-edge'))e.classList.toggle('is-active',Boolean(id&&(up.has(e.dataset.from)&&up.has(e.dataset.to)||down.has(e.dataset.from)&&down.has(e.dataset.to))));
}
// 重渲染会销毁图容器；内容变短也会使浏览器钳制滚动位置。
// 保存位置，并仅保留恢复当前位置必需的空白范围；导航时清除这些临时尾部。
function boardScrollRegions() {
 const main=$('#main'),regions=[];
 for(const diagram of main.querySelectorAll('.flow-diagram')) {
  const element=diagram.querySelector('.flow-canvas');
  if(element)regions.push({key:diagram.dataset.projectId+':'+(diagram.dataset.focusId||'board'),element,kind:'canvas'});
 }
 const columns=main.querySelector('.columns');if(columns)regions.push({key:'columns',element:columns,kind:'columns'});
 return regions;
}
function captureBoardViewport() {
 const main=$('#main'),root=document.scrollingElement||document.documentElement,active=document.activeElement;
 const position=element=>({top:Number(element?.scrollTop)||0,left:Number(element?.scrollLeft)||0,height:Number(element?.clientHeight)||0,width:Number(element?.clientWidth)||0});
 const focus=active&&main.contains?.(active)?{id:active.getAttribute?.('id'),cardId:active.closest?.('.flow-node')?.dataset.cardId}:null;
 return {main:position(main),page:{top:Number(window.scrollY??root.scrollTop)||0,left:Number(window.scrollX??root.scrollLeft)||0,height:Number(window.innerHeight)||root.clientHeight||0},regions:boardScrollRegions().map(r=>({key:r.key,kind:r.kind,...position(r.element)})),focus};
}
function addScrollTail(host,height,width=1,id=null) {
 const tail=document.createElement('div');tail.setAttribute('class','scroll-range-tail');tail.setAttribute('aria-hidden','true');
 tail.setAttribute('style',`height:${Math.max(0,height)}px;width:${Math.max(1,width)}px;`);
 if(id)tail.setAttribute('id',id);host.appendChild(tail);
}
function clearPageScrollTail() {document.getElementById('board-page-scroll-tail')?.remove?.();}
function restoreBoardViewport(saved) {
 if(!saved)return;
 // 先保留范围，最后统一恢复位置。尾部不会缩放 SVG 或改变卡片/连线路径。
 for(const region of boardScrollRegions()) {
  const previous=saved.regions.find(r=>r.key===region.key);if(!previous)continue;
  const element=region.element,requiredHeight=previous.top+Math.max(previous.height,element.clientHeight||0),requiredWidth=previous.left+Math.max(previous.width,element.clientWidth||0);
  const height=previous.top?Math.max(0,requiredHeight-(element.scrollHeight||0)):0;
  const widthGap=previous.left?Math.max(0,requiredWidth-(element.scrollWidth||0)):0;
  if(height||widthGap)addScrollTail(element,Math.max(height,widthGap?1:0),region.kind==='columns'?Math.max(1,widthGap):widthGap?requiredWidth:1);
 }
 const main=$('#main'),requiredMainHeight=saved.main.top+Math.max(saved.main.height,main.clientHeight||0);
 if(saved.main.top&&main.scrollHeight<requiredMainHeight)addScrollTail(main,requiredMainHeight-main.scrollHeight);
 const root=document.scrollingElement||document.documentElement,requiredPageHeight=saved.page.top+Math.max(saved.page.height,window.innerHeight||0);
 if(saved.page.top&&root.scrollHeight<requiredPageHeight)addScrollTail(document.body,requiredPageHeight-root.scrollHeight,1,'board-page-scroll-tail');
 // 追加尾部后重新获取当前容器，再统一恢复位置。
 for(const region of boardScrollRegions()) {
  const previous=saved.regions.find(r=>r.key===region.key);if(previous){region.element.scrollLeft=previous.left;region.element.scrollTop=previous.top;}
 }
 if(saved.focus) {
  const target=saved.focus.id?main.querySelector('#'+saved.focus.id):[...main.querySelectorAll('.flow-node')].find(n=>n.dataset.cardId===saved.focus.cardId);
  target?.focus?.({preventScroll:true});
 }
 main.scrollLeft=saved.main.left;main.scrollTop=saved.main.top;
 if(typeof window.scrollTo==='function')window.scrollTo(saved.page.left,saved.page.top);
 else {root.scrollLeft=saved.page.left;root.scrollTop=saved.page.top;}
}
function refreshFlowLayout({preserveScroll=true}={}) {
 const viewport=preserveScroll?captureBoardViewport():null;cancelFlowDrag();for(const diagram of $('#main').querySelectorAll('.flow-diagram')) {
  const p=getProject(diagram.dataset.projectId),canvas=diagram.querySelector('.flow-canvas');if(!p||!canvas)continue;
  const focused=document.activeElement?.closest?.('.flow-node'),focusedId=focused?.dataset.cardId,options={...flowViewport(canvas),focusId:diagram.dataset.focusId||undefined};
  const graph=boardProjection(p,options),layout=layoutFlow(graph,options);canvas.innerHTML=renderFlowSVG(graph,options);const hint=diagram.querySelector('.flow-scroll-hint');hint?.setAttribute('hidden','');if(layout.scrollable)hint?.removeAttribute('hidden');
  if(focusedId)[...canvas.querySelectorAll('.flow-node')].find(n=>n.dataset.cardId===focusedId)?.focus({preventScroll:true});
 }
 restoreBoardViewport(viewport);positionFlowMenu();
}
let flowMenuOrigin=null;
function menuOrigin(id,source) {
 const active=document.activeElement,main=view.page==='card'?$('#main').querySelector('.card-detail'):$('#main');
 const cardHost=id&&[...main.querySelectorAll('[data-card-id]')].find(n=>n.dataset.cardId===id),card=cardHost?.classList?.contains('board-card')?cardHost.querySelector('.card-title'):cardHost;
 const eligible=active&&main.contains?.(active)&&!active.closest?.('.flow-edit-menu')&&(!id||active.closest?.('.flow-node')?.dataset.cardId===id||active.getAttribute?.('onclick')?.includes(id));
 const trigger=source|| (eligible?active:card||main.querySelector('[data-flow-add]'));
 const rect=trigger?.getBoundingClientRect?.();
 return {preferCard:trigger?.classList?.contains('flow-card-menu')||false,cardId:trigger?.closest?.('.flow-node')?.dataset.cardId||id,onclick:trigger?.getAttribute?.('onclick'),id:trigger?.getAttribute?.('id'),rect:rect?{left:rect.left,top:rect.top,right:rect.right??rect.left+rect.width,bottom:rect.bottom??rect.top+rect.height}:null};
}
function openFlowMenu(menu,trigger) {
 if(!flowEditor.menu)flowMenuOrigin=menuOrigin(menu.id||menu.from,trigger);
 if(menu.id)flowEditor.selected=menu.id;
 flowEditor.menu=menu;render();focusFlowMenu();
}
function flowNodeMenu(id,trigger) {openFlowMenu({kind:'node',id},trigger);}
function flowDependencyMenu(id) {openFlowMenu({kind:'targets',id});}
function flowLinesMenu(id) {openFlowMenu({kind:'lines',id});}
function flowEdgeMenu(from,to,trigger) {openFlowMenu({kind:'edge',from,to},trigger);}
function flowAddInput(trigger) {openFlowMenu({kind:'add'},trigger);}
function flowGroupInput(id) {openFlowMenu({kind:'groups',id});}
function restoreFlowMenuFocus() {
 const origin=flowMenuOrigin;if(!origin)return;flowMenuOrigin=null;
 const main=view.page==='card'?$('#main').querySelector('.card-detail'):$('#main'),target=(origin.preferCard&&[...main.querySelectorAll('.flow-node')].find(n=>n.dataset.cardId===origin.cardId))||(origin.id&&main.querySelector('#'+origin.id))||(origin.onclick&&[...main.querySelectorAll('[onclick]')].find(n=>!n.closest?.('.flow-edit-menu')&&n.getAttribute('onclick')===origin.onclick))||[...main.querySelectorAll('.flow-node')].find(n=>n.dataset.cardId===origin.cardId);
 if(target)target.focus?.({preventScroll:true});else restoreDescriptor(null,view.page==='card'?'#detail-close':'#board-surface');
}
function closeFlowMenu() {flowEditor.menu=null;const panel=$('#main').querySelector('.flow-edit-menu');if(typeof panel?.remove==='function'){panel.remove();restoreFlowMenuFocus();}else render();}
function focusFlowMenu() {
 const panel=$('#main').querySelector('.flow-edit-menu');
 (panel?.querySelector('input')||panel?.querySelector('[data-flow-menu-item]')||panel?.querySelector('button'))?.focus({preventScroll:true});
}
function flowMenuPosition(anchor,width,height,viewportWidth,viewportHeight) {
 const gap=8,margin=12,w=Math.min(width,viewportWidth-2*margin),h=Math.min(height,viewportHeight-2*margin);
 const a=anchor||{left:margin,top:margin,right:margin,bottom:margin};
 let left=a.right+gap;if(left+w>viewportWidth-margin)left=a.left-w-gap;
 let top=a.top;if(top+h>viewportHeight-margin)top=a.bottom-h;
 return {left:Math.max(margin,Math.min(left,viewportWidth-margin-w)),top:Math.max(margin,Math.min(top,viewportHeight-margin-h)),width:w,height:h};
}
function positionFlowMenu() {
 const panel=$('#main').querySelector('.flow-edit-menu');if(!panel)return;
 const vw=window.innerWidth||document.documentElement.clientWidth,vh=window.innerHeight||document.documentElement.clientHeight||900;
 panel.dataset.presentation=vw<=760?'panel':'popover';
 if(vw<=760){panel.style.left='0px';panel.style.top='auto';return;}
 const rect=panel.getBoundingClientRect(),pos=flowMenuPosition(flowMenuOrigin?.rect,rect.width,rect.height,vw,vh);
 panel.style.left=pos.left+'px';panel.style.top=pos.top+'px';
}
function flowDialogKeydown(event) {
 if(event.key==='Escape'){event.preventDefault();event.stopPropagation();closeFlowMenu();return;}
 if(event.key==='Tab') {
  const panel=$('#main').querySelector('.flow-edit-menu'),items=[...panel.querySelectorAll('input'),...panel.querySelectorAll('button')].filter(n=>!n.disabled),first=items[0],last=items[items.length-1];
  if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus({preventScroll:true});}
  else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus({preventScroll:true});}
 }
}
function flowMenuOutside(event) {
 const panel=$('#main').querySelector('.flow-edit-menu');if(panel&&!panel.contains(event.target)){const focusable=event.target?.closest?.('button,a[href],input,select,textarea,[tabindex]');if(!focusable||focusable.disabled||focusable.getAttribute?.('tabindex')==='-1')event.preventDefault?.();closeFlowMenu();}
}
function flowMenuKeydown(event) {
 const items=[...$('#main').querySelectorAll('[data-flow-menu-item]')],current=Math.max(0,items.indexOf(document.activeElement));
 if(event.key==='Escape'){event.preventDefault();event.stopPropagation();closeFlowMenu();return;}
 const next=event.key==='ArrowDown'?(current+1)%items.length:event.key==='ArrowUp'?(current+items.length-1)%items.length:event.key==='Home'?0:event.key==='End'?items.length-1:null;
 if(next!==null){event.preventDefault();items[next]?.focus({preventScroll:true});}else if(event.key==='Enter'){event.preventDefault();items[current]?.click();}
}
function flowNodeKeydown(event,id) {
 if(event.key==='ContextMenu'||event.shiftKey&&event.key==='F10'){event.preventDefault();flowNodeMenu(id);}
 else if(event.key==='Enter'){event.preventDefault();flowEditor.editing?flowNodeMenu(id):go('card',id,event.currentTarget);}
 else if(flowEditor.editing&&['Delete','Backspace'].includes(event.key)){event.preventDefault();cancelCard(id);}
}
function flowInputKeydown(event,kind) {if(event.key==='Escape'){event.preventDefault();event.stopPropagation();closeFlowMenu();}if(event.key==='Enter'){event.preventDefault();kind==='add'?submitNewCard():submitGroups();}}
function submitNewCard() {const p=getProject(view.id);return newCard(p.id,$('#card-new-title').value,$('#card-new-groups').value.split(/[，,]/));}
function submitGroups() {return changeGroups(flowEditor.menu.id,$('#card-group-tags').value.split(/[，,]/));}
function updateFormPreview() {
 const m=flowEditor.menu;if(!m)return;const title=m.kind==='add'?$('#card-new-title').value:getCard(m.id).title,tags=$(m.kind==='add'?'#card-new-groups':'#card-group-tags').value;
 $('#operation-preview').textContent=`改动预览：${title||'未命名卡片'} · ${m.kind==='add'?'草稿 · ':''}分组：${tags||'未分组'}；确认后立即生效。`;
}
function renderFlowEditUI() {
 const m=flowEditor.menu;if(!m)return '';const c=getCard(m.id),button=(label,action)=>`<button data-flow-menu-item role="menuitem" onclick="${action}">${esc(label)}</button>`;
 let body='';
 if(m.kind==='add')body=`<h2>新建卡片</h2><div class="form-row"><label>标题<input id="card-new-title" type="text" value="${esc(m.titleInput||'')}" oninput="updateFormPreview()" onkeydown="flowInputKeydown(event,'add')"></label><label>分组标签（用逗号分隔，可多个）<input id="card-new-groups" type="text" value="${esc(m.groupsInput||'')}" oninput="updateFormPreview()" onkeydown="flowInputKeydown(event,'add')"></label></div><p id="operation-preview" class="preview">改动预览：新卡将是草稿；确认后立即生效。</p><button class="primary" onclick="submitNewCard()">创建卡片 · 立即生效</button>`;
 else if(m.kind==='groups')body=`<h2>修改分组 · ${esc(c.title)}</h2><label>分组标签（第一个用于色块）<input id="card-group-tags" type="text" value="${esc(m.groupsInput??c.groups.join('，'))}" oninput="updateFormPreview()" onkeydown="flowInputKeydown(event,'groups')"></label><p id="operation-preview" class="preview">改动预览：当前分组 ${esc(c.groups.join('、')||'未分组')}；保存后立即生效。</p><button class="primary" onclick="submitGroups()">保存标签</button>`;
 else {
  let items='';
  if(m.kind==='node')items=button('打开卡片详情',`go('card',${js(c.id)},event.currentTarget)`)+button('添加依赖到…',`flowDependencyMenu(${js(c.id)})`)+button('管理连线',`flowLinesMenu(${js(c.id)})`)+button('修改分组标签',`flowGroupInput(${js(c.id)})`)+(cardChildren(c.id).length?button(boardState.collapsedParents.has(c.id)?'展开子卡':'折叠子卡',`toggleParent(${js(c.id)})`):'')+button(c.pauseReasons?.includes('card:'+c.id)||c.pauseReasons?.includes('budget:a-budget')?'恢复卡片':'暂停卡片',`togglePause('card',${js(c.id)})`)+button('取消卡片',`cancelCard(${js(c.id)})`);
  else if(m.kind==='targets')items=projectCards(getProject(c.projectId)).filter(t=>t.id!==c.id).map(t=>button(`${t.title} · ${connectionReason(c.id,t.id)||'可连接'}`,`connectFlowNodes(${js(c.id)},${js(t.id)})`)).join('');
  else if(m.kind==='lines')items=projectEdges(getProject(c.projectId)).filter(e=>e.from===c.id||e.to===c.id).map(e=>button(`${getCard(e.from).title} → ${getCard(e.to).title}`,`flowEdgeMenu(${js(e.from)},${js(e.to)},event.currentTarget)`)).join('')||'<p>没有连线</p>';
  else if(m.kind==='edge')items=button(`删除依赖：${getCard(m.from).title} → ${getCard(m.to).title}`,`removeFlowEdge(${js(m.from)},${js(m.to)})`);
  body=`<h2>${m.kind==='targets'?'添加依赖到…':m.kind==='edge'?'连线菜单':m.kind==='lines'?'管理连线':'卡片菜单'}${c?' · '+esc(c.title):''}</h2><p class="src">改动立即生效；涉及进行中或已验收卡时先确认影响。</p><div role="menu" onkeydown="flowMenuKeydown(event)">${items}</div>`;
 }
 body=body.replace('<h2>','<h2 id="flow-menu-title">').replace('<div role="menu"','<div role="menu" aria-labelledby="flow-menu-title"');
 return `<div class="flow-edit-menu" role="dialog" aria-labelledby="flow-menu-title" onkeydown="flowDialogKeydown(event)">${body}<button class="flow-menu-close" onclick="closeFlowMenu()">关闭菜单</button></div>`;
}
// 指针路径沿用 017：实际 SVG 坐标命中目标，和键盘路径共用连接校验与提交。
function flowPointerPosition(event,svg) {const rect=svg.getBoundingClientRect(),box=svg.getAttribute('viewBox').split(/\s+/).map(Number);return [(event.clientX-rect.left)*box[2]/rect.width,(event.clientY-rect.top)*box[3]/rect.height];}
function beginFlowConnection(event,from) {
 if(!flowEditor.editing||flowViewport().vertical||event.button!==0)return;event.preventDefault();event.stopPropagation();cancelFlowDrag();
 const svg=event.currentTarget.closest('.flow-svg'),diagram=svg.closest('.flow-diagram'),p=boardProjection(getProject(diagram.dataset.projectId)),layout=layoutFlow(p,flowViewport(diagram.querySelector('.flow-canvas'))),n=layout.nodes.find(n=>n.id===from);
 const notice=$('#main').querySelector('.notice'),noticeWasHidden=notice?.getAttribute('hidden')!=null;notice?.setAttribute('hidden','');
 flowEditor.drag={from,svg,layout,pointerId:event.pointerId,start:[n.x+n.width,n.y+n.height/2],notice,noticeWasHidden};svg.setPointerCapture?.(event.pointerId);updateFlowConnection(event);
}
function updateFlowConnection(event) {
 const drag=flowEditor.drag;if(!drag||event.pointerId!==drag.pointerId)return;const point=flowPointerPosition(event,drag.svg),target=drag.layout.nodes.find(n=>point[0]>=n.x&&point[0]<=n.x+n.width&&point[1]>=n.y&&point[1]<=n.y+n.height);drag.to=target?.id||null;
 const status=$('#board-drag-feedback');if(status){status.removeAttribute('hidden');status.textContent=drag.to?(connectionReason(drag.from,drag.to)||'可连接：放下后立即生效'):'请拖到目标卡片上。';}
 const line=drag.svg.querySelector('.flow-temporary-line');line?.removeAttribute('hidden');line?.setAttribute('d',`M ${drag.start.join(' ')} L ${point.join(' ')}`);
 for(const node of drag.svg.querySelectorAll('.flow-node')){const reason=connectionReason(drag.from,node.dataset.cardId);node.classList.toggle('flow-drop-allowed',!reason);node.classList.toggle('flow-drop-forbidden',Boolean(reason));node.setAttribute('aria-description',reason||'可连接目标');const label=node.querySelector('.flow-drop-label');if(label){node.querySelector('.flow-drop-feedback')?.removeAttribute('hidden');label.removeAttribute('hidden');label.textContent=reason?('禁止：'+(reason.includes('循环')?'形成循环':reason.includes('自身')?'连向自身':reason.includes('重复')?'重复依赖':'不能连接')):'可连接';}}
}
function finishFlowConnection(event) {const drag=flowEditor.drag;if(!drag||event.pointerId!==drag.pointerId)return;updateFlowConnection(event);const {from,to}=drag;cancelFlowDrag();to?connectFlowNodes(from,to):feedback('未连接：请拖到当前项目的卡片上。');}
function cancelFlowDrag() {
 const drag=flowEditor.drag;if(!drag)return;try{if(drag.svg.hasPointerCapture?.(drag.pointerId))drag.svg.releasePointerCapture(drag.pointerId);}catch{}
 drag.svg.querySelector('.flow-temporary-line')?.setAttribute('hidden','');for(const n of drag.svg.querySelectorAll('.flow-node')){n.classList.remove('flow-drop-allowed','flow-drop-forbidden');n.removeAttribute('aria-description');n.querySelector('.flow-drop-label')?.setAttribute('hidden','');n.querySelector('.flow-drop-feedback')?.setAttribute('hidden','');}flowEditor.drag=null;$('#board-drag-feedback')?.setAttribute('hidden','');if(drag.notice?.isConnected&&!drag.noticeWasHidden)drag.notice.removeAttribute('hidden');
}
function renderSpec(c) {
 const entries=(items,test=false)=>items.map(i=>`<div class="row">${test?`<span class="tag">${TEST_TYPES[i.type]}</span> ${resultChip(i.result)} `:''}${esc(i.text)}<div class="src">来源：${esc(i.source)}</div></div>`).join('')||'<p class="empty">尚未填写</p>';
 return `<div class="spec-grid"><section class="card"><h2>需求</h2>${entries(c.requirements)}</section><section class="card"><h2>边界</h2>${entries(c.boundaries)}</section><section class="card"><h2>测试 · ${cardProgress(c)}</h2>${entries(c.tests,true)}</section></div><section class="card"><h2>交付物与资料来源</h2>${c.deliverables.map(path=>`<p>${previewReference(path,'artifact')}</p>`).join('')||'<p>尚未指定交付物</p>'}${c.sources.map(s=>`<div class="row">${previewReference(s.path)}<div class="src">${esc(s.note)}</div></div>`).join('')}</section><details class="card"><summary>规格版本历史 · v${c.specVersion}</summary>${c.specHistory.map(h=>`<div class="row"><b>规格 v${h.version}</b><p>${esc(h.note)}</p>${h.requirements.map(r=>`<p>${esc(r.text)} · 来源：${esc(r.source)}</p>`).join('')}</div>`).join('')}</details>`;
}
function resultChip(result) {return `<span class="chip s-${{pass:'integrated',fail:'cancelled',unverifiable:'paused',unprocessed:'draft'}[result]}">${RESULTS[result]}</span>`;}
function renderDependencies(c,p) {
 const downstream=projectCards(p).filter(d=>d.dependencies.includes(c.id));
 return `${renderFlowGraph(p,{focusId:c.id})}${renderFlowEditUI()}<div class="spec-grid"><section class="card"><h2>上游</h2>${c.dependencies.map(id=>`<div class="row">${cardLink(id)}<div class="src">使用产出 v${c.usedUpstreamVersions[id]??0} · 当前 v${getCard(id)?.outputVersion??0}</div></div>`).join('')||'<p>无上游</p>'}</section><section class="card"><h2>下游</h2>${downstream.map(d=>`<p>${cardLink(d.id)}</p>`).join('')||'<p>无下游</p>'}</section><section class="card"><h2>父卡与子卡</h2><p>父卡：${c.parentId?cardLink(c.parentId):'无'}</p>${cardChildren(c.id).map(d=>`<p>子卡：${cardLink(d.id)}</p>`).join('')||'<p>无子卡</p>'}</section></div>${c.upstreamChanged?`<p class="changed">⚠ 上游已变 · ${esc(c.upstreamChangeNote||'上游已有新产出，等待项目负责人判断。')}</p>`:''}<section class="card"><h2>产出版本历史</h2>${c.outputHistory.map(h=>`<div class="row"><b>产出 v${h.version}</b>${h.example?' · 示例':''}<p>${esc(h.summary)}</p><div class="src">${esc(h.sources.join('；'))}</div></div>`).join('')||'<p>尚无已验收产出</p>'}</section>`;
}
function renderAttempts(c) {
 const labels={success:'成功',failed:'失败',running:'进行中',limit:'达到预算上限'};
 return `<section class="card"><h2>执行过程 · ${c.attempts.length} 次尝试</h2>${c.attempts.map(a=>`<details class="attempt" open><summary>尝试 ${a.number} · ${labels[a.result]||'未记录'}${a.score?' · '+esc(a.score):''}</summary><p>${esc(a.method)}</p>${a.failure?`<p class="changed">${esc(a.failure)}</p>`:''}<div class="meta">执行者：${esc(a.actor)} · 模型：${esc(a.model||'未记录')} · 会话 ID：${esc(a.sessionId||'未记录')}</div><div class="meta">耗时：${esc(a.duration||'未记录')} · 花费：${a.cost==null?'未记录':'示例 ¥'+a.cost}</div><div class="src">出处：${esc((a.sourceFiles||[]).join('；'))}</div>${a.metadataNote?`<p class="src">${esc(a.metadataNote)}</p>`:''}${(a.steps||[]).map(step=>`<details class="card"><summary>${esc(step.title)} · ${RESULTS[step.status]||'未处理'}</summary><p>${esc(step.reason)}</p><p class="src">步骤与花费为示例；输入：${esc(step.input)}</p><pre>${esc(JSON.stringify(step.output,null,2))}</pre></details>`).join('')}</details>`).join('')||'<p class="empty">尚无尝试记录</p>'}</section>`;
}
function renderNode(c) {
 const p=getProject(c.projectId);
 const detail=`${crumb(p,c.title)}<label class="crumb">切换卡片<select aria-label="切换卡片" onchange="go('card',this.value)">${projectCards(p).map(n=>`<option value="${esc(n.id)}" ${n.id===c.id?'selected':''}>${esc(n.title)}</option>`).join('')}</select></label><h1>${esc(c.title)} ${c.example?'<span class="tag">示例</span>':''}</h1><div class="head">${chip(c.status)}<span>${cardVersions(c)}</span><span>负责人：${esc(memberName(c))}</span><span>${esc(c.groups.join(' · ')||'未分组')}</span><span>预算 ¥${c.budget} · 花费 ¥${c.spent}（${esc(c.budgetNote)}）</span></div><p class="src">${esc(c.recordNote)}</p>${(c.dispatches||c.attempts).some(d=>d.result==='unknown')?'<p class="dispatch-unknown">⚠ 状态不明 · 示例 · 有派单退出后未收到完成报告，等待项目负责人处理。</p>':''}<div class="actions"><button onclick="togglePause('card',${js(c.id)})">${c.pauseReasons?.includes('card:'+c.id)||c.pauseReasons?.includes('budget:a-budget')?'恢复卡片':'暂停卡片'}</button><button onclick="setUnread('card',${js(c.id)},true)">重新标为未读</button></div>${renderStatusEditor(c)}${upstreamWarnings(c).map(w=>`<p class="changed">${w}</p>`).join('')}<div class="tabs" role="tablist">${[['spec','规格'],['dependencies','依赖'],['execution','执行'],['files','文件'],['records','记录']].map(([tab,label])=>`<button role="tab" aria-selected="${view.tab===tab}" onclick="setCardTab(${js(tab)})">${label}</button>`).join('')}</div><div role="tabpanel">${view.tab==='dependencies'?renderDependencies(c,p):view.tab==='execution'?renderAttempts(c)+renderDispatchExecution(c):view.tab==='files'?renderFiles(c):view.tab==='records'?renderRecords(c):renderSpec(c)}</div>`;
 const saved=view.id,savedMenu=flowEditor.menu;view.id=p.id;flowEditor.menu=null;renderProject(p);flowEditor.menu=savedMenu;view.id=saved;
 $('#main').innerHTML+=`<div class="detail-backdrop" onclick="if(event.target===this){event.preventDefault();closeCardDetail();}"><section class="card-detail" role="dialog" aria-modal="true" aria-label="卡片详情" onkeydown="panelKeydown(event,'.card-detail',closeCardDetail)"><header class="panel-header"><h2>卡片详情</h2><button id="detail-close" onclick="closeCardDetail()">返回项目对话 · 关闭详情</button></header>${detail}</section></div>`;
 $('#board-content').setAttribute('inert','');$('#main').querySelector('.project-dialog')?.setAttribute('inert','');
}
function renderInbox() {
 const items=inboxItems();$('#main').innerHTML=`<h1 id="inbox-heading" tabindex="-1">收件箱</h1><p class="meta">需要你处理 ${items.length} 项</p>${['待回答','待批准','待验收','硬约束事项'].map(group=>`<section class="inbox-group"><h2>${group} · ${items.filter(i=>i.group===group).length}</h2>${items.filter(i=>i.group===group).map(i=>`<article class="inbox-item" data-inbox-id="${esc(i.id)}"><button onclick="jumpInbox(${js(i.id)},event.currentTarget)">${esc(i.title)}</button><p class="src">${esc(getProject(i.projectId).name)} · ${i.target==='card'?'前往卡片':i.target==='hard'?'前往事项处理':'前往项目对话'}</p>${i.target==='hard'?renderHardItem(byId(db.hardItems,i.ref)):''}</article>`).join('')||'<p>暂无</p>'}</section>`).join('')}`;
}
function renderHardItem(h){return `<div id="hard-${esc(h.id)}" tabindex="-1"><p>${esc(h.reason)}</p>${cardLink(h.cardId)} ${h.kind==='budget'?`<label>追加预算（元）<input id="hard-note-${h.id}" type="number" min="0.01" step="0.01"></label><button onclick="handleHard(${js(h.id)},'add',$('#hard-note-${h.id}').value)">记录追加预算</button><button onclick="handleHard(${js(h.id)},'cancel','你取消卡片')">取消卡片</button><p class="src">追加后仍保持暂停；处理预算后可在卡片详情恢复。</p>`:h.kind==='external'?`<button onclick="handleHard(${js(h.id)},'approve','示例 · 同意申请')">批准申请 · 示例记录</button><button onclick="handleHard(${js(h.id)},'reject','示例 · 暂不推送')">拒绝申请</button>`:`<label>核对结果<textarea id="hard-note-${h.id}"></textarea></label><button onclick="handleHard(${js(h.id)},'resolve',$('#hard-note-${h.id}').value)">记录核对结果</button>`}<p id="hard-error-${h.id}" role="status"></p></div>`;}
function renderProjects() {$('#main').innerHTML=`<h1>项目</h1><section class="card form-row"><h2>新建项目</h2><label>名称<input id="project-name"></label><label>类型<select id="project-type" onchange="$('#project-default').textContent=DEFAULT_REQUIREMENTS[this.value]||'无'">${Object.keys(DEFAULT_REQUIREMENTS).map(t=>`<option value="${esc(t)}">${t}</option>`).join('')}</select></label><p>默认项目要求：<span id="project-default">${DEFAULT_REQUIREMENTS.产品开发}</span></p><label>目标<textarea id="project-goal"></textarea></label><button onclick="createProject($('#project-name').value,$('#project-type').value,$('#project-goal').value)">创建项目</button><p id="project-error" role="status"></p></section>${db.projects.map(p=>`<section class="card"><h2><button onclick="go('project',${js(p.id)})">${esc(p.name)}</button>${p.example?' · 示例':''}</h2><p>${esc(p.goal)}</p>${renderBudget(p)}</section>`).join('')}`;}
function renderAgents() {
 const agentCard=a=>`<section class="card"><h2>${esc(a.name)} ${a.example?'· 示例配置':''}</h2><p>${esc(a.tasks||'')}</p><div class="meta">执行者：${esc(a.executor)} · 主模型：${esc(a.mainModel||a.model)} · 强度：${esc(a.mainStrength||a.strength||'未设置')}</div><div class="meta">步骤模型：${esc(a.stepModel||'未设置')}</div><p>${esc(a.instructions||'尚未填写代理指令')}</p><p class="src">工具：${esc((a.tools||[]).join('、')||'未设置')} · 示例统计：一次验收通过 ${a.stat?.firstPass||0}/${a.stat?.total||0}</p></section>`;
 $('#main').innerHTML=`<h1>代理库</h1><p class="meta">代理保存专业配置；项目负责人为卡片指派成员。</p>${db.agents.map(agentCard).join('')}<section class="card form-row"><h2>设计代理</h2><label>从模板开始<select id="agent-template" onchange="fillAgentTemplate(this.value)"><option value="">空白</option>${db.agentTemplates.map(a=>`<option value="${esc(a.id)}">${esc(a.name)} · 示例</option>`).join('')}</select></label><label>名称<input id="agent-name" type="text"></label><label>擅长的任务<input id="agent-tasks" type="text"></label><label>专业指令<textarea id="agent-instructions"></textarea></label><label>主模型<input id="agent-model" type="text" value="gpt-6.1-sol"></label><label>推理强度<select id="agent-strength"><option value="high">高</option><option value="medium">中</option><option value="low">低</option><option value="ultra">最高</option></select></label><label>步骤模型<input id="agent-stepModel" type="text" placeholder="空白表示不用于步骤调用"></label><label>技能与工具<input id="agent-tools" type="text" placeholder="逗号分隔"></label><label>资料范围<input id="agent-sources" type="text" placeholder="逗号分隔"></label><label>默认边界<textarea id="agent-boundaries"></textarea></label><label>默认测试<textarea id="agent-tests"></textarea></label><button class="primary" onclick="submitAgent()">创建代理</button><p id="agent-feedback" class="src" role="status"></p></section><section class="card"><h2>待批准的代理提议</h2>${db.agentProposals.filter(p=>p.status==='pending').map(p=>`<div class="row"><b>${esc(p.agent.name)}</b><p>${esc(p.reason)}</p><button onclick="approveAgent(${js(p.id)},true)">批准入库</button> <button onclick="approveAgent(${js(p.id)},false)">驳回</button></div>`).join('')||'<p>暂无</p>'}</section><section class="card"><h2>待批准的教训建议</h2>${db.lessonProposals.filter(p=>p.status==='pending').map(p=>`<div class="row"><p>${esc(p.text)}</p><p class="src">来源：${cardLink(p.cardId)}</p><button onclick="approveLesson(${js(p.id)},true)">写入代理默认边界</button> <button onclick="approveLesson(${js(p.id)},false)">驳回</button></div>`).join('')||'<p>暂无</p>'}</section>`;
}
function fillAgentTemplate(id) {
 const a=db.agentTemplates.find(a=>a.id===id);if(!a)return;for(const k of ['name','tasks','instructions','model','strength','stepModel'])$('#agent-'+k).value=a[k]||'';for(const k of ['tools','sources'])$('#agent-'+k).value=(a[k]||[]).join('，');$('#agent-boundaries').value=a.defaultBoundaries.map(b=>b.text).join('\n');$('#agent-tests').value=a.defaultTests.map(t=>t.text).join('\n');
}
function submitAgent() {
 const a={id:'agent-'+(++db.serial),executor:'Codex CLI',example:false,stat:{firstPass:0,total:0}};for(const k of ['name','tasks','instructions','model','strength','stepModel'])a[k]=$('#agent-'+k).value.trim();if(!a.name||!a.model){$('#agent-feedback').textContent='请填写名称与模型。';return {ok:false};}for(const k of ['tools','sources'])a[k]=$('#agent-'+k).value.split(/[，,]/).map(s=>s.trim()).filter(Boolean);a.defaultBoundaries=$('#agent-boundaries').value.split('\n').filter(Boolean).map(text=>({text,source:'代理默认'}));a.defaultTests=$('#agent-tests').value.split('\n').filter(Boolean).map(text=>({text,source:'代理默认',type:'evidence',result:'unprocessed'}));db.agents.push(a);recordDecision(null,null,'创建代理：'+a.name,'你直接创建代理配置。');render();return {ok:true};
}
function approveAgent(id,accept) {const p=db.agentProposals.find(p=>p.id===id);if(!p||p.status!=='pending')return;const c=getCard(p.cardId);p.status=accept?'approved':'rejected';if(accept)db.agents.push({...p.agent,id:'agent-'+(++db.serial),example:true,defaultBoundaries:[],defaultTests:[]});recordDecision(c.projectId,c.id,(accept?'批准':'驳回')+'代理提议',p.reason);render();}
function approveLesson(id,accept) {const p=db.lessonProposals.find(p=>p.id===id);if(!p||p.status!=='pending')return;p.status=accept?'approved':'rejected';if(accept)getAgent(p.agentId).defaultBoundaries.push({text:p.text,source:'代理默认'});const c=getCard(p.cardId);recordDecision(c.projectId,c.id,(accept?'采纳':'驳回')+'教训建议',p.text);render();}
function experienceCards(search='',tag='') {
 return db.experience.filter(e=>(!search||(e.title+e.content).includes(search))&&(!tag||e.tags.includes(tag))).map(e=>`<section class="card"><h2>${esc(e.title)} · ${esc(e.status)}</h2><p>${esc(e.content)}</p><p class="src">${esc(e.tags.join(' · '))} · 来源 ${cardLink(e.cardId)}</p>${e.note?`<p class="src">${esc(e.note)}</p>`:''}${(e.sources||[]).map(s=>`<p class="src">${esc(s)}</p>`).join('')}${e.status==='待审核'?`<button onclick="reviewExperience(${js(e.id)},true)">审核入库</button> <button onclick="reviewExperience(${js(e.id)},false)">驳回</button>`:''}</section>`).join('')||'<p class="empty">没有匹配条目</p>';
}
function renderExperience() {$('#main').innerHTML=`<h1>经验库</h1><p class="meta">事实、知识、教训与风险可跨项目复用。</p><div class="toolbar"><label>搜索<input id="experience-search" type="text" oninput="filterExperience()"></label><label>标签<select id="experience-tag" onchange="filterExperience()"><option value="">全部</option>${[...new Set(db.experience.flatMap(e=>e.tags))].map(t=>`<option>${esc(t)}</option>`).join('')}</select></label></div><div id="experience-results">${experienceCards()}</div>`;}
function filterExperience() {$('#experience-results').innerHTML=experienceCards($('#experience-search').value,$('#experience-tag').value);}
function reviewExperience(id,accept) {const e=db.experience.find(e=>e.id===id);if(!e||e.status!=='待审核')return;e.status=accept?'已入库':'已驳回';const c=getCard(e.cardId);recordDecision(c.projectId,c.id,(accept?'审核入库':'驳回')+'经验：'+e.title,e.content);filterExperience();}

function renderDecisions() {
 const stats=decisionStats();$('#main').innerHTML=`<h1>决策记录</h1><p id="adoption-stats">原样采纳率 ${stats.rate}% · ${stats.adopted}/${stats.total}（只统计有推荐答案或提议的决定；撤销不算采纳）</p><section class="card">${db.decisions.slice().reverse().map(d=>`<article class="row decision-row" id="decision-${esc(d.id)}" tabindex="-1"><b>${esc(d.title)}</b> <span class="tag">决策者：${esc(d.decisionMaker)}</span>${d.delegated?'<span class="tag">代你做的决定 · 示例</span>':''}${d.revoked?'<span class="revoked">已撤销</span>':''}<p>理由：${esc(d.reason)}</p>${d.organizationReason?`<p class="organization-reason">组织理由：${esc(d.organizationReason)}</p>`:''}<p>是否原样采纳：${d.adoptedAsIs===true?'是':d.adoptedAsIs===false?'否（修改或驳回）':'不适用'}</p><div class="src">${esc(d.time)} · ${esc(d.outcome)} · ${esc(getProject(d.projectId)?.name||'公共库')} ${d.cardId?cardLink(d.cardId):''}</div>${d.delegated&&d.decisionMaker==='项目负责人'&&!d.revoked?`<button data-revoke="${esc(d.id)}" onclick="revokeDecision(${js(d.id)})">撤销代做的决定</button>`:''}</article>`).join('')||'<p>暂无记录</p>'}</section>`;
}
function renderMemory(p) {
 $('#main').innerHTML=`${crumb(p,'项目记忆')}<h1>项目记忆</h1>${[['instructions','项目指令'],['requirements','项目要求'],['authorization','授权说明']].map(([key,label])=>`<section class="card requirement-editor"><h2>${label}</h2><label>${label}<textarea id="requirement-${key}">${esc(p[key])}</textarea></label><p class="src">最后修改：${esc(p.requirementEdits[key].time)} · 修改人：${esc(p.requirementEdits[key].actor)}</p><button onclick="saveRequirement(${js(p.id)},${js(key)},$('#requirement-${key}').value)">保存${label}</button></section>`).join('')}<section class="card"><h2>设计决策</h2>${db.decisions.filter(d=>d.projectId===p.id).map(d=>`<div class="row">${esc(d.title)}<p>${esc(d.reason)}</p></div>`).join('')||'<p>暂无记录</p>'}</section><section class="card"><h2>访谈决策清单</h2>${db.interviews.filter(i=>i.projectId===p.id).map(i=>i.questions.filter(q=>q.answer!==null).map(q=>`<p>第 ${i.round} 轮 ${esc(q.type)}：${esc(q.answer)}</p>`).join('')).join('')||'<p>暂无</p>'}</section><section class="card"><h2>领域词汇</h2>${(p.memory.glossary||[]).map(t=>`<p>${esc(t)}</p>`).join('')||'<p>暂无</p>'}</section><section class="card"><h2>注意事项</h2>${p.memory.cautions.map(s=>`<p>${esc(s)}</p>`).join('')}</section><section class="card"><h2>已验收卡片版本</h2>${projectCards(p).filter(c=>c.outputHistory.length).map(c=>`<div class="row">${cardLink(c.id)} · ${c.outputHistory.map(h=>'产出 v'+h.version).join('、')}</div>`).join('')||'<p>暂无已验收版本</p>'}</section>`;
}
function renderSettings(p) {$('#main').innerHTML=`${crumb(p,'项目设置')}<h1>项目设置</h1><section class="card"><h2>工作现场</h2><p>${esc(p.site)}</p><p>项目负责人：${esc(getAgent(p.leaderId)?.name)}</p><p>执行者：${esc(p.executor)}</p><p class="src">纯前端模拟；不调用真实执行端。</p></section><section class="card"><h2>预算与花费</h2>${renderBudget(p)}</section><section class="card"><h2>自动验收条件</h2><p>${esc(p.autoAcceptance)}</p><h2>预设指派规则</h2><p>${esc(p.assignmentRules)}</p><p class="src">当前值只读；编辑第 4 批或以后提供。</p></section><section class="card"><h2>启用的打法</h2><p>${esc(p.playbooks.join('、')||'无')}</p><h2>运行资源模板</h2><p>${esc(p.resourceTemplate)}</p><h2>禁止动作清单</h2><p>${esc(p.forbiddenActions)}</p></section><button onclick="go('decisions')">查看决策记录</button>`;}
function render({preserveScroll=true}={}) {
 for(const c of Object.values(db.cards))ensureCardRuntime(c);
 for(const s of Object.values(db.sessions))for(const o of s.output)o.text='示例 · '+demoText(o.text);
 const restoringMenu=Boolean(flowMenuOrigin),active=document.activeElement,origin=focusDescriptor(active),hadFocus=$('#main').contains?.(active);const viewport=preserveScroll?captureBoardViewport():null;clearPageScrollTail();
 renderSide();if(view.page==='card'||view.page==='project'&&window.innerWidth<=760&&panels.conversation)$('#side').setAttribute('inert','');else $('#side').removeAttribute('inert');const p=getProject(view.id),c=getCard(view.id);
 if(view.page==='project'&&p)renderProject(p);else if(view.page==='card'&&c)renderNode(c);else if(view.page==='timeline'&&p)renderTimeline(p);else if(view.page==='team'&&p)renderTeam(p);else if(view.page==='inbox')renderInbox();else if(view.page==='projects')renderProjects();else if(view.page==='agents')renderAgents();else if(view.page==='experience')renderExperience();else if(view.page==='decisions')renderDecisions();else if(view.page==='memory'&&p)renderMemory(p);else if(view.page==='settings'&&p)renderSettings(p);else $('#main').innerHTML='<p class="empty">当前对象不存在，请从侧栏选择项目。</p>';
 if(!['project','card','team','timeline'].includes(view.page))$('#main').innerHTML+=renderRuntimeNotices(p?.id||c?.projectId||null);if(sessionPanel.id){$('#main').innerHTML='<div id="session-base" inert>'+$('#main').innerHTML+'</div>'+renderSessionPanel();$('#board-content')?.setAttribute('inert','');$('#main').querySelector('.project-dialog')?.setAttribute('inert','');$('#side').setAttribute('inert','');const output=$('#session-output');if(output)output.scrollTop=output.scrollHeight||0;}refreshFlowLayout({preserveScroll:false});restoreBoardViewport(viewport);positionFlowMenu();if(!flowEditor.menu){if(['project','card'].includes(view.page))restoreFlowMenuFocus();else flowMenuOrigin=null;}if(hadFocus&&!restoringMenu&&active?.isConnected===false&&!flowEditor.menu)restoreDescriptor(origin,view.page==='card'?'#detail-close':panels.conversation?'#conversation-close':'#board-surface');
}
// 项目对话与收件箱共用事项数据；所有动作仅在当前页面内存中保存。
const panels={conversation:window.innerWidth>760,conversationOrigin:null,conversationReturn:null,detailOrigin:null,detailReturn:null,notice:'',proposalEdit:null,proposalReject:null};
const now=()=>new Date().toLocaleString('sv-SE');
const byId=(list,id)=>list.find(x=>x.id===id);
function inboxItems(projectId=null){
 const items=[];
 for(const i of db.interviews)if(i.questions.some(q=>q.answer===null)&&!db.interviews.some(prev=>prev.projectId===i.projectId&&prev.round<i.round&&prev.questions.some(q=>q.answer===null)))items.push({id:i.id,projectId:i.projectId,group:'待回答',title:'示例 · 访谈第 '+i.round+' 轮',target:'conversation',ref:i.id,cardIds:[]});
 for(const q of db.questions)if(q.answer===null&&(!db.gates.find(g=>g.questionId===q.id)||db.gates.find(g=>g.questionId===q.id).answerBy==='你'))items.push({id:q.id,projectId:q.projectId,group:'待回答',title:q.text,target:'conversation',ref:q.id,cardIds:[q.cardId]});
 for(const p of db.proposals)if(p.status==='pending')items.push({id:p.id,projectId:p.projectId,group:'待批准',title:'示例 · '+(p.newScope?'新范围 · ':'')+p.cards.map(c=>c.title).join('、'),target:'conversation',ref:p.id,cardIds:p.cards.flatMap(c=>[c.id,...c.dependencies]).filter(id=>getCard(id))});
 for(const c of Object.values(db.cards))if(c.status==='review')items.push({id:'review-'+c.id,projectId:c.projectId,group:'待验收',title:c.title,target:'card',ref:c.id,cardIds:[c.id]});
 for(const h of db.hardItems)if(h.status==='pending')items.push({id:h.id,projectId:h.projectId,group:'硬约束事项',title:h.title,target:'hard',ref:h.id,cardIds:[h.cardId]});
 return items.filter(x=>!projectId||x.projectId===projectId);
}
function activeMemberCount(p){return Object.values(db.sessions).filter(s=>s.projectId===p.id&&s.role==='member'&&!sessionPaused(s)&&['running','waiting-workflow'].includes(s.roundState)).length;}
function focusDescriptor(el=document.activeElement){return el?{id:el.getAttribute?.('id'),onclick:el.getAttribute?.('onclick'),cardId:el.closest?.('[data-card-id]')?.dataset.cardId}:null;}
function restoreDescriptor(origin,fallback='#board-surface'){
 const main=$('#main');const target=(origin?.preferCard&&[...main.querySelectorAll('.flow-node')].find(n=>n.dataset.cardId===origin.cardId))||(origin?.id&&main.querySelector('#'+origin.id))||(origin?.onclick&&[...main.querySelectorAll('[onclick]')].find(n=>!n.closest?.('.flow-edit-menu')&&n.getAttribute('onclick')===origin.onclick))||(origin?.cardId&&[...main.querySelectorAll('[data-card-id]')].find(n=>n.dataset.cardId===origin.cardId));
 const focusTarget=target?.classList?.contains('board-card')?target.querySelector('.card-title'):target;
 (focusTarget||main.querySelector(fallback)||main.querySelector('#conversation-toggle')||main.querySelector('#inbox-heading')||main.querySelector('#detail-close')||main)?.focus?.({preventScroll:true});
}
function toggleConversation(trigger){
 const opening=!panels.conversation;
 if(opening){panels.conversationOrigin=focusDescriptor(trigger||$('#conversation-toggle'));panels.conversationReturn=null;}
 panels.conversation=opening;const back=!opening&&panels.conversationReturn;panels.conversationReturn=null;if(back)go(back.page,back.id);else render();
 if(opening)$('#conversation-close')?.focus?.({preventScroll:true});else restoreDescriptor(panels.conversationOrigin,'#conversation-toggle');
}
function closeConversation(){if(panels.conversation)toggleConversation();}
function closeCardDetail(){
 const origin=panels.detailOrigin,back=panels.detailReturn||{page:'project',id:getCard(view.id)?.projectId};
 panels.detailOrigin=null;panels.detailReturn=null;go(back.page,back.id);restoreDescriptor(origin);
}
function panelKeydown(event,selector,close){
 if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();return;}
 if(event.key==='Tab'&&(selector==='.card-detail'||selector==='.session-detail'||window.innerWidth<=760)){
 const panel=$('#main').querySelector(selector),items=[...panel.querySelectorAll('*')].filter(n=>['BUTTON','INPUT','TEXTAREA','SELECT'].includes(n.tagName)&&!n.disabled&&n.getAttribute('disabled')==null);
 const first=items[0],last=items.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
 }
}
function pausePlaceholder(){return togglePause('project',getProject(view.id)?.id||getCard(view.id)?.projectId);}
function conversationJump(projectId,ref,trigger){
 const wasOpen=panels.conversation;panels.conversationReturn=view.page==='inbox'?{page:view.page,id:view.id}:null;panels.conversation=true;panels.conversationOrigin=focusDescriptor(trigger||$('#conversation-toggle'));
 go('project',projectId);const target=$('#main').querySelector('#message-'+ref);target?.focus?.();target?.scrollIntoView?.({block:'center'});
 if(!target&&!wasOpen)$('#conversation-close')?.focus?.();
}
function jumpInbox(id,trigger){const item=byId(inboxItems(),id);if(!item)return;if(item.target==='card')go('card',item.ref,trigger);else if(item.target==='hard'){go('inbox');const target=$('#main').querySelector('#hard-'+item.ref);target?.focus();target?.scrollIntoView?.({block:'center'});}else conversationJump(item.projectId,item.ref,trigger);}
function addMessage(p,speaker,text,example=false){p.conversation.push({id:'message-'+(++db.serial),kind:'message',speaker,text,time:now(),example});}
function sendMessage(projectId,text=$('#chat-input').value){text=String(text||'').trim();if(!text)return {ok:false,reason:'请输入消息'};const p=getProject(projectId);addMessage(p,'你',text);addMessage(p,'项目负责人','示例 · 已记录你的补充；涉及新范围会按授权说明先提交提议，其他工作继续按当前要求推进。',true);render();$('#chat-input')?.focus();$('#message-'+p.conversation.at(-1).id)?.scrollIntoView?.({block:'end'});return {ok:true};}
function answerInterview(id,qid,answer,adopted=false){
 const i=byId(db.interviews,id),q=i&&byId(i.questions,qid);answer=String(answer||'').trim();
 if(!q||q.answer!==null||!answer||db.interviews.some(prev=>prev.projectId===i.projectId&&prev.round<i.round&&prev.questions.some(x=>x.answer===null)))return {ok:false};
 q.answer=answer;q.adopted=adopted;const d=recordDecision(i.projectId,null,'回答访谈第 '+i.round+' 轮 '+qid.toUpperCase(),q.text+' 回答：'+answer);d.adoptedAsIs=answer===q.recommended;d.outcome='已回答';
 if(i.questions.every(q=>q.answer!==null)){const next=db.interviews.find(n=>n.projectId===i.projectId&&n.round===i.round+1);addMessage(getProject(i.projectId),'项目负责人',next?'示例 · 本轮已答完，请继续下一轮。':'示例 · 两轮已答完；请确认共同理解。尚未确认时访谈保持待处理。',true);if(!next)db.questions.push({id:'understanding-'+(++db.serial),projectId:i.projectId,cardId:null,kind:'understanding',text:'示例 · 确认访谈共同理解：各分支已处理，且没有未说明的假设？',recommended:'确认，按已记录的需求、边界和验收标准继续。',answer:null,time:now()});const latest=db.questions.at(-1);if(!next)getProject(i.projectId).conversation.push({id:latest.id,kind:'question',ref:latest.id,time:latest.time,example:true});}
 render();restoreDescriptor({id:'message-'+id});return {ok:true};
}
function adoptInterview(id){const i=byId(db.interviews,id);if(!i)return {ok:false};for(const q of i.questions)if(q.answer===null){const r=answerInterview(id,q.id,q.recommended,true);if(!r.ok)return r;}return {ok:true};}
function replayInterview(projectId){
 if(db.interviews.some(i=>i.projectId===projectId&&i.questions.some(q=>q.answer===null)))return;
 const originals=db.interviews.filter(i=>i.projectId===projectId).slice(0,2);const start=Math.max(0,...db.interviews.filter(i=>i.projectId===projectId).map(i=>i.round));
 for(const [n,old] of originals.entries()){const i={...old,id:'interview-'+(++db.serial),round:start+n+1,time:now(),questions:old.questions.map(q=>({...q,answer:null,adopted:false}))};db.interviews.push(i);getProject(projectId).conversation.push({id:i.id,kind:'interview',ref:i.id,time:i.time,example:true});}
 render();const first=db.interviews.find(i=>i.projectId===projectId&&i.questions.some(q=>q.answer===null));$('#message-'+first.id)?.focus();
}
function answerQuestion(id,answer,adopted=false){const q=byId(db.questions,id);answer=String(answer||'').trim();if(!q||q.answer!==null||!answer)return {ok:false};q.answer=answer;resolveGateForQuestion(q);const d=recordDecision(q.projectId,q.cardId,'回答项目负责人：'+q.text,answer);d.adoptedAsIs=answer===q.recommended;d.outcome='已回答';addMessage(getProject(q.projectId),'项目负责人','示例 · 已收到你的回答，将据此继续。',true);render();restoreDescriptor({id:'message-'+id});return {ok:true};}
function proposalAction(id,action){const p=byId(db.proposals,id);if(p?.status!=='pending')return {ok:false};panels.proposalEdit=action==='modify'?id:null;panels.proposalReject=action==='reject'?id:null;render();$('#main').querySelector(action==='modify'?'#proposal-title-0':'#proposal-reason')?.focus();return {ok:true};}
function saveProposalForm(id){const p=byId(db.proposals,id);const cards=p.cards.map((c,n)=>({...c,title:$('#proposal-title-'+n).value.trim(),requirements:$('#proposal-req-'+n).value.trim(),groups:$('#proposal-group-'+n).value.split(/[，,]/).map(s=>s.trim()).filter(Boolean)}));return resolveProposal(id,'modified',{cards});}
function resolveProposal(id,result,{cards,reason}={}){
 const p=byId(db.proposals,id);if(p?.status!=='pending')return {ok:false};
 if(result==='rejected'&&!String(reason||'').trim()){const e=$('#main').querySelector('#proposal-error');if(e)e.textContent='请写明驳回理由。';return {ok:false,reason:'请写明驳回理由'};}
 if(!['confirmed','modified','rejected'].includes(result))return {ok:false};
 const chosen=result==='modified'?cards:p.cards;
 const original=p.cards.map(c=>({title:c.title,requirements:c.requirements,groups:c.groups}));
 if(result!=='rejected'&&(!chosen||chosen.length!==p.cards.length||chosen.some(c=>!c.title?.trim()||!c.requirements?.trim()||!c.groups?.length))){const e=$('#main').querySelector('#proposal-error');if(e)e.textContent='每张卡都需要标题、需求和分组。';return {ok:false};}
 if(result!=='rejected'){
 p.cards=chosen.map((c,n)=>({...c,id:p.cards[n].id,dependencies:p.cards[n].dependencies.slice()}));
 // 不调用看板新建动作，整组提议只写一条确认决策。
 for(const spec of p.cards){const c={id:spec.id,projectId:p.projectId,title:spec.title,requirements:[{text:spec.requirements,source:result==='modified'?'你':'项目负责人'}],boundaries:[{text:getProject(p.projectId).instructions,source:'项目指令'}],tests:[],deliverables:[],sources:[{path:'项目对话/'+id,note:'示例 · 你确认的新范围提议'}],dependencies:spec.dependencies.slice(),groups:spec.groups.slice(),parentId:null,memberId:null,budget:0,spent:0,budgetNote:'示例 · 待分配',specVersion:1,specHistory:[],outputVersion:0,outputHistory:[],usedUpstreamVersions:Object.fromEntries(spec.dependencies.map(id=>[id,getCard(id)?.outputVersion||0])),upstreamChanged:false,statusLine:'示例 · 规格已确认，等待开工',status:'ready',attempts:[],example:true,recordNote:'示例 · 项目对话提议',independentVerification:null};c.specHistory=[{version:1,requirements:c.requirements.map(r=>({...r})),boundaries:c.boundaries.map(r=>({...r})),tests:[],note:'示例 · 提议确认'}];freezeHistories(c);db.cards[c.id]=c;getProject(p.projectId).cardIds.push(c.id);}
 }
 p.status=result;p.rejectionReason=result==='rejected'?reason.trim():null;const d=recordDecision(p.projectId,null,({confirmed:'确认',modified:'修改后确认',rejected:'驳回'}[result])+'提议：'+p.cards.map(c=>c.title).join('、'),result==='rejected'?reason.trim():p.reason);d.organizationReason=p.reason;d.adoptedAsIs=result!=='rejected'&&JSON.stringify(original)===JSON.stringify(p.cards.map(c=>({title:c.title,requirements:c.requirements,groups:c.groups})));d.outcome=result==='rejected'?'已驳回':'已确认';d.affectedCardIds=result==='rejected'?[]:p.cards.map(c=>c.id);p.decisionId=d.id;panels.proposalEdit=null;panels.proposalReject=null;render();restoreDescriptor({id:'message-'+id});return {ok:true,cardIds:d.affectedCardIds};
}
function decisionJump(id){go('decisions');$('#decision-'+id)?.focus();$('#decision-'+id)?.scrollIntoView?.({block:'center'});}
function revokeDecision(id){
 const d=byId(db.decisions,id);if(!d||d.decisionMaker!=='项目负责人'||!d.delegated||d.revoked)return {ok:false};
 const affected=(d.affectedCardIds||[d.cardId]).map(getCard).filter(Boolean);
 // 已结束的登记保留；进行中的工作保留，已验收重开，尚未开工退回草稿。
 for(const c of affected){if(c.status==='accepted'){c.status='running';c.independentVerification=null;}else if(['ready','draft'].includes(c.status))c.status='draft';if(c.dependencies.some(id=>getCard(id)?.outputVersion>c.usedUpstreamVersions[id]))c.upstreamChanged=true;}
 d.revoked=true;const undo=recordDecision(d.projectId,d.cardId,'撤销项目负责人代做的决定：'+d.title,'由你撤销；已验收卡回到进行中，未开工卡回到草稿。');undo.revokes=id;undo.affectedCardIds=affected.map(c=>c.id);undo.adoptedAsIs=null;render();restoreDescriptor({id:view.page==='decisions'?'decision-'+id:'message-'+id});return {ok:true};
}
function saveRequirement(projectId,key,text){if(!['instructions','requirements','authorization'].includes(key))return {ok:false};const p=getProject(projectId);text=String(text??'').trim();if(text===p[key])return {ok:true,unchanged:true};const before=p[key];p[key]=text;p.requirementEdits[key]={time:now(),actor:'你'};const d=recordDecision(projectId,null,'修改'+({instructions:'项目指令',requirements:'项目要求',authorization:'授权说明'}[key]),'修改前：'+before+'；修改后：'+text);d.before=before;d.after=text;render();$('#requirement-'+key)?.focus();return {ok:true};}
function createProject(name,type,goal){name=String(name||'').trim();goal=String(goal||'').trim();if(!name||!goal||!Object.hasOwn(DEFAULT_REQUIREMENTS,type)){const e=$('#main').querySelector('#project-error');if(e)e.textContent='请填写项目名称、目标和类型。';return {ok:false};}const id='project-'+(++db.serial),p={id,name,type,goal,site:'尚未绑定',leaderId:type==='客户交付'?'agent-pm-client':'agent-pm-dev',instructions:'',requirements:DEFAULT_REQUIREMENTS[type],authorization:'新范围的卡先问我',budget:0,spent:0,budgetNote:'尚未设置预算',cardIds:[],memory:{cautions:[],glossary:[]},executor:'Codex CLI',example:false,conversation:[],requirementEdits:Object.fromEntries(['instructions','requirements','authorization'].map(k=>[k,{time:now(),actor:'你'}])),autoAcceptance:'未设置，由你验收',assignmentRules:'未设置',playbooks:type==='产品开发'?['设计','开发','缺陷','调研']:type==='客户交付'?['承接评估','交付']:type==='调研'?['调研']:[],resourceTemplate:'未设置',forbiddenActions:'未设置'};db.projects.push(p);recordDecision(id,null,'新建项目：'+name,'项目类型：'+type+'；默认项目要求：'+p.requirements);go('project',id);return {ok:true,id};}
function handleHard(id,action,note){const h=byId(db.hardItems,id);if(!h||h.status!=='pending')return {ok:false};
 note=String(note||'').trim();const c=getCard(h.cardId);
 if(h.kind==='budget'&&action==='add'){const amount=Number(note);if(!Number.isFinite(amount)||amount<=0){$('#hard-error-'+id).textContent='请输入大于 0 的追加预算。';return {ok:false};}c.budget+=amount;}
 else if(h.kind==='budget'&&action==='cancel'){c.status='cancelled';}
 else if(h.kind==='unknown'&&!note){$('#hard-error-'+id).textContent='请填写核对结果。';return {ok:false};}
 else if(!((h.kind==='external'&&['approve','reject'].includes(action))||(h.kind==='unknown'&&action==='resolve')))return {ok:false};
 h.status='handled';h.resolution={action,note};const d=recordDecision(h.projectId,h.cardId,'处理硬约束事项：'+h.title,action+'；'+(note||'由你决定'));d.outcome='仅记录示例处理';render();$('#main').querySelector('#inbox-heading')?.focus();return {ok:true};}
function renderInterview(i){
 const locked=db.interviews.some(prev=>prev.projectId===i.projectId&&prev.round<i.round&&prev.questions.some(q=>q.answer===null)),done=i.questions.every(q=>q.answer!==null);
 return `<h3>访谈第 ${i.round} 轮 · 示例</h3>${i.questions.map((q,n)=>`<div class="interview-question"><b>Q${n+1} ${esc(q.text)}</b> <span class="question-type">${esc(q.type)}</span><p>推荐答案：${esc(q.recommended)}</p>${q.answer!==null?`<p class="user-answer">你：${esc(q.answer)} · ${q.adopted?'采纳推荐答案':'逐题回答'}</p>`:`<label>你的回答<textarea id="interview-${i.id}-${q.id}" ${locked?'disabled':''}></textarea></label><button ${locked?'disabled':''} onclick="answerInterview(${js(i.id)},${js(q.id)},$('#interview-${esc(i.id)}-${q.id}').value)">记录 Q${n+1} 回答</button> <button ${locked?'disabled':''} onclick="answerInterview(${js(i.id)},${js(q.id)},${js(q.recommended)},true)">采纳 Q${n+1} 推荐答案</button>`}</div>`).join('')}${done?`<p>本轮已答完。${db.interviews.some(n=>n.projectId===i.projectId&&n.round===i.round+1)?'下一轮见下方。':'访谈问答已记录；共同理解的确认见对话。'}</p>`:`<button ${locked?'disabled':''} onclick="adoptInterview(${js(i.id)})">采纳推荐答案 · 本轮</button>${locked?'<p>请先答完上一轮。</p>':''}`}`;
}
function renderProposal(p){const editing=panels.proposalEdit===p.id,rejecting=panels.proposalReject===p.id;return `<h3>提议 · ${p.newScope?'新范围 · ':''}示例</h3><p class="organization-reason">组织理由：${esc(p.reason)}</p><div class="proposal-cards">${p.cards.map((c,n)=>`<article class="proposal-card"><b>${esc(c.title)}</b><p>规格摘要：${esc(c.requirements)}</p><p class="src">分组：${esc(c.groups.join('、'))} · 依赖：${esc(c.dependencies.map(id=>getCard(id)?.title||p.cards.find(c=>c.id===id)?.title||id).join('、')||'无')}</p>${editing?`<label>标题<input id="proposal-title-${n}" value="${esc(c.title)}"></label><label>需求<textarea id="proposal-req-${n}">${esc(c.requirements)}</textarea></label><label>分组<input id="proposal-group-${n}" value="${esc(c.groups.join('，'))}"></label>`:''}</article>`).join('')}</div>${p.status==='pending'?`<div class="actions"><button class="primary" onclick="resolveProposal(${js(p.id)},'confirmed')">确认</button><button onclick="proposalAction(${js(p.id)},'modify')">修改</button><button onclick="proposalAction(${js(p.id)},'reject')">驳回</button></div>${editing?`<button class="primary" onclick="saveProposalForm(${js(p.id)})">保存修改并确认整组</button>`:''}${rejecting?`<label>驳回理由<textarea id="proposal-reason" required></textarea></label><button onclick="resolveProposal(${js(p.id)},'rejected',{reason:$('#proposal-reason').value})">提交驳回</button>`:''}<p id="proposal-error" role="status"></p>`:`<p>你已${({confirmed:'确认',modified:'修改后确认',rejected:'驳回'}[p.status])}。${esc(p.rejectionReason||'')}</p><button onclick="decisionJump(${js(p.decisionId)})">查看对应决策</button>`}`;}
function renderQuestion(q){const gate=db.gates.find(g=>g.questionId===q.id);return `${gate?`<p class="question-type">决策关卡 · ${gate.status==='waiting'?'等待'+esc(gate.answerBy):'已关闭'} · 示例</p><p>选项：${gate.options.map(esc).join(' / ')}</p>`:''}<h3>${q.kind==='member'?`来自卡「${esc(getCard(q.cardId)?.title)}」的成员`:'项目负责人的提问'}</h3>${q.kind==='member'?`<p class="src">来自某个 agent：${esc(getAgent(db.members[getCard(q.cardId)?.memberId]?.agentId)?.name||'未记录')} · 经项目负责人转问 · 示例</p>`:''}<p>${esc(q.text)}</p><p>推荐答案：${esc(q.recommended)}</p>${q.answer!==null?`<p class="user-answer">你：${esc(q.answer)}</p>`:`<label>你的回答<textarea id="answer-${esc(q.id)}"></textarea></label><button onclick="answerQuestion(${js(q.id)},$('#answer-${esc(q.id)}').value)">回答</button> <button onclick="answerQuestion(${js(q.id)},${js(q.recommended)},true)">采纳推荐答案</button>`}`;}
function renderDelegated(d){return `<p>示例 · 代你做的决定：${esc(d.title)} ${d.revoked?'<span class="revoked">已撤销</span>':''}<button onclick="decisionJump(${js(d.id)})">查看决策记录</button>${d.revoked?'':` <button onclick="revokeDecision(${js(d.id)})">撤销</button>`}</p>`;}
function renderConversation(p){if(!panels.conversation)return '';return `<section class="project-dialog" role="${window.innerWidth<=760?'dialog':'complementary'}" ${window.innerWidth<=760?'aria-modal="true"':''} aria-labelledby="conversation-title" onkeydown="panelKeydown(event,'.project-dialog',closeConversation)"><header class="panel-header"><h2 id="conversation-title">项目对话</h2><button id="conversation-close" onclick="toggleConversation()">返回看板 · 收起对话</button></header><p class="src">你 ↔ 项目负责人 · 所有模拟内容均标示例</p><div class="conversation-messages">${p.conversation.slice().sort((a,b)=>a.time.localeCompare(b.time)).map(m=>`<article id="message-${esc(m.id)}" class="conversation-bubble ${m.speaker==='你'?'bubble-user':''}" tabindex="-1"><div class="src">${esc(m.speaker||'项目负责人')} · ${m.example?'示例 · ':''}${esc(m.time)}</div>${m.kind==='interview'?renderInterview(byId(db.interviews,m.ref)):m.kind==='proposal'?renderProposal(byId(db.proposals,m.ref)):m.kind==='question'?renderQuestion(byId(db.questions,m.ref)):m.kind==='delegated'?renderDelegated(byId(db.decisions,m.ref)):`<p>${esc(m.text)}</p>`}</article>`).join('')}</div>${p.id==='project-a'?`<button onclick="replayInterview(${js(p.id)})">重新演示访谈两轮 · 示例</button>`:''}<label>给项目负责人发消息<textarea id="chat-input" placeholder="补充需求或约束"></textarea></label><button class="primary" onclick="sendMessage(${js(p.id)})">发送</button></section>`;}
function decisionStats(decisions=db.decisions){const proposals=decisions.filter(d=>typeof d.adoptedAsIs==='boolean');return {total:proposals.length,adopted:proposals.filter(d=>d.adoptedAsIs&&!d.revoked).length,rate:proposals.length?Math.round(proposals.filter(d=>d.adoptedAsIs&&!d.revoked).length/proposals.length*100):0};}

// 成员、派单和按轮信箱；所有时间推进只来自演示按钮。
const ROUND_STATE={running:'运行中','waiting-workflow':'等待 workflow',idle:'空闲','needs-you':'需要你'};
const MEMBER_COLUMNS={'needs-you':'需要你',running:'运行中',completed:'完成',idle:'空闲'};
const MESSAGE_TYPES={status:'状态',dispatch:'派单',completion:'完成报告',escalation:'升级',question:'提问',heartbeat:'心跳'};
const DELIVERY_STATUS={pending:'待投递',delivered:'已投递',confirmed:'已确认',undeliverable:'无法送达'};
const DISPATCH_RESULT={success:'成功',failed:'失败',unknown:'状态不明',running:'进行中'};
const timelineFilters={member:'',card:'',group:'',type:''};
const sessionPanel={id:null,origin:null};
const getSession=id=>db.sessions[id];
const getDispatch=id=>db.dispatches.find(d=>d.id===id);
function cardSessions(c){return Object.values(db.sessions).filter(s=>s.role==='member'&&s.cardIds.includes(c.id));}
function currentOwnerSession(c){return cardSessions(c).find(s=>getDispatch(s.currentDispatchId)?.result==='running')||cardSessions(c).at(-1);}
function sessionPaused(s){return Boolean(s.pauseReasons.length||getProject(s.projectId)?.paused||s.cardIds.some(id=>getCard(id)?.status==='paused'));}
function memberColumn(s){return sessionPaused(s)?'idle':s.roundState==='needs-you'?'needs-you':s.completed?'completed':['running','waiting-workflow'].includes(s.roundState)?'running':'idle';}
function filteredSessions(p){const ids=new Set(filteredCards(p).map(c=>c.id));return Object.values(db.sessions).filter(s=>s.projectId===p.id&&s.role==='member'&&s.cardIds.some(id=>ids.has(id)));}
function pendingMessages(s){return db.messages.filter(m=>m.projectId===s.projectId&&m.deliveries.some(d=>d.sessionId===s.id&&d.status==='pending')).length;}
function sessionCaption(s){return sessionPaused(s)?'已暂停 · 原状态：'+(s.completed?'完成':ROUND_STATE[s.roundState]):s.completed?'完成':ROUND_STATE[s.roundState];}
function unknownDispatch(s){return getDispatch(s.currentDispatchId)?.result==='unknown';}
function unreadCount(projectId=null){return Object.values(db.sessions).filter(s=>s.role==='member'&&s.unread&&(!projectId||s.projectId===projectId)).length;}
function setUnread(kind,id,value=true,refresh=true){
 if(kind==='session'){const s=getSession(id);if(!s)return;s.unread=value;for(const cid of s.cardIds){const c=getCard(cid);c.unread=value||cardSessions(c).some(other=>other.unread);}}
 else {const c=getCard(id);if(!c)return;c.unread=value;for(const s of cardSessions(c))s.unread=value;}
 for(const n of db.notifications)if(kind==='session'?n.sessionId===id:n.cardId===id)n.unread=value;
 if(refresh)render();
}
function notifySession(s,text){setUnread('session',s.id,true,false);db.notifications.push({id:'notification-'+(++db.serial),projectId:s.projectId,sessionId:s.id,cardId:s.currentCardId,text:'示例 · '+text,time:simulationTime(s.projectId),unread:true,example:true});}
function renderUnread(c){return c.unread?'<span class="unread-marker">● 未读</span>':'';}
function renderStatusLine(c,compact=false){const text=c.statusLine||'尚未填写状态行';return `<p class="status-line" data-status-card="${esc(c.id)}">${compact?'<span class="sample-marker">示例</span> · '+esc(demoText(text)):esc(text)}</p>`;}
function updateStatusLine(id,text,actor='你',refresh=true){
 const c=getCard(id);text=String(text||'').trim();if(!c||!text)return {ok:false};if(c.statusLine===text)return {ok:true,unchanged:true};
 const before=c.statusLine;c.statusLine=text;(c.statusLineHistory||=[]).push({time:actor==='你'?now():simulationTime(c.projectId),actor,text,example:actor!=='你'});
 if(actor==='你'){const d=recordDecision(c.projectId,c.id,'编辑状态行：'+c.title,`修改前：${before}；修改后：${text}`);d.before=before;d.after=text;}
 if(refresh)render();return {ok:true};
}
function stageStatus(c,text){const constraints=c.statusLine.split('\n').filter(line=>/目标[：:]|约束[：:]/.test(line));const tail=constraints.map(line=>line.replace(/^.*?(?=(?:目标|约束)[：:])/,'')).join('\n');updateStatusLine(c.id,'示例 · '+demoText(text)+(tail?'\n'+tail:''),'示例 · 成员',false);}
function renderStatusEditor(c){return `<section class="card"><h2>状态行</h2>${renderStatusLine(c)}<label>编辑状态行（可写目标或约束）<textarea id="status-line-input">${esc(c.statusLine)}</textarea></label><button onclick="updateStatusLine(${js(c.id)},$('#status-line-input').value)">保存状态行</button><details><summary>状态行历史 · ${(c.statusLineHistory||[]).length} 条</summary>${(c.statusLineHistory||[]).slice().reverse().map(h=>`<div class="row"><p>${esc(h.text)}</p><div class="src">${esc(h.time)} · ${esc(h.actor)}</div></div>`).join('')}</details></section>`;}
function renderMembers(p){const sessions=filteredSessions(p);return `<div class="member-board" data-board-view="members">${Object.entries(MEMBER_COLUMNS).map(([column,label])=>`<section class="member-column member-${column}" data-member-column="${column}"><h2>${label} · ${sessions.filter(s=>memberColumn(s)===column).length}</h2>${sessions.filter(s=>memberColumn(s)===column).map(s=>{s.pendingCount=pendingMessages(s);const c=getCard(s.currentCardId);return `<article class="member-card ${unknownDispatch(s)?'has-unknown':''}" data-session-id="${esc(s.id)}" data-card-id="${esc(c.id)}" data-round-state="${esc(s.roundState)}"><button class="card-title" onclick="openSession(${js(s.id)},event.currentTarget)">${esc(sessionName(s))}</button>${s.unread?'<span class="unread-marker">● 未读</span>':''}<p><button onclick="go('card',${js(c.id)},event.currentTarget)">卡片详情</button> ${chip(c.status)} <span class="src">${dispatchCaption(s)}</span></p>${sessionPaused(s)?`<p class="pause-marker">${esc(sessionCaption(s))}</p>`:s.roundState==='waiting-workflow'?'<p>等待 workflow</p>':''}${renderStatusLine(c,true)}<div class="meta">花费 ¥${s.spent.toFixed(2)} · 待投递消息 ${s.pendingCount}</div>${unknownDispatch(s)?'<p class="dispatch-unknown">⚠ 状态不明 · 未收到完成报告</p>':''}${s.pauseReasons.length?'<span class="pause-marker">成员已暂停</span>':''}</article>`;}).join('')||'<p>暂无会话</p>'}</section>`).join('')}</div>`;}
function openSession(id,trigger){const s=getSession(id);if(!s)return;sessionPanel.origin=focusDescriptor(trigger||document.activeElement);sessionPanel.id=id;setUnread('session',id,false,false);render();$('#session-close')?.focus?.();}
function closeSession(){const origin=sessionPanel.origin;sessionPanel.id=null;sessionPanel.origin=null;render();restoreDescriptor(origin,'#board-surface');}
function renderDispatch(d){return `<article class="dispatch-record ${d.result==='unknown'?'dispatch-unknown':''}" data-dispatch-id="${esc(d.id)}"><h3>派单 ${d.number} · ${DISPATCH_RESULT[d.result]}${d.score?' · '+esc(d.score):''} ${d.example?'· 示例':''}</h3><p>${esc(d.method)}</p>${d.failure?`<p class="changed">${esc(d.failure)}</p>`:''}<p class="src">会话：${esc(d.sessionKey)} · 真实会话 ID：${esc(d.sessionId||'未记录')} · 代理：${esc(getAgent(d.agentId)?.name||d.agentId)} · 模型：${esc(d.model||'未记录')}</p><p>工作区：${esc(d.workspace.description)} · 基线：${esc(d.workspace.baseline)}</p><p class="src">开始：${esc(d.startedAt||'未记录')} · 结束：${esc(d.endedAt||'未记录')} · 心跳：${esc(d.heartbeatAt||'尚无')} · 花费：${d.cost==null?'未记录':'示例 ¥'+d.cost}</p>${d.completionReport?`<section class="completion-report" data-report-id="${esc(d.completionReport.id)}"><h3>完成报告 · ${DISPATCH_RESULT[d.completionReport.result]} · 示例格式</h3><p>${esc(d.completionReport.summary)}</p><p>改了哪些文件：${esc(d.completionReport.changedFiles.join('、')||'未记录 / 无文件改动（见出处）')}</p></section>`:`<p class="${d.result==='unknown'?'dispatch-unknown':'src'}">${esc(d.reportNote||'派单进行中，尚未发完成报告')}</p>`}<p class="src">出处：${esc((d.sourceFiles||[]).join('；')||'示例')}</p></article>`;}
function renderSessionPanel(){const s=getSession(sessionPanel.id);if(!s)return '';const c=getCard(s.currentCardId),d=getDispatch(s.currentDispatchId),mail=db.messages.filter(m=>m.fromSession===s.id||m.deliveries.some(r=>r.sessionId===s.id));return `<div class="session-backdrop" onclick="if(event.target===this){event.preventDefault();closeSession();}"><section class="session-detail" role="dialog" aria-modal="true" aria-labelledby="session-heading" onkeydown="panelKeydown(event,'.session-detail',closeSession)"><header class="panel-header"><h2 id="session-heading">${esc(sessionName(s))} · 会话输出 <span class="sample-marker">示例</span></h2><button id="session-close" onclick="closeSession()">关闭会话</button></header><p>${esc(s.id)} · 真实会话 ID：${esc(s.externalId||'未记录')} · ${esc(sessionCaption(s))}</p><div class="actions">${cardLink(c.id)}<button onclick="togglePause('session',${js(s.id)})">${s.pauseReasons.includes('session:'+s.id)?'恢复成员':'暂停成员'}</button><button onclick="setUnread('session',${js(s.id)},true)">重新标为未读</button><button onclick="simulateNextRound(${js(s.projectId)})">模拟下一轮 · 演示用</button></div><p class="status-line">${esc(demoText(c.statusLine))}</p><h3>实时输出 · 预设片段</h3><div id="session-output" class="session-output" tabindex="0" aria-label="会话实时输出">${s.output.map(o=>`<div class="output-line"><time>${esc(o.time)}</time><pre>${esc(o.text)}</pre></div>`).join('')}</div><h3>当前派单</h3>${d?compactRecordMarkup(renderDispatch(d)):'<p>尚未派单</p>'}<h3>信箱</h3>${mail.map(m=>compactRecordMarkup(renderMail(m,s.id))).join('')||'<p>暂无消息</p>'}${renderMailComposer(s)}</section></div>`;}
function renderMailComposer(s){const p=getProject(s.projectId);return `<section class="card"><h3>发送消息</h3><label>收件人<select id="mail-recipient">${Object.values(db.sessions).filter(r=>r.projectId===p.id&&r.id!==s.id).map(r=>`<option value="session:${esc(r.id)}">会话 · ${esc(sessionName(r))} · ${dispatchCaption(r)}${r.hasMailbox?'':'（无信箱）'}</option>`).join('')}${projectCards(p).map(c=>`<option value="card-owner:${esc(c.id)}">卡片负责人 · ${esc(c.title)}</option>`).join('')}${['all','idle',...new Set(projectCards(p).flatMap(c=>c.groups))].map(g=>`<option value="group:${esc(g)}">分组 · ${g==='all'?'全队':g==='idle'?'空闲的成员':esc(g)}</option>`).join('')}</select></label><label>消息类型<select id="mail-type">${['status','question','escalation'].map(t=>`<option value="${t}">${MESSAGE_TYPES[t]}</option>`).join('')}</select></label><label>内容<textarea id="mail-content"></textarea></label><button onclick="sendSessionMail(${js(s.id)},$('#mail-recipient').value,$('#mail-type').value,$('#mail-content').value)">写入信箱 · 等下一轮投递</button><p id="mail-error" role="status"></p></section>`;}
function addressSessions(projectId,recipient){const sessions=Object.values(db.sessions).filter(s=>s.projectId===projectId);if(recipient.kind==='session')return sessions.filter(s=>s.id===recipient.id);if(recipient.kind==='card-owner'){const c=getCard(recipient.id);return c?.projectId===projectId?[currentOwnerSession(c)].filter(Boolean):[];}if(recipient.kind==='group')return sessions.filter(s=>s.role==='member'&&(recipient.id==='all'||recipient.id==='idle'&&memberColumn(s)==='idle'&&!sessionPaused(s)||s.cardIds.some(id=>getCard(id)?.groups.includes(recipient.id))));return [];}
function initializeDelivery(m){if(m.deliveries.length||m.status==='undeliverable'||m.status==='confirmed')return;const recipients=addressSessions(m.projectId,m.recipient);m.deliveries=recipients.map(s=>({sessionId:s.id,status:s.hasMailbox?'pending':'undeliverable',reason:s.hasMailbox?'':'示例 · 收件会话没有信箱',readyAfterRound:s.round+1,deliveredAt:null,confirmedAt:null}));if(!recipients.length){m.status='undeliverable';m.reason='示例 · 收件地址没有可用会话';}syncDelivery(m);}
function syncDelivery(m){if(!m.deliveries.length)return;const good=m.deliveries.filter(d=>d.status!=='undeliverable');m.reason=m.deliveries.filter(d=>d.reason).map(d=>d.reason).join('；');m.status=!good.length?'undeliverable':good.some(d=>d.status==='pending')?'pending':good.every(d=>d.status==='confirmed')?'confirmed':'delivered';}
function queueMail(projectId,type,fromSession,recipient,cardIds,content,extra={}){
 const sender=getSession(fromSession),p=getProject(projectId);if(!p||sender?.projectId!==projectId||!MESSAGE_TYPES[type])return {ok:false,reason:'发件会话或项目无效'};
 if(['completion','heartbeat'].includes(type)&&(recipient.kind!=='session'||recipient.id!==p.leaderSessionId))return {ok:false,reason:'完成报告和心跳只发给派单的项目负责人'};
 const m=seedMail('mail-'+(++db.serial),projectId,type,fromSession,recipient,cardIds,content);Object.assign(m,extra,{time:simulationTime(projectId)});initializeDelivery(m);refreshPendingCounts();return m;
}
function sendSessionMail(id,address,type,content){const s=getSession(id);content=String(content||'').trim();if(!s||!content){$('#mail-error').textContent='请填写消息内容';return {ok:false};}const split=address.indexOf(':'),recipient={kind:address.slice(0,split),id:address.slice(split+1)};const m=queueMail(s.projectId,type,id,recipient,s.cardIds.slice(),'示例 · '+content);render();return m;}
function refreshPendingCounts(){for(const s of Object.values(db.sessions))s.pendingCount=pendingMessages(s);}
function confirmMail(id,sessionId){const m=byId(db.messages,id),d=m?.deliveries.find(d=>d.sessionId===sessionId);if(!d||d.status!=='delivered')return {ok:false};d.status='confirmed';d.confirmedAt=simulationTime(m.projectId);m.confirmedAt=d.confirmedAt;syncDelivery(m);render();return {ok:true};}
function simulationTime(projectId){return new Date(Date.UTC(2026,9,13,9,getProject(projectId)?.demoRound||0)).toISOString().replace('T',' ').slice(0,19);}
function recipientLabel(m){const r=m.recipient;return r.kind==='session'?`会话：${getAgent(getSession(r.id)?.agentId)?.name||r.id} · ${r.id}`:r.kind==='card-owner'?`卡片负责人：${getCard(r.id)?.title||r.id}`:`一组：${r.id==='all'?'全队':r.id==='idle'?'空闲的成员':r.id}`;}
function renderMail(m,sessionId=null){const sender=getSession(m.fromSession),bad=m.status==='undeliverable'||m.reason;return `<article class="mail-message ${bad?'message-undeliverable':''}" data-message-id="${esc(m.id)}" data-message-type="${esc(m.type)}" data-delivery-status="${esc(m.status)}"><span class="message-type mt-${m.type}">${MESSAGE_TYPES[m.type]}</span> <span class="delivery-status ds-${m.status}">${DELIVERY_STATUS[m.status]}</span><p class="src">${esc(m.time)} · 发件会话 ${esc(m.fromSession)} · 来自某个 agent：${esc(getAgent(sender?.agentId)?.name||'未记录')} · ${m.example?'示例':''}</p><p>收件人：${esc(recipientLabel(m))}</p><p>${esc(m.content)}</p>${m.cardIds.map(cardLink).join(' ')}${bad?`<p class="delivery-error">无法送达原因：${esc(m.reason)}</p>`:''}${m.deliveries.length?`<details><summary>各收件会话的投递状态</summary>${m.deliveries.map(d=>`<p>${esc(d.sessionId)} · ${DELIVERY_STATUS[d.status]}${d.reason?' · '+esc(d.reason):''}</p>`).join('')}</details>`:''}${sessionId&&m.deliveries.some(d=>d.sessionId===sessionId&&d.status==='delivered')?`<button onclick="confirmMail(${js(m.id)},${js(sessionId)})">确认已处理</button>`:''}</article>`;}
function filteredMessages(projectId){const f=timelineFilters;return db.messages.filter(m=>m.projectId===projectId&&(!f.member||m.fromSession===f.member||m.deliveries.some(d=>d.sessionId===f.member)||m.recipient.kind==='session'&&m.recipient.id===f.member)&&(!f.card||m.cardIds.includes(f.card)||m.recipient.kind==='card-owner'&&m.recipient.id===f.card)&&(!f.group||m.groupNames.includes(f.group)||m.recipient.kind==='group'&&m.recipient.id===f.group)&&(!f.type||m.type===f.type)).slice().sort((a,b)=>a.time.localeCompare(b.time));}
function setTimelineFilter(key,value){if(Object.hasOwn(timelineFilters,key)){timelineFilters[key]=value;render();}}
function renderTimeline(p){const options=(items,key)=>`<option value="">全部</option>`+items.map(([id,text])=>`<option value="${esc(id)}" ${timelineFilters[key]===id?'selected':''}>${esc(text)}</option>`).join('');$('#main').innerHTML=`${crumb(p,'消息时间线')}${renderRuntimeHeader(p)}<h1>消息时间线</h1><p class="src">按轮投递；未确认的信件保留在信箱。成员消息均来自某个 agent · 示例</p><div class="card filters"><label>成员 / 会话<select id="timeline-member" onchange="setTimelineFilter('member',this.value)">${options(Object.values(db.sessions).filter(s=>s.projectId===p.id).map(s=>[s.id,sessionName(s)+' · '+dispatchCaption(s)]),'member')}</select></label><label>卡片<select id="timeline-card" onchange="setTimelineFilter('card',this.value)">${options(projectCards(p).map(c=>[c.id,c.title]),'card')}</select></label><label>分组<select id="timeline-group" onchange="setTimelineFilter('group',this.value)">${options(['all','idle',...new Set(projectCards(p).flatMap(c=>c.groups))].map(g=>[g,g==='all'?'全队':g==='idle'?'空闲的成员':g]),'group')}</select></label><label>消息类型<select id="timeline-type" onchange="setTimelineFilter('type',this.value)">${options(Object.entries(MESSAGE_TYPES),'type')}</select></label><button onclick="resetTimelineFilters()">清除消息筛选</button></div><div class="message-timeline">${filteredMessages(p.id).map(m=>renderMail(m)).join('')||'<p>没有匹配消息</p>'}</div>`;}
function resetTimelineFilters(){Object.keys(timelineFilters).forEach(k=>timelineFilters[k]='');render();}
function renderRuntimeHeader(p){return `<div class="runtime-header"><span id="unread-count">未读 ${unreadCount(p.id)}</span>${renderPauseSummary(p)}${renderRuntimeNotices(p.id)}<button onclick="togglePause('project',${js(p.id)})">${p.paused?'恢复项目':'暂停项目'}</button><button class="demo-round" onclick="simulateNextRound(${js(p.id)})">模拟下一轮 · 演示用</button><span class="src">第 ${p.demoRound||0} 轮 · 示例</span></div>`;}
function renderTeam(p){$('#main').innerHTML=`${crumb(p,'团队')}${renderRuntimeHeader(p)}<h1>团队</h1><p class="src">代理与成员配置、预算与表现统计为示例；历史会话 ID 缺失时保持未记录。</p>${Object.values(db.members).filter(m=>getCard(m.cardId)?.projectId===p.id).map(m=>{const c=getCard(m.cardId),a=getAgent(m.agentId),ss=cardSessions(c),ds=c.dispatches||c.attempts;return `<section class="card team-member" data-member-id="${esc(m.id)}"><h2>${esc(m.name)} · ${esc(c.title)} <span class="sample-marker">示例</span></h2><p>代理配置：${esc(a.name)} · ${esc(a.executor)} · 主模型 ${esc(a.mainModel||a.model)} · 强度 ${esc(a.mainStrength||a.strength)}</p><p>${esc(a.instructions)}</p><p>当前卡：${cardLink(c.id)}</p><p>预算 ¥${c.budget} · 花费 ¥${c.spent.toFixed(2)}</p><p class="team-stats">表现统计：派单 ${ds.length} · 成功 ${ds.filter(d=>d.result==='success').length} · 失败 ${ds.filter(d=>d.result==='failed').length} · 状态不明 ${ds.filter(d=>d.result==='unknown').length}</p>${ss.map(s=>`<div class="row"><button onclick="openSession(${js(s.id)},event.currentTarget)">会话详情 · ${dispatchCaption(s)}</button><span class="src"> · ${esc(sessionCaption(s))}</span><p>会话预算 ¥${s.budget} · 花费 ¥${s.spent.toFixed(2)} · 待投递 ${pendingMessages(s)}</p>${unknownDispatch(s)?'<p class="dispatch-unknown">状态不明</p>':''}<button onclick="togglePause('session',${js(s.id)})">${s.pauseReasons.includes('session:'+s.id)?'恢复成员':'暂停成员'}</button>${s.unread?'<span class="unread-marker">● 未读</span>':''}</div>`).join('')}</section>`;}).join('')||'<p>尚无成员</p>'}`;}
function renderRecords(c){return `<section class="card"><h2>上下文包</h2>${(c.contextPackages||[]).map(p=>`<article class="row"><h3>${esc(p.dispatchId)} · 示例</h3><p>发了什么：${esc(p.sent.join('、'))}</p><p>没发什么及原因：${esc(p.omitted.map(o=>o.item+'：'+o.reason).join('；'))}</p></article>`).join('')||'<p>尚未派单，没有上下文包</p>'}</section><section class="card"><h2>相关消息</h2>${db.messages.filter(m=>m.cardIds.includes(c.id)).map(m=>renderMail(m)).join('')||'<p>暂无消息</p>'}</section>${[['handoffs','交接记录'],['findings','发现']].map(([key,label])=>`<section class="card"><h2>${label}</h2>${(c[key]||[]).map(r=>`<p>${esc(r.time)} · ${esc(r.text)}</p>`).join('')||'<p>暂无记录</p>'}</section>`).join('')}<section class="card"><h2>相关决策</h2>${db.decisions.filter(d=>d.cardId===c.id||d.affectedCardIds?.includes(c.id)).map(d=>`<div class="row"><button onclick="decisionJump(${js(d.id)})">${esc(d.title)}</button><p>${esc(d.reason)} · ${esc(d.decisionMaker)}</p></div>`).join('')||'<p>暂无决策</p>'}</section><section class="card"><h2>派单列表 · 一次派单就是一次尝试</h2>${(c.dispatches||c.attempts).map(renderDispatch).join('')||'<p>尚未派单</p>'}</section><section class="card"><h2>决策关卡</h2>${db.gates.filter(g=>g.cardId===c.id).map(g=>`<p>${esc(g.question)} · ${g.status==='waiting'?'等待'+g.answerBy:'已关闭 · '+esc(g.answeredBy)} · 示例</p>`).join('')||'<p>无关卡</p>'}</section>`;}
function renderFiles(c){return `<section class="card"><h2>相对基线的改动文件</h2><p>基线：${esc(c.fileBaseline||'未记录')}</p>${(c.fileChanges||[]).map(f=>`<article class="row"><h3>${esc(f.path)} ${f.example?'· 示例':''}</h3><p>${esc(f.note)}</p>${previewReference(f.preview,'artifact')}${artifactPreviews[f.preview]?.type==='diff'?renderDiff(artifactPreviews[f.preview].content):''}</article>`).join('')||'<p>尚无已记录的文件差异；不将未知文件列表视为没有改动。</p>'}</section><section class="card"><h2>并行步骤的合回记录</h2>${(c.mergeRecords||[]).map(r=>`<p>${esc(r.time)} · ${esc(r.steps.join('、'))} · ${esc(r.result)}</p>`).join('')||'<p>没有已记录的并行合回</p>'}</section>`;}
function changeCardPause(c,reason,on){c.pauseReasons||=[];if(on){if(!c.pauseReasons.includes(reason)){if(c.status!=='paused')c.beforePauseStatus=c.status;c.pauseReasons.push(reason);c.status='paused';}}else{c.pauseReasons=c.pauseReasons.filter(r=>r!==reason);if(!c.pauseReasons.length&&c.status==='paused'){c.status=c.beforePauseStatus||'running';c.beforePauseStatus=null;}}}
function togglePause(scope,id){
 const project=scope==='project'?getProject(id):getProject(scope==='card'?getCard(id)?.projectId:getSession(id)?.projectId);if(!project)return {ok:false};let on,label,cardId=null;
 if(scope==='project'){on=!project.paused;project.paused=on;label=project.name;for(const c of projectCards(project))if(!['accepted','integrated','cancelled'].includes(c.status)||c.pauseReasons?.includes('project:'+id))changeCardPause(c,'project:'+id,on);}
 else if(scope==='card'){const c=getCard(id);if(c.status==='cancelled')return {ok:false,reason:'已取消卡片不能恢复'};cardId=id;label=c.title;const initial=c.pauseReasons?.includes('budget:a-budget');on=!c.pauseReasons?.includes('card:'+id)&&!initial;if(initial){if(db.hardItems.some(h=>h.id==='a-budget'&&h.status==='pending')){flowEditor.notice='请先在收件箱处理预算上限，再恢复卡片。';flowEditor.noticeKind='error';render();return {ok:false};}changeCardPause(c,'budget:a-budget',false);}else changeCardPause(c,'card:'+id,on);}
 else if(scope==='session'){const s=getSession(id);if(!s||s.role!=='member')return {ok:false};const reason='session:'+id;on=!s.pauseReasons.includes(reason);s.pauseReasons=on?[...s.pauseReasons,reason]:s.pauseReasons.filter(r=>r!==reason);cardId=s.currentCardId;label=sessionName(s)+' · '+dispatchCaption(s);changeCardPause(getCard(cardId),reason,on);}
 else return {ok:false};
 recordDecision(project.id,cardId,(on?'暂停':'恢复')+({project:'项目',card:'卡片',session:'成员'}[scope])+'：'+label,'保留暂停前状态；各范围暂停分别记录，恢复后仍受其他暂停范围约束。');flowEditor.menu=null;render();return {ok:true,paused:on};
}
function finishDispatch(id,result,summary,changedFiles=[]){const d=getDispatch(id);if(!d||d.result!=='running'||d.completionReport||!['success','failed'].includes(result))return {ok:false,reason:'派单不能重复发送完成报告'};d.result=result;d.endedAt=simulationTime(d.projectId);d.completionReport={id:'report-'+d.id,result,summary,changedFiles:changedFiles.slice(),time:d.endedAt,example:true};const s=getSession(d.sessionKey),c=getCard(d.cardId);s.completed=true;s.roundState='idle';s.output.push({time:d.endedAt,text:'示例 · 完成报告：'+summary});queueMail(d.projectId,'completion',s.id,{kind:'session',id:getProject(d.projectId).leaderSessionId},[c.id],summary,{dispatchId:d.id,reportId:d.completionReport.id});stageStatus(c,summary+'；派单已完成，等待项目负责人处理');notifySession(s,c.title+'的派单已完成');return {ok:true};}
function resolveGateForQuestion(q,actor='你') {const g=db.gates.find(g=>g.questionId===q.id&&g.status==='waiting');if(!g)return;g.status='closed';g.answer=q.answer;g.answeredBy=actor;g.answeredAt=now();const c=getCard(g.cardId);if(c.status==='paused')c.beforePauseStatus=g.resumeStatus;else c.status=g.resumeStatus;for(const s of cardSessions(c))if(s.roundState==='needs-you'&&!unknownDispatch(s)){s.roundState=getDispatch(s.currentDispatchId)?.result==='running'?'running':'idle';}stageStatus(c,'已收到关卡回答，继续处理：'+q.answer);}
function answerGate(id,answer,actor='你'){const g=byId(db.gates,id);answer=String(answer||'').trim();if(!g||g.status!=='waiting'||actor!==g.answerBy||!answer)return {ok:false};if(actor==='你')return answerQuestion(g.questionId,answer);const q=byId(db.questions,g.questionId);q.answer=answer;resolveGateForQuestion(q,actor);const d=recordDecision(g.projectId,g.cardId,'回答决策关卡：'+g.question,answer);d.decisionMaker=actor;d.outcome='已回答';render();return {ok:true};}
function simulateNextRound(projectId){
 const p=getProject(projectId);if(!p)return {ok:false};if(p.paused){flowEditor.notice='示例 · 项目已暂停，本轮没有推进。';flowEditor.noticeKind='neutral';render();return {ok:false,paused:true};}
 const eligible=Object.values(db.sessions).filter(s=>s.projectId===p.id&&s.hasMailbox&&!sessionPaused(s));p.demoRound=(p.demoRound||0)+1;const time=simulationTime(p.id);
 // 先冻结本轮待投递集合；本轮产生的新信件留到收件人的下一个边界。
 const pending=db.messages.filter(m=>m.projectId===p.id&&m.status==='pending');for(const m of pending)initializeDelivery(m);
 for(const s of eligible)s.round++;
 for(const m of pending){for(const d of m.deliveries){const s=getSession(d.sessionId);if(d.status==='pending'&&eligible.includes(s)&&s.round>=d.readyAfterRound){d.status='delivered';d.deliveredAt=time;m.deliveredAt=time;s.output.push({time,text:'示例 · 本轮信箱收到：'+m.content});}}syncDelivery(m);}
 for(const s of eligible){const d=getDispatch(s.currentDispatchId);if(d?.result!=='running'||s.roundState==='needs-you')continue;
 d.heartbeatAt=time;s.spent+=.05;d.cost=(d.cost||0)+.05;const c=getCard(d.cardId);c.spent+=.05;s.output.push({time,text:'示例 · 心跳：正在处理「'+c.title+'」，轮次 '+s.round});queueMail(p.id,'heartbeat',s.id,{kind:'session',id:p.leaderSessionId},[c.id],'示例 · '+c.statusLine,{dispatchId:d.id});
 if(c.id==='a-capacity'&&s.round>=2&&!db.messages.some(m=>m.replyTo==='a-person-days')&&db.messages.find(m=>m.id==='a-person-days')?.deliveries.some(r=>r.sessionId===s.id&&r.status==='delivered')){const question=byId(db.messages,'a-person-days'),delivery=question.deliveries.find(r=>r.sessionId===s.id);delivery.status='confirmed';delivery.confirmedAt=time;question.confirmedAt=time;syncDelivery(question);queueMail(p.id,'status',s.id,{kind:'card-owner',id:'a-cost'},['a-capacity','a-cost'],'示例 · 交付估算 28 人天，另留 20% 缓冲；依据资源台账与 Q4 排期。',{replyTo:question.id});finishDispatch(d.id,'success','示例 · 已完成人天估算：28 人天与 20% 缓冲',[]);}
 if(c.id==='a-cost'&&db.messages.some(m=>m.replyTo==='a-person-days'&&m.deliveries.some(r=>r.sessionId===s.id&&r.status==='delivered'))){finishDispatch(d.id,'success','示例 · 已收到人天估算，完成成本区间整理',[]);}
 if(c.id==='b-defect-diagnose'&&s.round===1){const q=byId(db.questions,'b-member-question');if(q.answer===null){s.roundState='needs-you';s.output.push({time,text:'示例 · 已升级检查范围问题给项目负责人，由项目负责人转问你'});stageStatus(c,'已定位溢出，等待你确认 320px 检查范围');queueMail(p.id,'question',s.id,{kind:'session',id:p.leaderSessionId},[c.id],q.text);notifySession(s,c.title+'需要你回答');}else finishDispatch(d.id,'success','示例 · 已确认检查范围并完成诊断',[]);}
 else if(c.id==='b-defect-diagnose'&&s.round>=2&&byId(db.questions,'b-member-question').answer!==null)finishDispatch(d.id,'success','示例 · 已按回答完成诊断，等待项目负责人安排修复',[]);
 }
 p.spent=projectCards(p).reduce((sum,c)=>sum+c.spent,0);refreshPendingCounts();render();return {ok:true,round:p.demoRound};
}
const notificationState={};
function demoText(value){return String(value||'').replace(/(?:示例\s*[·：:]\s*)+/g,'').trim();}
function compactRecordMarkup(markup){const cleaned=markup.split(/(<[^>]*>)/g).map(part=>part.startsWith('<')?part:part.replace(/(?:示例\s*[·：:]\s*)+/g,'').replace(/\s*·\s*示例(?:格式|配置)?/g,'').replace(/示例/g,'预设')).join('');return cleaned.replace(/^(<article[^>]*>)/,'$1<span class="sample-marker">示例</span>');}
function sessionName(s){return (getAgent(s.agentId)?.name||'成员')+' · '+(getCard(s.currentCardId)?.title||(s.role==='coordinator'?'项目协调':'辅助会话'));}
function dispatchCaption(s){const d=getDispatch(s.currentDispatchId);return d?'派单 '+d.number:'尚未派单';}
function renderBoardToolbar(p){return `<div class="toolbar board-toolbar"><div class="board-toolbar-primary"><button class="primary" data-flow-add onclick="flowAddInput(event.currentTarget)">＋ 新建卡</button>${view.board==='graph'?`<button onclick="${flowEditor.editing?'leaveFlowEdit()':'enterFlowEdit()'}">${flowEditor.editing?'结束编辑':'编辑看板'}</button>`:''}</div>${view.board==='graph'?`<div class="src board-instructions">${flowViewport().vertical?'窄屏请使用卡片菜单添加依赖':'编辑时可从连接点拖到目标卡片'}；操作立即生效。</div>`:''}<div class="board-toolbar-demo"><span class="src board-count">${filteredCards(p).length}/${p.cardIds.length} 张卡片</span><button class="demo-round" onclick="simulateNextRound(${js(p.id)})">模拟下一轮 · 演示用</button><span class="src board-round">第 ${p.demoRound||0} 轮 · 示例</span></div></div>`;}
function pausedItems(p){const cards=projectCards(p).filter(c=>c.status==='paused'),sessions=Object.values(db.sessions).filter(s=>s.projectId===p.id&&s.role==='member'&&s.pauseReasons.length);return {cards,sessions};}
function renderPauseSummary(p){const {cards,sessions}=pausedItems(p);return `${p.paused?'<span class="pause-marker">项目已暂停</span>':''}${cards.length||sessions.length?`<details class="pause-summary"><summary class="pause-marker">已暂停：${cards.length} 张卡、${sessions.length} 个成员</summary><div class="pause-list"><h3>暂停的卡片</h3>${cards.map(c=>`<p>${cardLink(c.id)}</p>`).join('')||'<p>无</p>'}<h3>单独暂停的成员</h3>${sessions.map(s=>`<p><button onclick="openSession(${js(s.id)},event.currentTarget)">${esc(sessionName(s))} · ${dispatchCaption(s)}</button></p>`).join('')||'<p>无</p>'}</div></details>`:''}`;}
function dismissNotification(id){const n=byId(db.notifications,id);if(n)n.dismissed=true;render();}
function notificationToggle(el,key){notificationState[key]=el.open;}
function closeNotifications(key){notificationState[key]=false;render();$('#notifications-'+key)?.focus?.();}
function renderRuntimeNotices(projectId=null){const key=projectId||'all',list=db.notifications.filter(n=>n.unread&&!n.dismissed&&(!projectId||n.projectId===projectId)).slice(-3);return list.length?`<details class="notification-center" ${notificationState[key]?'open':''} ontoggle="notificationToggle(this,${js(key)})"><summary id="notifications-${esc(key)}" role="status">通知 ${list.length}</summary><aside class="runtime-notices" aria-label="会话通知"><div class="notification-actions"><button onclick="closeNotifications(${js(key)})">收起通知</button></div>${list.map(n=>`<div class="notification-row"><span class="src">${esc(getProject(n.projectId)?.name)}</span><button onclick="openSession(${js(n.sessionId)},event.currentTarget)">${esc(demoText(n.text))}</button><button aria-label="关闭这条通知" onclick="dismissNotification(${js(n.id)})">关闭通知</button></div>`).join('')}<p class="src">关闭提示不清除未读；同时最多显示 3 条。</p></aside></details>`:'';}
for(const m of db.messages)initializeDelivery(m);refreshPendingCounts();

function ensureCardRuntime(c){c.dispatches||=c.attempts;c.dispatchIds||=[];c.statusLineHistory||=[{time:now(),actor:'你',text:c.statusLine,example:false}];c.pauseReasons||=[];c.unread||=false;}
function renderDispatchExecution(c){return `<section class="card"><h2>派单与会话</h2>${(c.dispatches||c.attempts).map(d=>`<button onclick="openSession(${js(d.sessionKey)},event.currentTarget)">查看派单 ${d.number} 的实时输出</button>${renderDispatch(d)}`).join('')||'<p>尚未派单</p>'}</section>`;}
window.helm={notificationState,demoText,sessionName,dispatchCaption,pausedItems,dismissNotification,notificationToggle,closeNotifications,renderPauseSummary,renderBoardToolbar,ROUND_STATE,MEMBER_COLUMNS,MESSAGE_TYPES,DELIVERY_STATUS,DISPATCH_RESULT,timelineFilters,sessionPanel,getSession,getDispatch,cardSessions,currentOwnerSession,sessionPaused,memberColumn,filteredSessions,pendingMessages,unreadCount,setUnread,updateStatusLine,renderMembers,openSession,closeSession,renderDispatch,filteredMessages,setTimelineFilter,resetTimelineFilters,queueMail,sendSessionMail,confirmMail,renderTimeline,renderTeam,renderRecords,renderFiles,togglePause,finishDispatch,answerGate,simulateNextRound,panels,inboxItems,activeMemberCount,toggleConversation,closeCardDetail,panelKeydown,pausePlaceholder,conversationJump,jumpInbox,sendMessage,answerInterview,adoptInterview,replayInterview,answerQuestion,proposalAction,saveProposalForm,resolveProposal,decisionJump,revokeDecision,saveRequirement,createProject,handleHard,decisionStats,artifactPreviews,artifactPreview,openArtifactPreview,closeArtifactPreview,renderArtifactPreview,renderMarkdown,renderCSV,renderDiff,parseCSV,db,STATUS,TEST_TYPES,RESULTS,view,boardState,flowEditor,getCard,getNode:getCard,getProject,getAgent,projectCards,projectEdges,filteredCards,boardProjection,cardChildren,memberName,cardProgress,cardVersions,upstreamWarnings,setFilter,resetFilters,setBoardView,toggleParent,go,setCardTab,render,renderNode,renderSpec,renderAttempts,renderDependencies,renderColumns,renderMemory,renderSettings,renderInbox,renderAgents,renderExperience,renderDecisions,fillAgentTemplate,submitAgent,approveAgent,approveLesson,experienceCards,filterExperience,reviewExperience,renderFlowSVG,renderFlowGraph,layoutFlow,flowStages,flowReachable,flowViewport,refreshFlowLayout,enterFlowEdit,leaveFlowEdit,newCard,addFlowNode:(title)=>newCard(view.id,title),connectionReason,connectFlowNodes,removeFlowEdge,changeGroups,cancelCard,impactDetails,recordDecision,reopenCard,acceptCard,flowNodeMenu,flowDependencyMenu,flowLinesMenu,flowEdgeMenu,flowAddInput,flowGroupInput,closeFlowMenu,flowMenuKeydown,flowInputKeydown,flowNodeKeydown,flowMenuPosition,positionFlowMenu,flowDialogKeydown,flowMenuOutside,beginFlowConnection,updateFlowConnection,finishFlowConnection,cancelFlowDrag};
document.addEventListener('pointerdown',flowMenuOutside);
document.addEventListener('pointermove',updateFlowConnection);document.addEventListener('pointerup',finishFlowConnection);document.addEventListener('pointercancel',cancelFlowDrag);
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&flowEditor.drag){event.preventDefault();cancelFlowDrag();}});
window.addEventListener('resize',refreshFlowLayout);
render();
