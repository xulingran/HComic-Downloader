## 上下文

moeimg 来源的漫画元数据目前只有部分字段贯穿到用户可见层。`sources/moeimg/parser.py:get_comic_detail` 已能解析 category、author、tags、publish_date，但：

1. **IPC 序列化断流**：`python/ipc/search_mixin.py:_comic_to_dict` 只输出 tags/parodies/characters/groups/author/pages，漏掉 category、publishDate，前端拿不到。
2. **Language 全链路缺失**：模型无字段、解析器主动丢弃（避免污染 tags）、IPC 不传、前端无类型、CBZ 不写 `<LanguageISO>`。
3. **前端抽屉不渲染**：`ComicInfoDrawer.tsx` 的"信息"区块只展示 sourceSite/pages/albumTotalChapters。

moeimg 的 SPA payload 中每条 manga（搜索结果与详情）都带 `language` 字段，取值为英文全称（`"chinese"`/`"japanese"`/`"english"` 等）；HTML 详情页对应 `<div class="md-title">Language:</div>` 区块。ComicInfo.xml（AnansiProject 标准）有专用的 `<LanguageISO>` 元素，期望 ISO 639-1 两字母码（zh/ja/en）。

约束：本仓库遵循系统代理（所有请求经 `apply_system_proxy_to_session`）、CBZ 原子写入、IPC 参数严格校验、前端深色模式令牌化。

## 目标 / 非目标

**目标：**
- 让 category、language、publish_date（更新时间）从 moeimg 解析一路贯穿到前端抽屉显示。
- 让 language 经 ISO 639-1 映射写入标准 `<LanguageISO>`，使 Komga/Kavita 等阅读器能按语言过滤。
- 保持向后兼容：旧前端忽略新增键、旧 CBZ 不受影响。
- 语言→ISO 映射单一来源，便于扩展其他来源（bika/jmcomic 未来可复用）。

**非目标：**
- 不改动 hcomic/jmcomic/bika/copymanga 的解析（它们已有各自的 category/publish_date 处理；language 仅 moeimg 本次落地，但模型字段与 ISO 映射设计为通用）。
- 不重构 ComicInfoDrawer 的整体布局/动画，仅在"信息"区块增量渲染。
- 不做历史下载的 CBZ 回填（已下载文件不补写 LanguageISO）。
- 不引入新的 IPC 通道（复用 get_comic_detail/search/get_favourites 现有通道，仅扩展返回字段）。

## 决策

### 决策 1：新增独立 `language` 字段，而非复用 tags

**选择**：在 `ComicInfo` 新增 `language: str | None = None`，承载来源原文（如 "chinese"）。

**理由**：tags 是可点击触发搜索的标签流，语义是多对多分类；language 是单值结构化字段，用途不同（落盘 LanguageISO、未来按语言过滤）。混入 tags 会被屏蔽/推荐逻辑误处理，且无法映射 ISO 码。当前 moeimg 解析器特意把 language 排除出 tags（有专门回归测试保护），本次顺势把它收编到独立字段。

**替代方案（已否决）**：复用现有 `category` 字段塞 language——语义错位，且 category 已用于 `<Genre>`。

### 决策 2：Language→ISO 映射放在 `constants.py` 作为单一来源

**选择**：在 `constants.py` 新增 `LANGUAGE_TO_ISO_639_1: dict[str, str]` 映射表，键为小写英文全称，值为 ISO 639-1 两字母码。`cbz_builder.py` 在生成 XML 时查表；未命中则不写 `<LanguageISO>`（避免写入非法码）。

```python
LANGUAGE_TO_ISO_639_1 = {
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
```

**理由**：moeimg 的 language 取值是封闭集合（站点枚举），映射表可控；放 `constants.py` 与现有 `IMAGE_API_BASE`、`DEFAULT_USER_AGENT` 等常量同处，便于 bika/jmcomic 后续复用同一张表。`und`（undetermined）用于 moeimg 的非语言占位值（indefinable/text cleaned 等），符合 ISO 639-2 的 und 语义。

**替代方案（已否决）**：
- 引入 `langcodes` 库做自动映射——过度依赖，且 moeimg 用的是英文全称非标准语种代码，自动库命中率不稳定。
- 原样写 "chinese" 进 `<LanguageISO>`——违反 ISO 639-1，部分阅读器识别失败。

### 决策 3：HTML 兜底解析同步采集 Language

**选择**：`_get_comic_detail_from_html` 的 `.manga-detail li` 遍历循环中新增 `elif md_title == "Language":` 分支，提取 `<a>` 文本填入 `language`，与现有 Category/Author/Tags 分支并列。

**理由**：HTML 兜底路径是 SPA 不可用时的回退，必须与 SPA 路径字段对齐，否则两种路径产出的 ComicInfo 字段不一致。测试 `test_get_comic_detail_falls_back_to_html_on_spa_failure` 的样本已包含 Language 区块，可直接断言。

### 决策 4：搜索阶段不采集 language（保持现状），仅详情阶段采集

**选择**：`_parse_search_manga_list` 维持不填 language（卡片轻量），language 在 `get_comic_detail`（抽屉打开时由 `sourceNeedsDetailEnrich` 触发）才采集。

**理由**：搜索列表追求轻量，卡片不需要语言信息；抽屉打开会走详情富化（`ComicInfoDrawer.tsx` 的 `getComicDetail` 调用），此时一次性补全 category/language/publish_date。避免每个搜索结果都携带冗余字段。`_comic_to_dict` 仍会序列化 language（若对象上有值），保证详情富化后能传到前端。

### 决策 5：前端"信息"区块增量渲染，Category 可点击搜索

**选择**：在 `ComicInfoDrawer.tsx` 的"信息"区块（`displayComic?.sourceSite` 所在的 `<p>`），追加 Category（点击触发 `handleSearch(category, 'category')`）、更新时间（纯文本）、Language（纯文本标签）的渲染。Category 复用 SEARCH_MODES 中的 `'category'` 模式。

**理由**：与现有 author（可点击 author 搜索）、tags（可点击 tag 搜索）的交互范式一致。Language/更新时间为只读展示，无需搜索入口。复用现有 `handleSearch`，不新增交互机制。

### 决策 6：专辑打包路径透传 language

**选择**：`cbz_builder.py:build_album_cbz` 构造 `album_comic` 时新增 `language=comic.language`，使专辑级 ComicInfo.xml 同样写入 LanguageISO。

**理由**：`build_album_cbz` 当前手工重建 `ComicInfo`（显式列出每个字段），遗漏 language 会导致 jmcomic 专辑等场景语言丢失。与 decision 1 的字段统一。

## 风险 / 权衡

- **[映射表覆盖不全]** moeimg 新增罕见语言时 `<LanguageISO>` 不写 → 可接受，符合"未知语言不写非法码"原则；映射表后续可增量补。回归测试覆盖已知主流取值。
- **[前端字段为 undefined 时渲染空]** 旧历史记录或非 moeimg 来源无 category/language/publishDate → 前端用可选链 + 条件渲染（`displayComic?.category && ...`），无值时不显示该行，避免空标签。
- **[`und` 写入 LanguageISO 的争议]** 部分阅读器不识别 `und` → 权衡后保留 `und`（ISO 合法且语义准确）；若验证发现阅读器问题，可改为对 `und` 类不写元素（单一改动点）。
- **[IPC 返回体积微增]** 每条 ComicInfo 多 3 个键 → 可忽略，均为短字符串或 null。
- **[向后兼容]** 旧前端（已发布版本）忽略未知键，无破坏；旧 CBZ 无 LanguageISO 属合法缺省。
