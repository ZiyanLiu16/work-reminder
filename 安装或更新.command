#!/bin/zsh
set -eu
cd "$(dirname "$0")"
if command -v node >/dev/null 2>&1; then
  node scripts/build.mjs
else
  mkdir -p dist
  cp -R extension/. dist/
fi
open -a 'Google Chrome' 'chrome://extensions/'
open dist
echo '首次安装：打开开发者模式 → 加载已解压的扩展程序 → 选择弹出的 dist 文件夹。'
echo '以后更新：在扩展管理页点击「回到目标」卡片上的重新加载，然后刷新目标网站。'
echo '扩展无需启动服务器，也不需要 npm install。'
