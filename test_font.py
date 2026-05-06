#!/usr/bin/env python3
"""字体显示测试脚本"""
import tkinter as tk
from tkinter import ttk
from font_config import FontConfig


def show_font_display():
    """测试字体显示效果"""
    # 创建字体配置
    fc = FontConfig.create_instance()

    # 创建测试窗口
    root = tk.Tk()
    root.title("中文字体显示测试")
    root.geometry("600x500")

    # 主框架
    main_frame = ttk.Frame(root, padding="20")
    main_frame.grid(row=0, column=0, sticky=(tk.W, tk.E, tk.N, tk.S))

    # 显示当前字体信息
    ttk.Label(
        main_frame,
        text=f"操作系统: {fc.system}",
        font=fc.get_font("small")
    ).grid(row=0, column=0, sticky=tk.W, pady=5)

    ttk.Label(
        main_frame,
        text=f"自动选择字体: {fc.get_best_font()}",
        font=fc.get_font("small")
    ).grid(row=1, column=0, sticky=tk.W, pady=5)

    ttk.Separator(main_frame, orient='horizontal').grid(row=2, column=0, sticky=(tk.W, tk.E), pady=15)

    # 测试不同大小的中文文本
    test_texts = [
        ("标题 (Title)", "你好，世界！这是一个 HComic 漫画下载器", "title"),
        ("副标题 (Subtitle)", "欢迎使用中文界面，支持跨平台显示", "subtitle"),
        ("正文 (Normal)", "这是一个基于 tkinter 的图形界面应用程序", "normal"),
        ("小字 (Small)", "支持 macOS、Windows 和 Linux 系统", "small"),
        ("粗体测试 (Bold)", "这是粗体文字效果展示", "normal"),
    ]

    for i, (label, text, size_key) in enumerate(test_texts):
        row = 3 + i
        ttk.Label(
            main_frame,
            text=f"{label}:",
            font=fc.get_font("small"),
            foreground="gray"
        ).grid(row=row, column=0, sticky=tk.W, pady=(10, 0))

        text_label = ttk.Label(
            main_frame,
            text=text,
            font=fc.get_font(size_key, bold=(size_key == "normal" and "粗体" in label))
        )
        text_label.grid(row=row + 1, column=0, sticky=tk.W, pady=(0, 5))

    # 关闭按钮 (使用 tk.Button 而不是 ttk.Button 以支持字体)
    tk.Button(
        main_frame,
        text="关闭",
        command=root.quit,
        font=fc.get_font("normal"),
        bg="#f0f0f0",
        relief="raised"
    ).grid(row=20, column=0, pady=(20, 0))

    root.columnconfigure(0, weight=1)
    root.rowconfigure(0, weight=1)
    main_frame.columnconfigure(0, weight=1)

    root.mainloop()


if __name__ == "__main__":
    show_font_display()
