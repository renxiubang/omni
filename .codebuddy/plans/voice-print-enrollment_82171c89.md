---
name: voice-print-enrollment
overview: 在配置页面增加声纹录入功能，采用引导式录入流程（朗读指定文本3-5次），支持后端存储声纹音频数据，为后续声纹识别做准备。
design:
  architecture:
    framework: react
    component: shadcn
  styleKeywords:
    - Minimalism
    - Clean
    - Modern
    - Intuitive
  fontSystem:
    fontFamily: PingFang SC
    heading:
      size: 20px
      weight: 600
    subheading:
      size: 17px
      weight: 500
    body:
      size: 15px
      weight: 400
  colorSystem:
    primary:
      - "#07c160"
      - "#06ad56"
    background:
      - "#ededed"
      - "#ffffff"
    text:
      - "#111111"
      - "#333333"
      - "#999999"
    functional:
      - "#07c160"
      - "#ff4d4f"
      - "#ffa940"
todos:
  - id: db-design
    content: 设计并创建 voice_profiles 数据库表，实现CRUD操作函数
    status: completed
  - id: backend-api
    content: 实现后端声纹API端点（录入、查询、删除），注册到主应用
    status: completed
    dependencies:
      - db-design
  - id: frontend-api
    content: 封装前端声纹API调用函数（enrollVoicePrint、listVoiceProfiles、deleteVoiceProfile）
    status: completed
  - id: voiceprint-hook
    content: 创建 useVoicePrint Hook，封装录音逻辑和API调用状态管理
    status: completed
    dependencies:
      - frontend-api
  - id: enroll-component
    content: 开发 VoicePrintEnroll 组件，实现引导式声纹录入界面和交互流程
    status: completed
    dependencies:
      - voiceprint-hook
  - id: settings-integration
    content: 修改 SettingsPage 组件，集成声纹管理区域和声纹录入功能
    status: completed
    dependencies:
      - enroll-component
  - id: test-verify
    content: 测试声纹录入流程、档案管理和多设备同步功能
    status: completed
    dependencies:
      - settings-integration
---

## 产品概述

在配置页面增加声纹录入功能，为后续对话融入声纹识别（说话人识别）做准备。采用引导式录入流程，用户需朗读指定文本3-5次以提高准确度。声纹数据存储在后端SQLite数据库，支持多设备同步。

## 核心功能

- **引导式声纹录入**：显示指定文本，引导用户朗读3-5次，每次录制后可回放确认或重录
- **声纹档案管理**：在配置页面展示已录入的声纹档案列表，支持删除操作
- **后端存储**：声纹音频样本存储在后端，通过API与前端交互，支持多设备同步
- **录音功能**：基于MediaRecorder API实现浏览器录音，参考现有VoiceHoldButton组件的实现模式

## 技术栈选择

- **前端**：React 19 + TypeScript + Tailwind CSS（沿用现有项目技术栈）
- **录音实现**：MediaRecorder API（参考现有VoiceHoldButton.tsx组件）
- **后端**：FastAPI + SQLite（沿用现有项目技术栈）
- **声纹特征提取**：暂存原始音频数据，后续接入识别服务时再提取特征

## 实现方案

### 数据库设计

新增 `voice_profiles` 表用于存储声纹档案：

- id: 主键
- user_id: 关联用户ID
- name: 声纹档案名称
- audio_samples: 音频样本文件路径（JSON数组格式）
- enrollment_text: 录入时朗读的文本
- created_at: 创建时间
- updated_at: 更新时间

### 后端API设计

新增 `backend/app/api/voice_print.py` 模块，提供以下端点：

- `POST /api/voice-print/enroll`：上传声纹音频样本
- `GET /api/voice-print/list`：获取当前用户的声纹档案列表
- `DELETE /api/voice-print/{profile_id}`：删除指定声纹档案

### 前端架构设计

采用组件化设计，新增以下模块：

1. `VoicePrintEnroll.tsx`：声纹录入组件，实现引导式录入流程
2. `useVoicePrint.ts`：自定义Hook，封装录音和API调用逻辑
3. `voicePrintApi.ts`：API调用封装，与后端voice_print API交互

