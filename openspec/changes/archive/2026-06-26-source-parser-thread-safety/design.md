## 上下文

`MultiSourceParser` 在 `parser-lazy-init` 规范下采用懒创建：解析器类按需 import 并缓存进模块级 `_PARSER_CLASSES`，解析器实例按需构造并缓存进实例级 `self._parsers`。

IPC server 在 `python/ipc_server.py:189-192` 用 8-worker `ThreadPoolExecutor` 跑通用请求处理器：

```python
self._request_executor = ThreadPoolExecutor(
    max_workers=_REQUEST_POOL_MAX_WORKERS, thread_name_prefix="request"
)
```

所有非 cover/preview 的 handler（search、favourites、verify_login_status、prepare_for_download、…）经 `self.parser` → `MultiSourceParser` 的公开方法 → `_get_parser(src)` 到达懒创建路径。多窗口并发、批量下载 + 搜索、多任务调度都会让同一 source 的 `_get_parser` 在多个线程同时首次命中。

**修复前**两条路径都是裸 check-then-act：

```python
# 模块级（修复前）
cls = _PARSER_CLASSES.get(source)
if cls is None:
    module = importlib.import_module(module_path)  # ← 两线程可同时进入
    cls = getattr(module, class_name)
    _PARSER_CLASSES[source] = cls                  # ← last-writer-wins 覆盖

# 实例级（修复前）
if name not in self._parsers:
    factory = self._factory.get(name)
    parser = factory()                              # ← 两线程各构造一个 Session
    self._parsers[name] = parser
    self._apply_post_init(name, parser)             # ← 后处理可能跑多次
return self._parsers[name]
```

后果：(a) 浪费资源重复构造 `requests.Session` + 代理注入；(b) 非确定性决定哪个实例被复用；(c) `_apply_post_init`（恢复凭据/token/质量）可能对废弃实例执行。

## 目标 / 非目标

**目标：**
- 相同 source 在任意并发下只构造**一次**解析器类与**一次**解析器实例。
- 单线程快路径（已有缓存）性能不退化 —— 无锁返回。
- 用回归测试固化并发不变量，而非靠人工审查防回归。

**非目标：**
- 不改变懒创建的对外语义（仍按需构造、单例缓存）。
- 不引入读写锁等更复杂原语 —— 写入是一次性的（首创建后只读），简单 Lock 足矣。
- 不为 `_apply_post_init` 内部的解析器方法调用加锁（那些方法自身的线程安全是各 parser 的职责）。

## 决策

### 决策 1：double-checked locking（快路径无锁）

**选择**：两条路径都用同一模式 —— 先无锁读缓存，命中即返回；未命中才持锁，并在锁内**二次检查**缓存后才构造。

```python
# 模块级
cls = _PARSER_CLASSES.get(source)
if cls is None:
    with _PARSER_INIT_LOCK:
        cls = _PARSER_CLASSES.get(source)   # 锁内二次检查
        if cls is None:
            ...                             # 真正 import + 缓存
return cls
```

**理由**：写入是一次性事件（某 source 首次访问后永不再写），后续全是只读命中。无锁快路径让稳态零开销；锁内二次检查处理“两线程同时通过首次无锁 None 检查”的窗口，让后到者直接复用先到者的成果。

**替代方案**：（a）整个函数体直接 `with lock` —— 牺牲稳态读性能，且本场景写极罕见，不值；（b）用 `functools.lru_cache` 包装 `_load_parser_class` —— `lru_cache` 对 hashable 参数线程安全且单次调用，可解决模块级问题，但实例级 `_get_parser` 依赖 `self._parsers` 且需调用 `_apply_post_init`，`lru_cache` 不适用；为一致性两条路径都用显式锁。

### 决策 2：两把锁分离（模块锁 + 实例锁）

