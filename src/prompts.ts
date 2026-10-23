import type { AgentTemplate } from './templates.js';

const coordinatorRuntime = `每轮输入是启动简报 JSON；项目代码只读，不推送、不部署。只有用户能接受或退回审核，合进基准分支和推送由运行层处理。`;
const executorRuntime = `输入 JSON 的 content 是派单内容；派单前附卡片说明快照。验收时按其中的边界和标准在新上下文中检查，不能靠修改产品代码让自己通过。运行层在执行派单结束后保存提交，验收派单结束后重置临时改动。
不推送、不部署。开发服务必须用分配的端口，范围由环境变量 HELM_PORT_START 和 HELM_PORT_END 指定（含两端），不要使用范围外的端口。开发服务不必自己停，派单结束时由运行层清理卡片副本里的进程。需要浏览器时用注入的浏览器工具检查页面和截图；截图用相对文件名，运行层会把它保存为成果 browser/<文件名>，最终回答按这个路径写。
完成检查后，结束前必须最后调用“提交结论”（submit-conclusion）并附一句理由：执行派单用 completed（完成）或 blocked（受阻），验收派单用 passed（通过）或 failed（不通过）。工具调用不结束派单，随后给出包含上述证据的最终回答；只在文字中自报结论记为未声明，不算完成。`;

export function templatePrompt(template: AgentTemplate) {
  return `${template.prompt}\n\n${template.role === 'coordinator' ? coordinatorRuntime : executorRuntime}`;
}
