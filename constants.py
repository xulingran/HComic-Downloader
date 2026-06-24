"""共享常量。"""

# 默认 User-Agent（兼容性）
DEFAULT_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0"
# 图片 API 基础 URL
IMAGE_API_BASE = "https://h-comic.link/api"

# 语言英文全称 → ISO 639-1 两字母码映射表。
# 来源（如 moeimg）以英文全称返回语言，落盘 ComicInfo.xml 的 <LanguageISO> 需要 ISO 码。
# 键统一为小写，查表前需归一化。moeimg 的非语言占位值（indefinable/text cleaned 等）映射为
# ISO 639-2 的 "und"（undetermined），符合 AnansiProject ComicInfo.xml 标准。
# 未命中的语言不写 <LanguageISO>，避免写入非法 ISO 码。
LANGUAGE_TO_ISO_639_1: dict[str, str] = {
    "chinese": "zh",
    "japanese": "ja",
    "english": "en",
    "korean": "ko",
    "french": "fr",
    "german": "de",
    "spanish": "es",
    "russian": "ru",
    "italian": "it",
    "portuguese": "pt",
    "thai": "th",
    "indonesian": "id",
    "vietnamese": "vi",
    "czech": "cs",
    "polish": "pl",
    "hungarian": "hu",
    "dutch": "nl",
    "arabic": "ar",
    "turkish": "tr",
    "tagalog": "tl",
    "mongolian": "mn",
    "persian": "fa",
    "hebrew": "he",
    "hindi": "hi",
    "ukrainian": "uk",
    "finnish": "fi",
    "swedish": "sv",
    "norwegian": "no",
    "danish": "da",
    "romanian": "ro",
    "greek": "el",
    "catalan": "ca",
    "bulgarian": "bg",
    "croation": "hr",  # moeimg 历史拼写容错
    "croatian": "hr",
    "albanian": "sq",
    "esperanto": "eo",
    "indefinable": "und",  # moeimg 对未知语言占位
    "other": "und",
    "translated": "und",
    "text cleaned": "und",
    "rewrite": "und",
    "speechless": "und",
}