**选择**：
- 模块级 `_PARSER_INIT_LOCK`（`threading.Lock()`，模块单例）守卫 `_PARSER_CLASSES`。
- 实例级 `self._parser_lock`（每个 `MultiSourceParser` 一个）守卫 `self._parsers`。

**理由**：作用域不同。模块锁防“全进程重复 import 同一类”；实例锁防“同一 `MultiSourceParser` 重复构造同一实例”。若共用模块锁，则两个独立的 `MultiSourceParser`（如测试里频繁构造的实例）会互相阻塞 —— 不必要且拖慢测试。分离后，不同实例的并发互不干扰，同一实例的并发被正确串行化。

**替代方案**：共用一把锁 —— 见上，会引入跨实例不必要的阻塞，且把两个正交关注点耦合在一起。

### 决策 3：`_apply_post_init` 仍在锁内执行

**选择**：工厂调用 + `_apply_post_init`（凭据/token/质量恢复）都放在锁内，即整个“构造并配置新实例”的临界区。

**理由**：`_apply_post_init` 必须对“胜出的”那个实例执行恰好一次。若把它移出锁，后到者跳过构造后可能拿到一个未被 `_apply_post_init` 配置过的实例（先到者还没跑完后处理就释放锁），导致凭据/token 丢失。锁内执行保证“构造即配置”原子。

**权衡**：`_apply_post_init` 内部会调用解析器方法（如 `set_image_quality`），但这些是纯内存赋值，无 I/O，持锁时间可忽略。

### 决策 4：测试用 Barrier 最大化竞争 + 恰好一次断言

**选择**：`test_concurrent_get_parser_constructs_each_source_once` 对 4 个非默认来源（jm/bika/moeimg/copymanga）各发 16 个线程，用 `threading.Barrier(N)` 让全部 64 线程同时释放，最大化首次访问的竞争窗口；用计数包装的工厂断言每个 source 工厂**恰好调用 1 次**（而非 `>=1`），并补 identity 不变量。

**理由**：`assert call_counts[s] == 1` 比 `>= 1` 严格得多 —— 前者能捕获“多构造一个被丢弃”的隐蔽 bug，后者不能。Barrier 而非随机 sleep：确定性最大化竞争，不引入 flaky 时序依赖（符合 `test-discipline` 反对 sleep+精确时序的精神）。断言工厂次数而非 `_parsers` 长度：工厂次数直接测“是否重复构造”，`_parsers` 长度只能间接推断。

**替代方案**：用 `unittest.mock.patch` 监视工厂 —— 但工厂是 dict value，patch 困难；直接重建 `_factory` 注入计数 wrapper 更直接且不依赖 mock 语义。

## 风险 / 权衡

- **[权衡] 双重检查锁定在无 GIL 的 Python 实现上的内存可见性** → CPython 有 GIL 保证 dict 写入对其他线程可见；本仓库只跑 CPython（`python3.12+`），无需 `volatile`/内存屏障。若未来移植到 free-threaded CPython，需复核 dict 读写的可见性，但当前无此需求（YAGNI）。
- **[风险] 锁内 `_apply_post_init` 调用解析器方法，若该方法触发网络 I/O 会持锁过久** → 审查确认 `_apply_post_init` 内的方法（`configure_auth`、`set_stored_credentials`、`set_image_quality`、`set_custom_domain`）全是纯内存赋值，无网络，持锁时间为微秒级。不构成风险。
- **[权衡] 模块级 `_PARSER_INIT_LOCK` 是全局单例，测试中 reload `sources` 会新建锁对象** → 这是期望行为：`importlib.reload` 重新执行模块体，新锁对应新模块状态。`test_sources_lazy_import.py` 的 autouse fixture 在 teardown 清 `_PARSER_CLASSES`，与锁生命周期一致。
- **[权衡] 实例锁让 `_get_parser` 在单实例内串行化首次创建** → 首次创建只发生一次（之后走无锁快路径），串行化代价是单次性的，可忽略。
