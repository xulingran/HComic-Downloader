# moeimg-metadata-fields 规范

## 目的
待定 - 由归档变更 moeimg-metadata-enrichment 创建。归档后请更新目的。
## 需求
### 需求:ComicInfo 模型必须承载 language 字段

`ComicInfo` 数据类（`models.py`）必须新增 `language: str | None = None` 字段，承载来源返回的原始语言文本（如 "chinese"/"japanese"/"english"）。该字段独立于 `tags` 与 `category`，不得混入其中。

#### 场景:新字段默认值

- **当** 实例化一个未指定 language 的 ComicInfo
- **那么** `comic.language` 必须为 `None`

#### 场景:language 不污染 tags

- **当** moeimg 详情返回 `language: "chinese"`
- **那么** `comic.language == "chinese"`
- **且** `"chinese"` 不得出现在 `comic.tags` 中（维持现有排除行为）

### 需求:moeimg 解析器必须采集 category、language、author、tags、publish_date

`MoeImgParser.get_comic_detail` 必须从 SPA 与 HTML 两条路径完整采集 category、language、author、tags、publish_date 五项元数据，填充到返回的 `ComicInfo` 对应字段。

#### 场景:SPA 详情路径采集 language

- **当** SPA payload 的 `detail.language` 为 `"chinese"`
- **那么** 返回的 `ComicInfo.language == "chinese"`

#### 场景:HTML 兜底路径采集 language

- **当** SPA API 不可用，HTML 详情页含 `<div class="md-title">Language:</div><div class="md-content"><a href="/language/chinese">chinese</a></div>`
- **那么** 兜底解析返回的 `ComicInfo.language == "chinese"`

#### 场景:HTML 兜底路径采集 category

- **当** HTML 详情页含 `<div class="md-title">Category:</div><div class="md-content"><a href="/category/artist%20cg">artist cg</a></div>`
- **那么** 兜底解析返回的 `ComicInfo.category == "artist cg"`

#### 场景:HTML 兜底路径采集更新时间

- **当** HTML 详情页 `.manga-detail time[datetime]` 为 `2026-06-01T00:00:00+00:00`
- **那么** 兜底解析返回的 `ComicInfo.publish_date == "2026-06-01"`

#### 场景:language 字段缺失时为 None

- **当** SPA payload 与 HTML 详情页均无 language 信息
- **那么** `ComicInfo.language is None`
- **且** 不得抛出异常

### 需求:IPC 序列化必须输出 category、publishDate、language

`python/ipc/search_mixin.py:_comic_to_dict` 必须在返回字典中包含 `category`、`publishDate`、`language` 三个键，使 `get_comic_detail` / `search` / `get_favourites` 的响应能携带这些字段到前端。

#### 场景:详情响应携带补全字段

- **当** `get_comic_detail` 返回一个 category="artist cg"、publish_date="2026-06-01"、language="chinese" 的 ComicInfo
- **那么** 经 `_comic_to_dict` 序列化后的字典必须包含 `{"category": "artist cg", "publishDate": "2026-06-01", "language": "chinese"}`

#### 场景:字段缺失时序列化为 null

- **当** ComicInfo 的 category/language/publish_date 均为 None
- **那么** 序列化字典中三键值必须为 `None`（JSON `null`），不得缺键

### 需求:前端 ComicInfo 类型必须包含新字段且抽屉必须渲染

`shared/types.ts` 的 `ComicInfo` 接口必须新增可选字段 `category?: string`、`publishDate?: string`、`language?: string`。`ComicInfoDrawer.tsx` 的"信息"区块必须渲染 category（可点击触发 category 搜索）、更新时间（只读）、language（只读）。

#### 场景:抽屉显示 Category 且可点击搜索

- **当** 详情富化后的 `displayComic.category` 为 `"artist cg"`
- **那么** "信息"区块渲染 Category 文案
- **且** 点击它触发 `handleSearch("artist cg", "category")`

#### 场景:抽屉显示更新时间

- **当** `displayComic.publishDate` 为 `"2026-06-01"`
- **那么** "信息"区块渲染更新时间 "2026-06-01"

#### 场景:抽屉显示 Language

- **当** `displayComic.language` 为 `"chinese"`
- **那么** "信息"区块渲染语言标识（展示原文 "chinese"）

#### 场景:字段缺失时不渲染空标签

- **当** `displayComic.category` / `publishDate` / `language` 均为 undefined
- **那么** "信息"区块不得显示对应空标签行

### 需求:ComicInfo.xml 必须写入 LanguageISO（ISO 639-1 映射）

`cbz_builder.py:generate_comic_info_xml` 必须在 `comic.language` 非空时，经 `constants.py:LANGUAGE_TO_ISO_639_1` 映射表查得 ISO 639-1 两字母码，写入 `<LanguageISO>` 元素。映射表为单一来源，键为小写英文全称。未命中映射的语言不得写入该元素（避免非法 ISO 码）。

#### 场景:已知语言映射为 ISO 码

- **当** `comic.language == "chinese"`
- **那么** 生成的 ComicInfo.xml 必须包含 `<LanguageISO>zh</LanguageISO>`

#### 场景:japanese 与 english 映射

- **当** `comic.language` 为 `"japanese"` / `"english"` / `"korean"`
- **那么** `<LanguageISO>` 分别为 `ja` / `en` / `ko`

#### 场景:moeimg 非语言占位值映射为 und

- **当** `comic.language` 为 `"indefinable"` / `"text cleaned"` / `"rewrite"` / `"speechless"` / `"other"`
- **那么** `<LanguageISO>` 为 `und`

#### 场景:未知语言不写 LanguageISO

- **当** `comic.language == "klingon"`（映射表未覆盖）
- **那么** ComicInfo.xml 不得包含 `<LanguageISO>` 元素

#### 场景:language 为 None 不写 LanguageISO

- **当** `comic.language is None`
- **那么** ComicInfo.xml 不得包含 `<LanguageISO>` 元素

#### 场景:语言大小写不敏感

- **当** `comic.language == "Chinese"`（首字母大写）
- **那么** 查表前必须归一化为小写，映射为 `zh`

### 需求:专辑打包必须透传 language 写入专辑级 ComicInfo.xml

`cbz_builder.py:build_album_cbz` 构造专辑级 `ComicInfo` 时必须传入 `language=comic.language`，使多章节专辑的 ComicInfo.xml 同样写入 `<LanguageISO>`。

#### 场景:专辑 CBZ 写入 LanguageISO

- **当** 一个 language="chinese" 的专辑经 `build_album_cbz` 打包
- **那么** 打包出的 CBZ 内 ComicInfo.xml 必须包含 `<LanguageISO>zh</LanguageISO>`
