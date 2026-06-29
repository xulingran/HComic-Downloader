## 修改需求

### 需求:CI 闸门必须拦截新增的裸 mock 调用断言

仓库**必须**提供一条自动化检查（lint 规则或测试收集期静态扫描），在 CI 与本地 `npm run lint` / `pytest --collect-only` 路径中拦截新引入的"仅断言 mock 被调用、不同时验证真实行为"的测试断言。闸门的判定准则与 `test-discipline` 的"mock 替换测试"一致：若把被 mock 的对象替换为真实实现后断言仍必然成立，则该断言为同义反复，闸门**必须**失败。

闸门**必须**区分两类形态，不得一律拦截：
- **裸调用断言**（无信号，**必须拦截**）：`expect(x).toHaveBeenCalled()`、Python `mock.assert_called()`、`mock.assert_any_call(...)`、`mock.assert_has_calls(...)`。这些仅断言"被调用过"/"调用历史"，mock 替换测试成立——不承载被测代码的任何不变量。
- **断言性次数/否定断言**（承载信号，**必须放行**）：`expect(x).toHaveBeenCalledTimes(<字面量>)`（断言"触发 N 次"）、`expect(x).not.toHaveBeenCalled()`（断言"未触发"）、Python `mock.assert_called_once()`（断言"恰好一次"）、`mock.assert_not_called()`（断言"未触发"）。这些承载"触发次数/未触发"的真实不变量信号（如"批量通知恰好触发一次"、"cancel 后任务未执行"、"重启恰好两次"），mock 替换测试**不**成立（次数/否定性由被测代码逻辑决定）。
- **参数契约断言**（承载信号，**必须放行**）：前端 `expect(x).toHaveBeenCalledWith(...)`、Python `mock.assert_called_with(...)` / `mock.assert_called_once_with(...)`。这些断言的参数几乎总是承载被测代码构建的真实数据（如被测代码组装的 URL/JSON body/标志位），mock 替换测试**不**成立——即便参数全为字面量，断言的语义是"被测代码以这些参数调用了协作方"，属契约验证而非同义反复。**禁止**对这类断言按"参数是否全字面量"区分拦截。

闸门**必须**同时支持前端（Vitest，作用域 `tests/unit`）与 Python（pytest，作用域 `tests/`）两侧，缺一不可。闸门**禁止**以"文件类型批量放行"的方式绕过逐条甄别（如不得对 `stores/` 目录整体放行 `toHaveBeenCalled`）。

#### 场景:前端裸 toHaveBeenCalled 被拦截

- **当** 一个新增或修改的前端测试用例在 `tests/unit` 作用域内包含 `expect(x).toHaveBeenCalled()`（无参）形式的断言，且同一 `it` 块内不存在任何对返回值（`expect(await fn()).toEqual(...)` / `resolves`）、抛错（`rejects.toThrow`）、断言性次数（`toHaveBeenCalledTimes(<字面量>)`）或可观察状态变化（`getState()` / DOM / `document` 属性）的断言
- **那么** 闸门**必须**报告该用例为失败，并提示"补充行为断言（返回值/状态/抛错/断言性次数）或删除该 mock 调用断言"

#### 场景:前端断言性次数断言被放行

- **当** 一个测试用例仅含 `expect(x).toHaveBeenCalledTimes(<字面量>)` 形式断言（如 `toHaveBeenCalledTimes(1)` 断言"通知恰好触发一次"、`toHaveBeenCalledTimes(2)` 断言"重启恰好两次"），而无其他真实行为断言
- **那么** 闸门**必须**放行该用例，因为字面量次数承载"触发 N 次"的真实不变量信号（mock 替换测试不成立：次数由被测代码逻辑决定）

#### 场景:前端否定 mock 断言被放行

- **当** 一个测试用例仅含 `expect(x).not.toHaveBeenCalled()` 形式断言（断言"未触发"，如 cancel 后任务未执行、守卫拒绝后回调未调用）
- **那么** 闸门**必须**放行，因为"未触发"承载"取消/守卫/短路"逻辑的真实信号

#### 场景:Python 裸 assert_called 被拦截

- **当** 一个新增或修改的 Python 测试用例包含 `mock.assert_called()` / `mock.assert_any_call(...)` / `mock.assert_has_calls(...)` 形式的断言，且同一测试函数内不存在对返回值、异常（`pytest.raises` / `try-except`）、断言性次数（`assert_called_once`）、参数契约（`assert_called_with` / `assert_called_once_with`）或可观察状态（属性读取、文件内容、字典内容）的断言
- **那么** 闸门**必须**报告该用例为失败

#### 场景:Python assert_called_once 被放行

- **当** 一个测试用例含 `mock.assert_called_once()`（断言"恰好一次"），无其他真实行为断言
- **那么** 闸门**必须**放行，因为"恰好一次"承载真实不变量信号（与前端 `toHaveBeenCalledTimes(1)` 对齐）

#### 场景:Python assert_called_with 全部放行不按字面量区分

- **当** 一个测试用例含 `mock.assert_called_with(...)` 或 `mock.assert_called_once_with(...)` 形式断言（无论参数是否全字面量）
- **那么** 闸门**必须**放行，因为这类断言验证"被测代码以特定参数调用了协作方"的契约，参数承载被测代码构建的真实数据（如组装的 URL/JSON/标志位），mock 替换测试不成立。**禁止**按参数是否全字面量区分拦截——本规范不要求实现做参数来源判定，`scripts/lint-test-quality.py` 的 `BARE_MOCK_ASSERTIONS` 拦截集**禁止**包含 `assert_called_with` / `assert_called_once_with`。

#### 场景:伴随行为断言的 mock 断言被放行

- **当** 一个测试用例同时包含 mock 调用断言**与**真实的返回值/状态/抛错/断言性次数断言
- **那么** 闸门**必须**放行该用例，因为 mock 断言作为副信号附属于真实行为断言

#### 场景:桥接参数转换断言被放行

- **当** 一个用例使用 `toHaveBeenCalledWith(expected, transformedArg)` 形式断言，且 `transformedArg` 来自被测代码的参数转换逻辑（如 camelCase→snake_case 映射、校验后的净化值）
- **那么** 闸门**必须**放行，因为 `toHaveBeenCalledWith` 的参数本身承载了真实行为信号（区别于无参的 `toHaveBeenCalled()`）

#### 场景:前端正则/变量次数仍视为裸调用

- **当** 一个测试用例含 `expect(x).toHaveBeenCalledTimes(expect.any(Number))` 或 `toHaveBeenCalledTimes(n)`（`n` 为变量而非字面量）形式断言
- **那么** 闸门**仍必须**按裸调用判定（拦截），因为非字面量次数不承载确定的"触发 N 次"信号（`expect.any(Number)` 等价于"任意次数"=被调用过，无信号）
