## 新增需求

### 需求:懒创建路径必须并发安全

`_load_parser_class`（类导入）与 `MultiSourceParser._get_parser`（实例创建）在 IPC server 的并发请求线程（`ThreadPoolExecutor`，最多 8 worker）下会被同时调用。两条路径必须用 double-checked locking 守卫：相同 source 在任意并发下只构造**一次**解析器类与**一次**解析器实例，且后续访问返回同一实例。稳态（已有缓存）必须走无锁快路径，避免性能退化。

#### 场景:并发首次访问同一来源只构造一次实例

- **当** 多个线程同时调用 `MultiSourceParser._get_parser("jm")` 且 jm 尚未创建
- **那么** 仅有一个线程执行工厂调用，其余线程阻塞于锁后复用其结果
- **且** 最终 `self._parsers["jm"]` 仅含一个实例
- **且** 所有调用方拿到的实例身份相等（`is`）

#### 场景:并发首次导入同一来源类只缓存一次

- **当** 多个线程同时调用 `_load_parser_class("bika")` 且该类尚未缓存
- **那么** 仅执行一次 `importlib.import_module` + `getattr`
- **且** `_PARSER_CLASSES["bika"]` 被赋值恰好一次

#### 场景:稳态读无锁快路径

- **当** 某 source 的解析器类与实例均已缓存
- **那么** `_load_parser_class` 与 `_get_parser` 的读路径不得获取任何锁
- **且** 返回缓存的类/实例对象

#### 场景:构造与后处理原子化

- **当** `_get_parser` 在锁内构造新实例
- **那么** `_apply_post_init`（凭据/token/质量恢复）必须在同一临界区内执行
- **且** 跳过构造的后到者拿到的实例已被正确应用后处理，不会拿到未配置实例

#### 场景:实例锁与模块锁分离

- **当** 两个独立的 `MultiSourceParser` 实例（如测试中频繁构造）并发创建各自的解析器
- **那么** 它们不得因争抢同一把锁而互相阻塞
- **且** 模块级 `_PARSER_INIT_LOCK` 守卫类导入，实例级 `self._parser_lock` 守卫实例创建，作用域互不重叠
