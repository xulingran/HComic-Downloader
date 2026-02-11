"""HComic Downloader - 程序入口"""
import logging
import sys


def setup_logging():
    """配置日志"""
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
        handlers=[
            logging.StreamHandler(sys.stdout)
        ]
    )


def main():
    """程序入口"""
    setup_logging()

    try:
        from gui import HComicDownloaderGUI
        app = HComicDownloaderGUI()
        app.mainloop()
    except ImportError as e:
        print(f"导入错误: {e}")
        print("请确保已安装依赖: pip install -r requirements.txt")
        sys.exit(1)
    except Exception as e:
        logging.error(f"程序异常: {e}", exc_info=True)
        sys.exit(1)


if __name__ == "__main__":
    main()
