## 上下文

支持账号密码登录的来源（hcomic、moeimg、bika）当前 handler 结构：

```
parser.login(u, p)            ← 网络，失败抛异常
set_source_auth(token/cookie, u, p)
config.save()
configure_auth(...) + set_stored_credentials(u, p)
```

失败路径在第一步就抛出，保存步骤整体跳过 → 用户表单清空。此外 `handle_apply_auth`（curl 路径）调用 `set_source_auth` 时只传 token/cookie，`AuthSourceData` 的 username/password 默认空串，整体替换会覆盖已有凭据。

约束：
- 并发：`_config_write_lock` 已串行化所有 `config.save()` 临界区，避免 `os.replace` WinError 5 与 `source_auth` 字典读改写竞态。新逻辑必须沿用。
- 网络：网络请求（`parser.login()`）必须留在锁外，避免长事务阻塞其它配置写。
- 安全：密码明文落盘是既有行为（config.json，权限 0o600 / Win32 ACL 限当前用户），本变更不改变该等级。

## 目标 / 非目标

**目标：**
- 三个 `handle_*_login` 在 `parser.login()` 之前持久化 username/password，使登录失败时凭据仍被保存。
- 失败时也注入 `set_stored_credentials`，支持网络恢复后懒登录自动重试。
- `handle_apply_auth` 改为合并写，保留已有 username/password，杜绝 curl 覆盖。
- 沿用 `_config_write_lock`，保持并发安全。

**非目标：**
- 不改变密码存储形态（不做加密、不引入 keychain）。明文落盘现状保留。
- 不改变前端表单交互或回填逻辑（既有 `*SavedUsername` 回填路径不变）。
- 不触碰 jm / copymanga 的认证路径（它们走 curl/弹窗，无账号密码字段）。

## 决策

### 决策 1：新增 `_persist_credentials` 辅助，仅写 username/password

新增私有方法，读出现有条目保留 cookie/user_agent/bearer_token，只更新 username/password 并 save：

```
with _config_write_lock:
    existing = config.get_source_auth(source)
    set_source_auth(source, AuthSourceData(
        cookie=existing["cookie"], user_agent=existing["user_agent"],
        bearer_token=existing["bearer_token"],
        username=u, password=p,
    ))
    config.save(path)
```

**为什么**：直接复用 `set_source_auth` 的整体替换语义，但显式回填旧 token/cookie，避免引入第二个"部分更新"API 增加心智负担。`get_source_auth` 已保证返回齐全字段（`setdefault` 兜底）。

**替代方案**：在 `config.py` 新增 `update_credentials(source, u, p)` 方法做部分更新。被否决——会扩散 API 表面，而 `_persist_credentials` 仅在 mixin 内复用，无需对外暴露。

### 决策 2：handler 内顺序重排为「先存再登录」

```
_persist_credentials(source, u, p)         ← 锁内：仅凭据落盘
parser.set_stored_credentials(u, p)        ← 锁外：注入懒登录
try:
    token/cookie = parser.login(u, p)      ← 锁外：网络
except Exception:
    raise                                    ← 凭据已在盘上，直接抛
with _config_write_lock:                     ← 成功路径：落 token/cookie
    set_source_auth(source, AuthSourceData(
        cookie/bearer_token=token,
        user_agent=existing_ua or "",
        username=u, password=p,             ← 仍带凭据，保持幂等
    ))
    config.save(path)
configure_auth(...) + (成功路径的 set_stored_credentials 已在登录前完成)
```

**为什么登录前调 `set_stored_credentials`**：失败时凭据已在 parser 内，符合用户明确的「失败也写 set_stored_credentials」要求；成功路径重复调用无害（幂等覆盖）。

**为什么 `_persist_credentials` 仍走锁**：和既有 `set_source_auth + save` 临界区串行化保持一致，避免与 apply_auth 等其它写者竞态。

**替代方案 A**：`try/except` 捕获异常后补存（先登录、失败时再存）。被否决——登录期间用户可能改密码/关应用，先存更稳；且把"保存"和"成功"解耦是本次的核心意图。

**替代方案 B**：前端在调 login 前先调一个独立 `save_credentials` IPC。被否决——新增 IPC 通道与 preload 暴露面，且无法解决 apply_auth 覆盖（仍需后端改）。

### 决策 3：`handle_apply_auth` 合并写

调用 `set_source_auth` 前读 `existing = config.get_source_auth(source)`，将其 username/password 回填进 `AuthSourceData`。对 jm/copymanga 这类无 username 字段的来源，`get_source_auth` 不 setdefault 这两键，回填值为空串，行为不变。

## 风险 / 权衡

- **密码错误时懒登录反复失败**：[失败密码被注入 `_stored_credentials`，后续每次请求 `_ensure_session` 触发自动 login 失败]
  → 缓解：这是用户明确选择的预期行为（网络恢复后自动重试）。需在 commit message 与代码注释中标注，避免后人误判为 bug。错误信息会通过 ParserResponseError 正常冒泡到前端。

- **成功路径写两次**：[登录前 `_persist_credentials` 写一次（带空 token），成功后锁内再写一次（带 token）]
  → 缓解：两次均在锁内串行，无竞态；多一次原子 save 开销可忽略。这是为换取"失败也持久化"语义付出的最小代价。

- **`set_stored_credentials` 在锁外调用**：[parser 实例字段写入与配置写不在同一临界区]
  → 缓解：parser 实例字段不是 config.json 的并发保护对象（_config_write_lock 语义只覆盖 config.save），且 handler 调用本身是顺序的，无并发隐患。

- **既有 `_sync_legacy_fields` 联动**：[hcomic 的 `set_source_auth` 会同步 `auth_cookie/auth_user_agent`]
  → 缓解：`_persist_credentials` 写 hcomic 时 cookie/user_agent 来自 existing（即原值），`_sync_legacy_fields` 用同值回写，幂等，无副作用。
