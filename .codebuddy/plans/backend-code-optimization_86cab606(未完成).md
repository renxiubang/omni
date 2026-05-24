---
name: backend-code-optimization
overview: 优化后端代码：减少过度预防代码、整合重复代码、删除未使用代码，提升代码质量和可维护性。
todos:
  - id: create-utils-module
    content: 创建app/utils/模块，包含sse.py和websocket.py工具函数
    status: pending
  - id: refactor-sse-usage
    content: 重构chat.py和voice.py，使用公共的SSE格式化函数
    status: pending
    dependencies:
      - create-utils-module
  - id: refactor-websocket-utils
    content: 重构stt_ws.py和call_ws.py，使用公共的WebSocket工具函数
    status: pending
    dependencies:
      - create-utils-module
  - id: remove-over-defensive-main
    content: 清理main.py中的过度预防措施，移除不必要的try-except
    status: pending
  - id: remove-over-defensive-call-ws
    content: 移除call_ws.py中过度的assert语句
    status: pending
  - id: remove-over-defensive-stt-ws
    content: 清理stt_ws.py中过度的异常捕获
    status: pending
  - id: refactor-voice-print-error-handling
    content: 重构voice_print.py，整合重复的错误处理代码
    status: pending
  - id: add-common-user-check
    content: 在database.py中添加公共的用户存在性检查函数
    status: pending
  - id: refactor-user-check-usage
    content: 重构users.py、wordbook.py使用公共用户检查函数
    status: pending
    dependencies:
      - add-common-user-check
  - id: remove-unused-imports
    content: 移除所有文件中未使用的导入语句
    status: pending
  - id: cleanup-dead-code
    content: 检查并删除确认未使用的死代码
    status: pending
  - id: update-imports-and-test
    content: 更新所有导入语句并测试验证功能正常
    status: pending
    dependencies:
      - refactor-sse-usage
      - refactor-websocket-utils
      - refactor-voice-print-error-handling
      - refactor-user-check-usage
      - remove-unused-imports
      - cleanup-dead-code
---

## 用户需求

优化后端Python代码，具体目标：

1. 减少过度预防代码（over-defensive coding）- 移除不必要的try-except、assert和不合理的防御性检查
2. 整合重复代码（DRY原则）- 提取公共函数、消除重复逻辑
3. 删除未使用的代码（死代码清理）- 移除未使用的导入、未调用的函数

## 产品概述

Omni Chat后端是一个基于FastAPI的Python应用，提供语音识别(ASR)、语音合成(TTS)、LLM对话、WebSocket实时通信等功能。当前代码存在过度防御、重复代码和未使用代码的问题，需要优化以提高代码质量和可维护性。

## 核心功能优化点

- 清理main.py中的过度预防措施
- 整合chat.py和voice.py中的重复_sse函数
- 整合stt_ws.py和call_ws.py中的WebSocket发送函数
- 清理voice_print.py中的重复错误处理代码
- 移除未使用的导入和死代码
- 简化用户存在性检查逻辑

## 技术栈

- **框架**: FastAPI (Python)
- **数据库**: SQLite (通过sqlite3直接操作)
- **WebSocket**: websockets库、aiortc
- **API客户端**: OpenAI SDK、DashScope SDK
- **音频处理**: numpy、PyAV、ffmpeg

## 实现方法

### 1. 减少过度预防代码

**策略**: 识别并移除不必要的try-except块、assert语句和过度防御性检查

**具体实施**:

#### main.py (第19-30行)

- **问题**: try-except仅记录警告而不抛出异常，可能掩盖启动问题
- **解决方案**: 移除try-except，让异常正常抛出，或改为抛出异常以阻止应用启动
- **代码变更**:

```python
# 修改前
try:
persona_store.load(_personas_path)
except Exception as e:
logging.warning("Failed to load personas: %s", e)

# 修改后
persona_store.load(_personas_path)
logging.info("Loaded %d personas from %s", len(persona_store.list_all()), _personas_path)
```

#### call_ws.py (第88行)

- **问题**: `assert session` 是过度防御，session已在第23行检查
- **解决方案**: 移除assert，因为逻辑上不可能为None
- **代码变更**: 删除第88行 `assert session`

#### stt_ws.py (第56-59行)

- **问题**: 在periodic_asr中捕获asyncio.CancelledError后又重新抛出，这是多余的
- **解决方案**: 移除内部的CancelledError捕获，让外层统一处理
- **代码变更**: 删除第56-57行的 `except asyncio.CancelledError: raise`

#### voice_print.py

- **问题**: 大量重复的错误处理和文件清理代码（第84-94、107-119、114-123行）
- **解决方案**: 提取公共的清理函数，统一错误处理

### 2. 整合重复代码

**策略**: 提取公共函数到共享模块，消除重复逻辑

