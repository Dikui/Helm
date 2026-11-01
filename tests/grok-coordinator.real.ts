// Outside the sandbox only; npm test compiles this file but never executes it.
// Restore this group to real-smoke-runner after Grok fixes read-only docker.sock symlinks and coordinator support is re-enabled.
import { test } from 'node:test';
import { acpCoordinatorSmoke } from './acp-coordinator-smoke.js';

test('Grok 真实调度者：只读沙箱、对齐、派单、审核、续跑和轮次令牌',
  { skip: process.env.HELM_GROK_COORDINATOR_REAL !== '1', timeout: 600_000 }, t => acpCoordinatorSmoke(t, 'grok'));
