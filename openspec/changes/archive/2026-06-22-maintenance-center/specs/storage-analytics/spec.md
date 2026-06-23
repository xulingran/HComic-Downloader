# Storage Analytics Specification

## 新增需求

### 需求:存储空间分析

系统必须能够扫描下载目录，统计总体空间占用，并按来源、格式、作者等维度分组，同时识别磁盘上的孤儿文件。

#### 场景:获取总体存储统计
- **当** 用户进入维护中心的存储分析页
- **那么** 系统返回 `totalSizeBytes`、`totalFiles` 以及 `orphanFiles` 概览

#### 场景:按格式分布
- **当** 下载目录中包含 `folder`、`cbz`、`zip` 三种格式
- **那么** 系统正确分别统计每种格式占用的字节数

#### 场景:按来源分布
- **当** 漫画资产的来源可被识别
- **那么** 系统按 `source_site` 分组统计；无法识别时归入 `unknown`

#### 场景:按作者分布
- **当** 漫画资产的作者可从 `ComicInfo.xml` 或文件名模板中解析
- **那么** 系统按作者分组并返回占用空间 Top 20

#### 场景:识别 Top 大文件
- **当** 系统完成下载目录扫描
- **那么** 按单个资产大小排序，返回 Top 20 大文件及其路径、标题、作者、大小和页数

#### 场景:识别孤儿文件
- **当** 磁盘上存在但 `download_history.db` 中没有对应 `output_path` 记录的漫画资产
- **那么** 系统将其计入 `orphanFiles`

## 目标

帮助用户理解下载目录的空间占用分布：按来源、格式、作者统计，并识别磁盘上存在但 `download_history.db` 中没有记录的孤儿文件。

## IPC 契约

### `python:get-storage-stats`

**参数**：无

**返回**：

```typescript
{
  totalSizeBytes: number
  totalFiles: number
  bySource: Record<string, number>        // source_site -> bytes
  byFormat: {
    folder: number
    cbz: number
    zip: number
  }
  byAuthor: Array<{
    name: string
    sizeBytes: number
    itemCount: number
  }>
  topItems: Array<{
    path: string
    title?: string
    author?: string
    sourceSite?: string
    sizeBytes: number
    pageCount?: number
  }>
  orphanFiles: {
    count: number
    sizeBytes: number
  }
}
```

## 统计维度

### 1. 总体统计

- `totalSizeBytes`：下载目录下所有识别出的漫画资产大小之和。
- `totalFiles`：资产项数（一个 CBZ 算 1 项，一个 folder 算 1 项）。

### 2. bySource

- 按 `source_site` 分组（如 `hcomic`、`jmcomic`、`moeimg`、`bika`、`copymanga`）。
- 若无法识别来源，归入 `"unknown"`。

**来源识别优先级**：
1. CBZ 内 `ComicInfo.xml` 的 `Web` 字段或自定义字段。
2. folder 名称前缀或路径特征（如 `temp_hcomic_*`）。
3. `download_history.db` 中按路径反查 source_site。

### 3. byFormat

- `cbz`：所有 `.cbz` 文件。
- `zip`：所有 `.zip` 文件。
- `folder`：下载目录下非临时、非图片文件的目录资产。

### 4. byAuthor

- 按作者名分组，统计每位作者占用的总空间与作品数。
- 只取占用空间 Top 20 的作者返回，前端可展示 Top 10。

**作者识别优先级**：
1. CBZ 内 `ComicInfo.xml` 的 `Writer` 字段。
2. folder/cbz 文件名按模板 `{author}-{title}` 解析出的前缀。
3. 若都无法识别，归入 `"unknown"`。

### 5. topItems

- 按单个资产大小排序，取 Top 20 返回。
- 每个条目包含路径、标题、作者、来源、大小、页数（若可读）。

### 6. orphanFiles

- 磁盘上存在但 `download_history.db` 中没有对应 `output_path` 记录的文件/目录。
- 仅统计直接位于 `download_dir` 下的漫画资产，不递归统计临时目录。

## 资产识别规则

遍历 `download_dir` 下的一级条目：

- 若以 `temp_` 开头 → 跳过（不属于已完成的漫画资产）。
- 若扩展名为 `.cbz` / `.zip` → 识别为压缩包资产。
- 若是目录且包含图片文件 → 识别为 folder 资产。
- 其他文件 → 跳过。

## 安全约束

- 只读取文件元数据，不打开图片做完整解码（CBZ 内元数据读取除外）。
- 所有路径必须位于 `download_dir` 内。
- 不跟随符号链接。

## 前端行为

- 展示三个核心数字卡片：总空间、总文件数、孤儿文件占用。
- 按来源展示条形图或饼图（使用纯 CSS 实现，不引入图表库）。
- 按格式展示占比条。
- 展示 Top 10 作者列表（名字 + 大小 + 作品数）。
- 展示 Top 10 大文件列表，提供「打开所在文件夹」入口。
- 孤儿文件卡片提供「查看并清理」跳转孤儿清理面板的入口（如果相关）。

## 性能考虑

- 遍历大量 CBZ 时，只需读取 `ComicInfo.xml`，不解压图片。
- 对 folder 只需统计直接子文件大小，不必打开每张图。
- 若目录非常大，可考虑缓存结果 5 分钟，或提供手动刷新按钮。

## 测试要点

1. 空下载目录返回全 0 统计。
2. 包含 cbz / zip / folder 三种格式时，`byFormat` 正确。
3. CBZ 内 `ComicInfo.xml` 的 `Writer` 被正确识别为作者。
4. 文件名模板 `{author}-{title}.cbz` 能解析出作者。
5. `download_history` 中没有记录的文件被计入 `orphanFiles`。
6. `temp_*` 目录不计入资产统计。