#### 重复问题1: _sse函数 (chat.py第14-15行, voice.py第18-19行)

- **解决方案**: 创建公共工具函数
- **实施步骤**:

1. 创建 `app/utils/sse.py` 模块
2. 定义公共的 `format_sse_event(event: str, data: dict) -> str` 函数
3. 修改chat.py和voice.py导入公共函数

#### 重复问题2: WebSocket发送函数

- **问题**: 
- `stt_ws.py`第13-14行: `_send_json(ws, payload)`
- `call_ws.py`第16-17行: `_send(ws, payload)`
- **解决方案**: 整合为公共函数
- **实施步骤**:

1. 在 `app/utils/websocket.py` 中定义 `send_json(ws, payload)` 函数
2. 修改stt_ws.py和call_ws.py导入公共函数

#### 重复问题3: 用户存在性检查

- **问题**: users.py、wordbook.py、voice_print.py中都有类似的用户存在性检查
- **解决方案**: 提取为数据库层的公共函数
- **实施步骤**:

1. 在 `app/db/database.py` 中添加 `require_user_by_id(user_id)` 函数
2. 修改各API路由使用公共函数

### 3. 删除未使用的代码

**策略**: 识别并移除未使用的导入、函数和变量

#### 未使用的导入

- **voice_print.py第9行**: `from typing import List, Optional` - Optional未使用
- **实施步骤**: 移除未使用的Optional导入，保留List

#### 其他可能的死代码

- **database.py**: 检查是否有未调用的函数
- **session_store.py**: 检查StoredMessage是否有未使用的字段
- **实施步骤**: 

1. 搜索函数调用确认是否死代码
2. 移除确认未使用的代码

## 实施细节

### 性能考虑

- 移除过度预防措施不会负面影响性能，反而提高代码可读性
- 整合重复代码减少代码量，提高维护性
- 删除死代码减少内存占用和加载时间

### 可靠性考虑

- 移除try-except时需要确保异常能被上层正确处理
- 整合代码时需要确保不改变原有行为
- 删除代码前需要确认确实未使用

### 向后兼容性

- 所有优化不应改变API行为
- 保持函数签名不变
- 保持错误处理机制合理

## 架构设计

### 当前架构

```
backend/app/
├── api/          # API路由
├── db/           # 数据库操作
├── gateway/      # WebSocket网关
├── schemas/      # Pydantic模型
├── services/     # 业务服务
├── config.py     # 配置
├── main.py       # 应用入口
└── persona_loader.py  # 人格加载
```

### 优化后的架构变化

- 新增 `app/utils/` 目录，包含：
- `sse.py`: SSE事件格式化函数
- `websocket.py`: WebSocket工具函数

## 目录结构

### 新增文件

```
backend/app/
├── utils/
│   ├── __init__.py          # [NEW] 工具包初始化
│   ├── sse.py               # [NEW] SSE事件格式化
│   └── websocket.py         # [NEW] WebSocket工具函数
```

### 修改文件

```
backend/app/
├── main.py                  # [MODIFY] 移除过度预防的try-except
├── api/
│   ├── chat.py              # [MODIFY] 使用公共sse函数
│   ├── voice.py             # [MODIFY] 使用公共sse函数
│   ├── voice_print.py       # [MODIFY] 整合重复错误处理
│   ├── wordbook.py         # [MODIFY] 使用公共用户检查
│   └── users.py            # [MODIFY] 使用公共用户检查
├── gateway/
│   ├── stt_ws.py           # [MODIFY] 使用公共WebSocket函数，移除过度捕获
│   └── call_ws.py          # [MODIFY] 使用公共WebSocket函数，移除assert
└── db/
    └── database.py          # [MODIFY] 添加公共用户检查函数，删除死代码
```

## 关键代码结构

### app/utils/sse.py

```python
"""SSE event formatting utilities."""

import json


def format_sse_event(event: str, data: dict) -> str:
    """Format SSE event.
    
    Args:
        event: Event type name
        data: Event data dictionary
        
    Returns:
        Formatted SSE event string
    """
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"
```

### app/utils/websocket.py

```python
"""WebSocket utility functions."""

import json
from fastapi import WebSocket


async def send_json(ws: WebSocket, payload: dict) -> None:
    """Send JSON payload via WebSocket.
    
    Args:
        ws: WebSocket connection
        payload: Data to send
    """
    await ws.send_text(json.dumps(payload, ensure_ascii=False))
```

### app/db/database.py 新增函数

```python
def require_user_by_id(user_id: int) -> Dict[str, Any]:
    """Get user by ID or raise ValueError.
    
    Args:
        user_id: User ID
        
    Returns:
        User data dictionary
        
    Raises:
        ValueError: If user not found
    """
    user = get_user_by_id(user_id)
    if not user:
        raise ValueError(f"User with ID {user_id} not found")
    return user
```