#!/bin/sh
# 构建并重启本机 helmd 用户服务，轮询到服务就绪或超时。用法：npm run restart [-- 超时秒数]
set -eu
cd "$(dirname "$0")/.."
timeout=${1:-60}
url=${HELM_URL:-http://127.0.0.1:4242}
fail() { echo "restart: $*" >&2; exit 1; }

case "$(uname)" in
  Darwin)
    plist="$HOME/Library/LaunchAgents/io.helm.helmd.plist"
    [ -f "$plist" ] || fail "没有 $plist，先运行 helm install-service"
    cli=$(plutil -extract ProgramArguments.1 raw "$plist")
    restart() { launchctl kickstart -k "gui/$(id -u)/io.helm.helmd"; } ;;
  Linux)
    unit="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user/helmd.service"
    [ -f "$unit" ] || fail "没有 $unit，先运行 helm install-service"
    cli=$(sed -n 's/^ExecStart="[^"]*" "\([^"]*\)".*/\1/p' "$unit")
    restart() { systemctl --user restart helmd.service; } ;;
  *) fail "不支持 $(uname)" ;;
esac
# 服务固定跑某个检出的 dist；在别的 worktree 里构建不会生效
[ "$cli" = "$(pwd -P)/dist/src/cli.js" ] || fail "服务运行的是 $cli，不是本检出 $(pwd -P)；请在那个检出里运行"

npm run build >/dev/null 2>&1 || { npm run build; fail "构建失败，服务未重启"; }
restart || fail "重启服务命令失败"

deadline=$(($(date +%s) + timeout))
while :; do
  status=$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'content-type: application/json' -d '{}' "$url/api/list-works" || true)
  [ "$status" = 200 ] && { echo "helmd 已就绪：$url（$(node -p 'require("./package.json").version')）"; exit 0; }
  [ "$(date +%s)" -ge "$deadline" ] && break
  sleep 1
done
echo "restart: ${timeout} 秒内未就绪（最后 HTTP 状态 ${status:-000}；000 是连不上，503 是仍在启动对账）。日志末尾：" >&2
tail -n 20 "$HOME/.helm/logs/helmd.stderr.log" >&2 2>/dev/null || true
exit 1
