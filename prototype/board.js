// 分层、重心排序、折线路由与端口间距沿用 011 / 017；渲染使用卡片投影。
function flowStages(p) {
  const ids=p.cardIds.filter(id=>getCard(id)), remaining=new Set(ids), stages=[];
  const edges=p.edges.filter(e=>e._preview!=='remove'&&remaining.has(e.from)&&remaining.has(e.to));
  while(remaining.size) {
    const row=ids.filter(id=>remaining.has(id)&&edges.filter(e=>e.to===id).every(e=>!remaining.has(e.from)));
    if(!row.length)break; // 卡片依赖图编辑已拒绝循环依赖。
    row.forEach(id=>remaining.delete(id));stages.push(row);
  }
  // 两次重心排序减少分叉/汇合的交叉；相同重心保持原项目顺序。
  const original=new Map(ids.map((id,i)=>[id,i]));
  const sort=(row,neighbors)=>row.sort((a,b)=>{
    const center=id=>{const values=neighbors(id);return values.length?values.reduce((sum,n)=>sum+n,0)/values.length:original.get(id);};
    return center(a)-center(b)||original.get(a)-original.get(b);
  });
  for(let pass=0;pass<2;pass++) {
    const position=()=>new Map(stages.flatMap(row=>row.map((id,i)=>[id,i])));
    for(let i=1;i<stages.length;i++){const pos=position();sort(stages[i],id=>edges.filter(e=>e.to===id).map(e=>pos.get(e.from)));}
    for(let i=stages.length-2;i>=0;i--){const pos=position();sort(stages[i],id=>edges.filter(e=>e.from===id).map(e=>pos.get(e.to)));}
  }
  return stages;
}
function flowNeighborhood(p,focusId) {
  const edges=p.edges.filter(e=>e.from===focusId||e.to===focusId);
  const included=new Set([focusId,...edges.flatMap(e=>[e.from,e.to])]);
  return {...p,cardIds:[...new Set([...p.cardIds.filter(id=>included.has(id)),focusId])],edges};
}
function flowReachable(start,edges,reverse=false) {
  const seen=new Set([start]),queue=[start];
  for(let i=0;i<queue.length;i++)for(const e of edges) {
    const from=reverse?e.to:e.from,to=reverse?e.from:e.to;
    if(from===queue[i]&&!seen.has(to)){seen.add(to);queue.push(to);}
  }
  return seen;
}
function flowTextWidth(text,size) {
  // 系统字体的保守字宽：宽拉丁字母也留足空间，不依赖 canvas 或外部字体测量。
  return [...text].reduce((width,c)=>width+size*(/[^\u0000-\u007f]/.test(c)?1.05:/[MWmw@%]/.test(c)?1:/[A-Z]/.test(c)?.85:.75),0);
}
function flowTextLines(text,width,size) {
  const lines=[];let line='';
  for(const c of String(text||'')) {
    if(c==='\n'){lines.push(line);line='';continue;}
    if(line&&flowTextWidth(line+c,size)>width){lines.push(line);line='';}
    line+=c;
  }
  if(line||!lines.length)lines.push(line);
  return lines;
}
function flowStatusLabel(c) { return STATUS[c.status]; }
function flowViewport(canvas) {
  const main=$('#main'),viewport=window.innerWidth||1024;
  const vertical=typeof matchMedia==='function'?matchMedia('(max-width: 760px)').matches:viewport<=760;
  let width=canvas?.clientWidth;
  if(main?.clientWidth) {
    const style=typeof getComputedStyle==='function'?getComputedStyle(main):null;
    const content=main.clientWidth-(parseFloat(style?.paddingLeft)|| (vertical?16:28))-(parseFloat(style?.paddingRight)|| (vertical?16:28));
    width=width?Math.min(width,content):content;
  }
  return {vertical,width:Math.max(120,(width|| (vertical?viewport-32:viewport-346))-4)};
}
// 纯几何函数：不改 db，不读 DOM。points 是实际 SVG 折线路由，也用于 Node 绕障检查。
function layoutFlow(p,options={}) {
  const width=Math.max(120,Number(options.width)||960),vertical=options.vertical??width<=760;
  const graph=options.focusId?flowNeighborhood(p,options.focusId):p,stages=flowStages(graph);
  const levelOf=new Map(stages.flatMap((ids,level)=>ids.map(id=>[id,level]))),included=new Set(levelOf.keys());
  const edges=graph.edges.filter(e=>included.has(e.from)&&included.has(e.to)).map(e=>({...e,label:null}));
  const gaps=stages.slice(0,-1).map((_,level)=>Math.max(56,edges.filter(e=>levelOf.get(e.from)===level||levelOf.get(e.to)===level+1).length*6+32));
  const nodeWidth=vertical?Math.min(270,width-80):Math.max(204,Math.min(240,(width-32-gaps.reduce((a,b)=>a+b,0))/Math.max(1,stages.length)));
  const nodes=stages.flatMap((ids,level)=>ids.map(id=>{
    const c=getCard(id),titleLines=flowTextLines(c.title+(c.example?' · 示例':''),nodeWidth-(cardChildren(id).length?96:44),14);
    const statusLabel=flowStatusLabel(c),statusLines=flowTextLines(statusLabel,nodeWidth-92,12);
    const statusY=22+(titleLines.length-1)*17+10,statusHeight=statusLines.length*15+5;
    const agent='负责人：'+memberName(c),agentLines=flowTextLines(agent,nodeWidth-24,12),agentY=statusY+statusHeight+16;
    const metadata=cardLines(c,nodeWidth-24),metaY=agentY+agentLines.length*15+2;
    const contentHeight=metaY+(metadata.length-1)*16+12;
    const inCount=edges.filter(e=>e.to===id).length,outCount=edges.filter(e=>e.from===id).length;
    const inSide=vertical&&(inCount-1)*12>nodeWidth-32,outSide=vertical&&(outCount-1)*12>nodeWidth-32;
    const portHeight=!vertical||inSide||outSide?(Math.max(inCount,outCount)-1)*16+32:0;
    return {id,level,width:nodeWidth,height:Math.max(contentHeight,portHeight),inPortSide:inSide?'left':vertical?'top':'left',outPortSide:outSide?'right':vertical?'bottom':'right',titleLines,statusLabel,statusLines,statusY,statusHeight,agent,agentLines,agentY,metadata,metaY,contentHeight};
  }));
  const byId=new Map(nodes.map(n=>[n.id,n])),primary=id=>getCard(id).groups[0]||'未分组';
  const names=[...new Set(graph.cardIds.filter(id=>included.has(id)).map(primary))].sort((a,b)=>groupIndex(a)-groupIndex(b));
  const columnX=[16];for(let i=1;i<stages.length;i++)columnX.push(columnX[i-1]+nodeWidth+gaps[i-1]);
  const graphWidth=vertical?width:(columnX.at(-1)||16)+nodeWidth+16;
  // 同组独占一个横向带；没有连线的卡片在带内横排，避免全挤在第零层。
  // 有连线的卡片仍严格按拓扑层分列，列间空隙保留给路由。
  const groups=[],topTracks=edges.filter(e=>levelOf.get(e.to)!==levelOf.get(e.from)+1).length*24;
  let y=vertical?42:42+topTracks;
  for(const name of names) {
    const items=nodes.filter(n=>primary(n.id)===name),startY=y;
    if(vertical) {
      const ordered=items.sort((a,b)=>a.level-b.level||graph.cardIds.indexOf(a.id)-graph.cardIds.indexOf(b.id));
      for(const n of ordered){n.x=(width-nodeWidth)/2;n.y=y;y+=n.height+40;}y-=40;
    } else {
      const connected=items.filter(n=>edges.some(e=>e.from===n.id||e.to===n.id));
      const free=items.filter(n=>!connected.includes(n)),bottoms=columnX.map(()=>startY);
      for(const n of connected){const col=n.level;n.x=columnX[col];n.y=bottoms[col];bottoms[col]+=n.height+40;}
      for(const n of free){const col=bottoms.indexOf(Math.min(...bottoms));n.x=columnX[col];n.y=bottoms[col];bottoms[col]+=n.height+40;}
      y=Math.max(...bottoms)-40;
    }
    const left=Math.min(...items.map(n=>n.x)),right=Math.max(...items.map(n=>n.x+n.width));
    groups.push({name,ids:items.map(n=>n.id),x:left-10,y:startY-30,width:right-left+20,height:y-startY+60});
    y+=64; // 30px 提示槽 + 下一组 30px 标题区 + 4px 间隔；拖动不改变几何。
  }
  const graphHeight=Math.max(80,y-30);
  let trackY=16;
  for(const e of edges) {
    const source=byId.get(e.from),target=byId.get(e.to),outgoing=edges.filter(a=>a.from===e.from),incoming=edges.filter(a=>a.to===e.to);
    const port=(items,span)=>(items.indexOf(e)-(items.length-1)/2)*Math.min(16,(span-32)/Math.max(1,items.length-1));
    if(vertical) {
      const offset=12+24*(edges.indexOf(e)+1)/(edges.length+1),right=source.x+nodeWidth+offset,left=source.x-offset;
      const sx=source.x+nodeWidth/2+port(outgoing,source.width),tx=target.x+nodeWidth/2+port(incoming,target.width),sy=source.y+source.height,ty=target.y;
      const start=source.outPortSide==='right'?[[source.x+nodeWidth,source.y+source.height/2+port(outgoing,source.height)],[right,source.y+source.height/2+port(outgoing,source.height)]]:[[sx,sy],[sx,sy+10],[right,sy+10]];
      const end=target.inPortSide==='left'?[[left,ty-10],[left,ty+target.height/2+port(incoming,target.height)],[target.x,ty+target.height/2+port(incoming,target.height)]]:[[tx,ty-10],[tx,ty]];
      e.points=[...start,[right,ty-10],...end];
    } else {
      const sx=source.x+nodeWidth,tx=target.x,sy=source.y+source.height/2+port(outgoing,source.height),ty=target.y+target.height/2+port(incoming,target.height);
      if(target.level===source.level+1) {
        const peers=edges.filter(a=>byId.get(a.from).level===source.level&&byId.get(a.to).level===target.level),lane=sx+(tx-sx)*(peers.indexOf(e)+1)/(peers.length+1);
        e.points=[[sx,sy],[lane,sy],[lane,ty],[tx,ty]];
      } else {
        const start=sx+16+outgoing.indexOf(e)*6,end=tx-16-incoming.indexOf(e)*6;
        e.points=[[sx,sy],[start,sy],[start,trackY],[end,trackY],[end,ty],[tx,ty]];trackY+=24;
      }
    }
    e.points=e.points.map(point=>point.map(v=>Math.round(v*100)/100));
    e.path=e.points.map(([x,y],i)=>`${i?'L':'M'} ${x} ${y}`).join(' ');
  }
  return {nodes,edges,groups,width:graphWidth,height:graphHeight,availableWidth:width,scrollable:!vertical&&graphWidth>width+.5,vertical,stages};
}
function flowSVGText(lines,x,y,className,lineHeight=16) {
  return `<text class="${className}" x="${x}" y="${y}">${lines.map((line,i)=>`<tspan x="${x}" dy="${i?lineHeight:0}">${esc(line)}</tspan>`).join('')}</text>`;
}