### 引导式录入流程

1. 用户点击"录入新声纹"按钮
2. 显示引导页面，说明需要朗读3-5次指定文本
3. 显示指定文本（如"我是{用户名}，这是我的声纹信息"）
4. 用户点击"开始录制"，调用MediaRecorder API录制音频
5. 录制完成，自动播放回放，用户可选择确认或重录
6. 重复步骤4-5，直到完成3-5次录制
7. 上传所有音频样本到后端API
8. 录入成功，返回声纹档案列表

## 实现要点

### 数据库修改

修改 `backend/app/db/database.py`，新增以下内容：

- `voice_profiles` 表创建SQL
- `create_voice_profile()` 函数：创建声纹档案
- `get_user_voice_profiles()` 函数：获取用户声纹档案列表
- `delete_voice_profile()` 函数：删除声纹档案
- `init_db()` 函数：添加 voice_profiles 表创建逻辑

### 后端API实现

创建 `backend/app/api/voice_print.py`，参考现有 `users.py` 和 `voice.py` 的代码模式：

- 使用FastAPI的APIRouter
- 定义Pydantic请求/响应模型
- 实现声纹录入、查询、删除端点
- 音频文件保存到服务器指定目录

### 前端API封装

创建 `frontend/src/api/voicePrintApi.ts`，封装以下API调用：

- `enrollVoicePrint()`：上传声纹音频样本
- `listVoiceProfiles()`：获取声纹档案列表
- `deleteVoiceProfile()`：删除声纹档案

### 前端Hooks实现

创建 `frontend/src/hooks/useVoicePrint.ts`，封装以下逻辑：

- 录音功能：使用MediaRecorder API
- 音频回放：使用Audio元素
- API调用：与后端voice_print API交互
- 状态管理：录制状态、上传状态、档案列表状态

### 声纹录入组件

创建 `frontend/src/components/VoicePrintEnroll.tsx`，实现以下功能：

- 引导页面：说明录入流程和注意事项
- 文本显示：显示需要朗读的指定文本
- 录音界面：录制音频，显示录制状态
- 回放确认：播放录制的音频，确认或重录
- 进度指示：显示当前录制次数和总次数
- 完成页面：录入成功提示

### 集成到设置页面

修改 `frontend/src/pages/SettingsPage.tsx`，添加以下内容：

- 声纹管理区域：标题、档案列表、录入按钮
- 声纹档案列表：显示已录入的声纹档案，支持删除操作
- 录入按钮：点击打开VoicePrintEnroll组件

## 目录结构

```
前端修改/新增文件：
frontend/src/
├── pages/
│   └── SettingsPage.tsx          [MODIFY] 添加声纹管理区域
├── components/
│   └── VoicePrintEnroll.tsx      [NEW] 声纹录入组件
├── hooks/
│   └── useVoicePrint.ts          [NEW] 声纹录入相关hook
└── api/
    └── voicePrintApi.ts          [NEW] 声纹API调用

后端修改/新增文件：
backend/app/
├── api/
│   └── voice_print.py           [NEW] 声纹API路由
├── db/
│   └── database.py              [MODIFY] 添加 voice_profiles 表操作
└── main.py                      [MODIFY] 注册 voice_print 路由
```

## 关键代码结构

### 数据库表结构

```sql
CREATE TABLE IF NOT EXISTS voice_profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    audio_samples TEXT NOT NULL,
    enrollment_text TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(user_id, name),
    FOREIGN KEY (user_id) REFERENCES users (id)
)
```

### 后端API路由

```python
# backend/app/api/voice_print.py
from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pydantic import BaseModel

router = APIRouter(prefix="/api/voice-print", tags=["voice-print"])

class VoicePrintEnrollRequest(BaseModel):
    user_id: int
    name: str
    enrollment_text: str

@router.post("/enroll")
async def enroll_voice_print(
    user_id: int = Form(...),
    name: str = Form(...),
    enrollment_text: str = Form(...),
    audio_samples: list[UploadFile] = File(...),
):
    """注册声纹"""
    # 实现声纹注册逻辑
    pass

@router.get("/list")
async def list_voice_profiles(user_id: int = Query(...)):
    """获取用户的声纹档案列表"""
    # 实现查询逻辑
    pass

@router.delete("/{profile_id}")
async def delete_voice_profile(profile_id: int, user_id: int = Query(...)):
    """删除声纹档案"""
    # 实现删除逻辑
    pass
```

