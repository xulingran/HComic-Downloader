## 修改需求

### 需求:moeimg 解析器必须采集 category、language、author、tags、publish_date

`MoeImgParser.get_comic_detail` 必须从 SPA 与 HTML 两条路径完整采集 category、language、author、tags、publish_date 五项元数据，填充到返回的 `ComicInfo` 对应字段。`tags` 字段必须**只**包含纯标签，**禁止**包含 Parody 与 Characters 两类实体（这两类必须分别采集到 `ComicInfo.parodies` / `ComicInfo.characters`，详见「moeimg 解析器必须独立采集 parody 与 characters」需求）。

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

#### 场景:tags 不再包含 parody 实体

- **当** SPA payload 的 `detail.parody` 含 `"persona series"`，`detail.tags` 含 `"school"`
- **那么** 返回的 `ComicInfo.tags == ["school"]`
- **且** `"persona series"` 不得出现在 `ComicInfo.tags` 中

#### 场景:tags 不再包含 characters 实体

- **当** SPA payload 的 `detail.characters` 含 `["maki", "nico"]`，`detail.tags` 含 `["idol"]`
- **那么** 返回的 `ComicInfo.tags == ["idol"]`
- **且** `"maki"` / `"nico"` 不得出现在 `ComicInfo.tags` 中

#### 场景:chapter_detail.tags 仍并入纯 tags

- **当** `chapter_detail.tags` 含 `["full color"]`，`detail.tags` 含 `["school"]`，`detail.parody` / `detail.characters` 均为空
- **那么** 返回的 `ComicInfo.tags == ["school", "full color"]`（去重保序）

## 新增需求

### 需求:moeimg 解析器必须独立采集 parody 与 characters

`MoeImgParser.get_comic_detail`（SPA 主路径）与 `_get_comic_detail_from_html`（HTML 兜底路径）必须从详情数据中独立采集 Parody 与 Characters 两类实体，分别填充 `ComicInfo.parodies` 与 `ComicInfo.characters`。两条路径的采集范围必须一致，禁止出现"SPA 路径有而 HTML 路径没有"的不对称。采集必须复用既有的 `_extract_names` + `_dedupe_keep_order` 工具，对 `detail_data` 与 `detail` 两层字典的同名键合并去重保序。当某类实体不存在时，对应字段必须为空列表 `[]`，不得为 `None`，不得抛出异常。

#### 场景:SPA 路径采集单个 parody

- **当** SPA payload 的 `detail.parody` 为 `[{"tag_name": "persona series"}]`
- **那么** 返回的 `ComicInfo.parodies == ["persona series"]`

#### 场景:SPA 路径采集多个 characters

- **当** SPA payload 的 `detail.characters` 为 `[{"tag_name": "maki"}, {"tag_name": "nico"}]`
- **那么** 返回的 `ComicInfo.characters == ["maki", "nico"]`

#### 场景:detail_data 与 detail 两层合并去重保序

- **当** `detail_data.parody` 含 `["love live", "school"]`，`detail.parody` 含 `["school", "idol"]`
- **那么** `ComicInfo.parodies == ["love live", "school", "idol"]`（保序去重，`school` 不重复）

#### 场景:detail_data 与 detail 任一层缺失时回退到另一层

- **当** `detail_data.parody` 为 `None`，`detail.parody` 含 `["persona series"]`
- **那么** `ComicInfo.parodies == ["persona series"]`

#### 场景:parody 与 characters 同时缺失时为空列表

- **当** SPA payload 既无 `parody` 也无 `characters` 键
- **那么** `ComicInfo.parodies == []`
- **且** `ComicInfo.characters == []`
- **且** 不得抛出异常

#### 场景:HTML 兜底路径采集 parody

- **当** SPA API 不可用，HTML 详情页含 `<div class="md-title">Parody:</div><div class="md-content"><a href="/parody/persona">persona series</a></div>`
- **那么** 兜底解析返回的 `ComicInfo.parodies == ["persona series"]`

#### 场景:HTML 兜底路径采集多个 characters

- **当** SPA API 不可用，HTML 详情页含 `<div class="md-title">Characters:</div><div class="md-content"><a href="/character/maki">maki</a><a href="/character/nico">nico</a></div>`
- **那么** 兜底解析返回的 `ComicInfo.characters == ["maki", "nico"]`

#### 场景:HTML 兜底路径 Parody / Characters 节点缺失时为空列表

- **当** HTML 详情页的 `.manga-detail li` 不含 `.md-title` 为 `Parody` 或 `Characters` 的节点
- **那么** `ComicInfo.parodies == []` 且 `ComicInfo.characters == []`
- **且** 不得抛出异常
