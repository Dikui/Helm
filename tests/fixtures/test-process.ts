// Track the original test process, including in descendants whose immediate
// parent is deliberately killed by a process-group cleanup test.
export function watchTestProcess(pid: number): NodeJS.Timeout {
  if (!Number.isInteger(pid) || pid <= 1) throw new Error('Expected a test process PID');
  return setInterval(() => {
    try { process.kill(pid, 0); }
    catch (error) {
      // EPERM does not mean the owner is gone.
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') process.exit(0);
    }
  }, 1000);
}

// Inline doubles run with node -e, sometimes after changing cwd. Serialize the
// same watchdog so they need neither a module loader nor a particular cwd.
export function testProcessWatchdog(pid = process.pid): string {
  if (!Number.isInteger(pid) || pid <= 1) throw new Error('Expected a test process PID');
  return `(${watchTestProcess.toString()})(${pid});`;
}
