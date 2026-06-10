---
name: tool-design
version: "1.0.0"
description: Agent Tool 设计原则与实践指南，帮助创建符合原子化、标准化接口的工具定义
author: team
tags: [tool, design, agent, architecture, best-practice]
category: design
---

# Tool Design Skill

## 适用场景

当需要为 Agent 创建新的 Tool、评估现有 Tool 粒度是否合理、或设计 Tool 接口规范时使用此 Skill。

---

## 一、Tool 的本质定义

Tool 不是"一行代码"或"一个函数"，而是从 **Agent 的认知视角** 看，一个**不可再分、失败即整体失败、有明确输入输出的能力单元**。Agent 不需要知道 Tool 内部如何工作，只知道"我能用它来做什么"。

Tool 的角色是 **回答者，而非思考者** ——它忠实地执行并返回结果，决策权始终在 Agent。

---

## 二、区分 Tool 的三大标准

判断一个东西是不是 Tool，不看它的实现形态（CLI、脚本、API），而看它如何被集成、调用和组合。

### 1. 接口的标准化

Tool 必须有一个**机器可读的、结构化的描述**，让 Agent 能理解何时以及如何调用它：

| 要素 | 说明 | 示例 |
|------|------|------|
| **名称** | 唯一标识 | `read_file` |
| **功能描述** | 自然语言说明 | "读取指定路径的文件内容" |
| **输入参数模式** | 严格定义类型、必填、约束 | `{"file_path": "string"}` |
| **输出格式** | Agent 能解析的结构化数据 | JSON / 结构化文本 |

**示例**：一个 Python 脚本如果只是手动运行 `python my_script.py data.csv`，它**不是** Tool。但封装为带函数签名和文档字符串的接口后，它就是：

```python
def process_data(input_file: str, output_format: str = "json") -> dict:
    """
    读取并处理数据文件，转换为指定格式。

    Args:
        input_file: 输入文件的路径，支持 csv, tsv。
        output_format: 输出格式，可选 "json" 或 "summary"。
    Returns:
        包含处理结果或状态信息的字典。
    """
    # ... 复杂的实现逻辑 ...
    return result
```

Agent 看到的是**接口承诺**，而不是内部实现。脚本内部可以极其复杂，但对外呈现的必须是原子化的单一职责。

### 2. 组合与编排的层级

Tool 位于 Agent 架构的最底层：

```
Agent (自治体)
  └── 具备规划、反思和工具使用能力的实体

Task / Chain (组合)
  └── Agent 规划并组合多个 Tool 完成的子目标

Tool (原子)  ← 你在设计这一层
  └── 完成单一、不可拆分的动作，由系统直接执行
```

**判断规则**：如果你发现自己在编写一个"调用 A，然后根据结果决定调用 B 或 C"的复杂函数，那你写的**不是 Tool**，而是一个需要被拆解的 Task，或一个子 Agent。正确的做法是让主 Agent 自己去编排 A、B、C 这几个独立的 Tool。

### 3. 环境与副作用

Tool 是对 Agent 能力边界的扩展，根据副作用分为两类：

| 类型 | 特点 | 示例 | 设计注意 |
|------|------|------|----------|
| **无副作用 / 只读** | 安全，可重试 | `read_file`, `database_query` | 优先实现，风险最低 |
| **有副作用 / 写操作** | 改变外部状态 | `write_file`, `send_email`, `create_ticket` | 需确认机制，谨慎设计 |

**反模式**：一个 Tool 内部混合了读取、复杂逻辑判断、再写入。应拆分为 `read_config` 和 `update_config` 两个独立 Tool，让 Agent 决定是否写入。

> Agent 的价值在于**决策**，Tool 只是执行决策的"手"和"眼"。

---

## 三、常见场景的 Tool 化判断

### CLI 是 Tool 吗？

`kubectl` 本身**不是** Tool——它是工具箱。但经过封装后，`kubectl_get_pods(namespace: str)` 就是完美的 Tool。

Tool 屏蔽了 CLI 的复杂交互，只暴露一个清晰的功能契约。

### Python 脚本可以是 Tool 吗？

可以，前提是满足标准：必须被**封装成可被 Agent 系统调用的函数/API**，带上结构化的接口描述。脚本内部逻辑可以极其复杂，但对外呈现必须是原子化的单一职责。

---

## 四、案例研究：屏幕状态读取

以"读取屏幕状态"为例，展示从反模式到最佳实践的设计演进：

### ❌ 反模式：笼统的"万能"Tool

```python
def get_screen_state() -> dict:
    """获取当前屏幕的完整状态。"""
    return {
        "active_window_title": "...",
        "all_ui_elements": [...],
        "full_screenshot_base64": "...",
        "clipboard_content": "..."
    }
```

**问题**：一次返回海量异构数据，Agent 需要自行解析提取。把信息提取的认知负担从 Tool 转移给了 Agent，浪费 Token 且易出错。

### ⚠️ 中等：粗粒度物理传感器

```python
def take_screenshot() -> Image:
    """获取当前屏幕的完整截图。"""
    pass
```

**分析**：职责单一，是合格的物理原子操作。但仍不够优——Agent（多模态模型）消耗大量计算理解图片，且无法针对非视觉元素查询。

### ✅ 最佳实践：细粒度信息查询 Tool

将"屏幕状态"转化为 Agent 逻辑上需要的一组具体信息获取工具：

