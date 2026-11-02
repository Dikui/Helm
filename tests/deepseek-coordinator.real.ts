// Outside the sandbox only; npm test compiles this file but never executes it.
import { test } from 'node:test';
import { acpCoordinatorSmoke } from './acp-coordinator-smoke.js';

test('DeepSeek 真实调度者：调度者目录可写、项目禁写与可读、对齐、派单、审核、续跑和轮次令牌',
  { skip: process.env.HELM_DEEPSEEK_COORDINATOR_REAL !== '1', timeout: 600_000 }, t => acpCoordinatorSmoke(t, 'deepseek'));