### 前端API调用

```typescript
// frontend/src/api/voicePrintApi.ts
export interface VoiceProfile {
  id: number;
  user_id: number;
  name: string;
  audio_samples: string[];
  enrollment_text: string;
  created_at: string;
  updated_at: string;
}

export async function enrollVoicePrint(
  userId: number,
  name: string,
  enrollmentText: string,
  audioSamples: Blob[]
): Promise<VoiceProfile> {
  // 实现上传逻辑
}

export async function listVoiceProfiles(userId: number): Promise<VoiceProfile[]> {
  // 实现查询逻辑
}

export async function deleteVoiceProfile(profileId: number, userId: number): Promise<void> {
  // 实现删除逻辑
}
```

## 设计风格

采用现代简约风格，与现有设置页面保持一致。使用清晰的视觉层次和直观的交互流程，确保用户能够轻松完成声纹录入。

## 应用类型

Web应用，针对桌面设备优化设计。

## 页面规划

### 1. 设置页面（修改）

在现有设置页面中添加声纹管理区域，位于语速设置区域和退出登录按钮之间。

**区块设计：**

- **顶部导航栏**（已有）：返回按钮 + "设置"标题
- **语速设置区域**（已有）：语速标签 + 滑块 + 预设按钮
- **声纹管理区域**（新增）：
- 标题："声纹管理"
- 声纹档案列表：显示已录入的声纹档案，每个档案包含名称和创建时间，右侧有删除按钮
- "录入新声纹"按钮：点击打开声纹录入抽屉
- **退出登录按钮**（已有）：退出登录按钮 + 确认弹窗

### 2. 声纹录入页面（新增）

采用抽屉式设计，从右侧滑出，覆盖部分设置页面。

**区块设计：**

- **顶部导航栏**（新增）：返回按钮 + "声纹录入"标题 + 步骤指示器
- **引导页面**（新增）：
- 图标：麦克风图标
- 标题："声纹录入引导"
- 说明文本："请按照以下文本朗读3-5次，以提高声纹识别准确度"
- 指定文本："我是{用户名}，这是我的声纹信息"
- "开始录入"按钮
- **录音页面**（新增）：
- 文本显示："请朗读：我是{用户名}，这是我的声纹信息"
- 录音按钮：按住录音，松开停止
- 录制状态：显示录制时间和波形动画
- 进度指示："第 {当前次数} 次，共 {总次数} 次"
- **回放确认页面**（新增）：
- 音频播放器：播放录制的音频
- "确认"按钮：确认使用当前录制
- "重录"按钮：放弃当前录制，重新录制
- **完成页面**（新增）：
- 成功图标
- 标题："录入成功"
- 说明文本："声纹已成功录入，可用于后续对话中的说话人识别"
- "完成"按钮：关闭抽屉，返回设置页面

## 交互设计

- **抽屉式设计**：声纹录入页面采用抽屉式设计，从右侧滑出，不离开设置页面
- **步骤指示器**：在声纹录入页面顶部显示步骤指示器，清晰展示当前进度
- **录音按钮**：参考现有VoiceHoldButton组件，实现按住录音、松开停止的交互
- **波形动画**：录音时显示波形动画，增强视觉反馈
- **回放确认**：录制完成后自动播放回放，用户可确认或重录
- **进度指示**：清晰显示当前录制次数和总次数，帮助用户了解进度

## 响应式设计

- **桌面设备**：抽屉宽度设置为400px，内容区域居中显示
- **移动设备**：抽屉宽度设置为100%，内容区域自适应

## Agent Extensions

### SubAgent

- **code-explorer**
- Purpose: 探索代码库，了解现有实现模式和代码结构
- Expected outcome: 获取现有录音组件、API调用、数据库操作等代码示例，确保新功能与现有代码风格一致