```python
# Tool 1: 获取当前焦点窗口的信息
def get_active_window_info() -> dict:
    """返回活动窗口的标题、进程名和句柄。"""
    return {"title": "...", "process": "chrome.exe"}

# Tool 2: 获取窗口内可交互元素列表
def get_ui_elements(window_title: str, element_type: str = None) -> list:
    """
    返回指定窗口中可交互的 UI 元素列表，可按类型过滤。
    每个元素包含：名称、控件类型、坐标、是否可用。
    """
    return [{"name": "Save", "type": "button", "position": {...}}]

# Tool 3: 检查特定元素是否存在
def check_element_exists(window_title: str, element_name: str) -> bool:
    """快速检查某个名称的 UI 元素是否存在于指定窗口中。"""
    return True

# Tool 4: 获取鼠标位置控件详情
def get_element_at_cursor() -> dict:
    """返回鼠标悬停位置下的控件详细信息。"""
    return {"name": "...", "type": "..."}
```

**优势**：

- **纯原子化**：每个 Tool 只做一次明确、轻量级的查询
- **认知交还 Agent**：Agent 推理循环清晰——"需要保存" → "检查保存按钮" → "点击它"
- **高效精准**：只获取当前步骤所需的最小信息，不浪费 Token
- **可组合**：同一组 Tool 灵活应对查找文件、填写表单、点击按钮等各种任务

---

## 五、常见反模式与边界辨析

### 反模式 1：Tool 替 Agent 做语义判断

```python
# ❌ 反模式：Tool 内部做了相关性过滤（这是 LLM 该做的）
def fetch_webpage(url: str, query: str = None) -> str:
    html = download(url)
    text = extract_text(html)
    if query:
        # Tool 替你判断哪些内容"相关"
        return filter_by_keywords(text, query)
    return text

# ✅ 正确：Tool 返回完整文本，让 Agent 判断相关性
def fetch_webpage(url: str) -> str:
    html = download(url)
    return extract_text(html)
```

**原则**：任何涉及"内容相关性"、"重要性"、"好坏"的判断都是 Agent 的职责。Tool 只做机械事实操作。

### 反模式 2：万能命令执行

```python
# ❌ 反模式：一个 Tool 涵盖只读查询和破坏性写入
def execute_command(cmd: str) -> str:
    # git status 和 rm -rf / 走同一个入口
    return run(cmd)

# ✅ 正确：按副作用级别拆分
def run_command(cmd: str) -> str:     # 写入型，需确认
def read_command(cmd: str) -> str:    # 只读型，无需确认
```

### 反模式 3：内部重复造轮子

```python
# ❌ 反模式：grep Tool 内部自己实现了一遍 glob 文件扫描
def grep(pattern: str, path: str) -> list:
    files = my_own_glob_implementation(path)  # 重复！
    return search_in_files(files, pattern)

# ✅ 正确：复用已有的 glob 能力
def grep_content(files: list[str], pattern: str) -> list:
    return search_in_files(files, pattern)
# Agent 编排：glob("**/*.ts") → grep_content(files, "TODO")
```

### 关键辨析：输入校验 ≠ 业务决策

这是最常见的误判。以下两者有本质区别：

```python
# ✅ 输入校验（Tool 应该做）：前置条件不满足则失败
if not content.includes(old_string):
    raise ToolError("未找到要替换的内容")

# ❌ 业务决策（Tool 不该做）：替 Agent 选择策略
if file.endswith(".json"):
    update_json(file)
elif file.endswith(".yaml"):
    update_yaml(file)
```

| 类型 | 特征 | 示例 | 谁负责 |
|------|------|------|--------|
| **输入校验** | 检查前置条件是否满足，不满足则失败 | 字符串不存在无法替换 | Tool |
| **业务决策** | 根据数据特征选择不同执行路径 | 根据文件类型选择解析器 | Agent |

**判断技巧**：如果 Tool 的判断逻辑只有一个结果（失败），它是校验；如果它有两个以上不同的成功路径，它是决策。

## 六、设计检查清单

在创建 Tool 之前，用以下问题自查：

1. **单一职责**：这个 Tool 是否只做一件事？如果描述中出现了"和"、"然后"，考虑拆分。
2. **接口清晰**：输入参数是否严格定义了类型和约束？输出格式是否结构化？
3. **无决策逻辑**：Tool 内部是否包含 if-else 业务判断（非输入校验）？如有，把判断权交还给 Agent。
4. **副作用明确**：是否清楚标注了 `sideEffect: "read" | "write"`？写入操作是否有确认机制？
5. **可组合**：这个 Tool 能否与其他 Tool 灵活组合，完成多种不同的任务？
6. **不复用轮子**：Tool 内部是否重新实现了已有 Tool 的功能？如有，改为组合调用。
7. **不替 Agent 判断**：Tool 是否做了任何"内容相关性"、"重要性"、"好坏"的过滤？如有，移除。

---

## 七、核心总结

| 维度 | 关键原则 |
|------|----------|
| **角色定位** | Tool 是回答者，不是思考者 |
| **边界判定** | 不由代码长度或技术栈决定，由在 Agent 推理循环中的逻辑角色决定 |
| **实现形态** | CLI、Python 脚本、API、甚至调用另一个 AI 模型都可以 |
| **架构契约** | 它是 Agent 推理循环中执行原子动作的、具有标准化接口的"手"和"眼" |
| **拆分信号** | Tool 内部出现业务判断和流程控制 → 立即拆分 |
| **校验 vs 决策** | 输入校验（失败路径唯一）属于 Tool；业务决策（多个成功路径）属于 Agent |
| **副作用标注** | 每个 Tool 必须声明 `sideEffect: "read" | "write"`，驱动确认机制 |
