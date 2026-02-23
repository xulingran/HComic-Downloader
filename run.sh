#!/bin/bash
# HComic Downloader - 一键启动脚本

# 获取脚本所在目录
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "========================================="
echo "  HComic Downloader 启动中..."
echo "========================================="

# 检查虚拟环境是否存在
if [ ! -d "venv" ]; then
    echo "错误: 虚拟环境不存在，请先运行: python3 -m venv venv"
    exit 1
fi

# 激活虚拟环境
echo "激活虚拟环境..."
source venv/bin/activate

# 运行主程序
echo "启动程序..."
python main.py

# 退出虚拟环境
deactivate
