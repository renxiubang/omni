---
name: 微信风格聊天底部交互重构 + ASR配置
overview: 重新设计 ChatPage 底部交互栏，参考微信风格：支持「按住说话」语音按钮与文字输入切换、上滑取消/滑到转文字区域、点击通话按钮弹出语音/视频通话选项（视频占位）；同时在后端 config.py 中完善阿里 ASR 模型配置。
design:
  architecture:
    framework: react
    component: shadcn
  styleKeywords:
    - 微信风格
    - 简洁现代
    - 底部交互栏
    - 模式切换
    - 按住说话
    - 上滑取消
  fontSystem:
    fontFamily: PingFang SC
    heading:
      size: 17px
      weight: 600
    subheading:
      size: 15px
      weight: 500
    body:
      size: 15px
      weight: 400
  colorSystem:
    primary:
      - "#07c160"
      - "#ff4444"
    background:
      - "#f7f7f7"
      - "#ffffff"
    text:
      - "#111111"
      - "#ffffff"
    functional:
      - "#07c160"
      - "#ff4444"
      - "#dddddd"
todos:
  - id: backend-asr-config
    content: 补充后端 ASR 配置（config.py 新增 asr_sample_rate，asr_client.py 改为读取配置，.env.example 同步更新）
    status: pending
  - id: create-toast
    content: 新增 Toast 组件（frontend/src/components/Toast.tsx）
    status: pending
  - id: create-call-options
    content: 新增 CallOptionsPopup 组件（frontend/src/components/CallOptionsPopup.tsx）
    status: pending
  - id: modify-voice-button
    content: 改造 VoiceHoldButton 支持大号样式和上滑取消交互
    status: pending
  - id: refactor-composer
    content: 重构 Composer 组件（文字/语音模式切换 + 通话入口 + 上滑取消）
    status: pending
    dependencies:
      - create-toast
      - create-call-options
      - modify-voice-button
  - id: update-chatpage
    content: 调整 ChatPage.tsx（toast 状态管理 + 通话选项弹窗逻辑 + onVoiceStop 逻辑）
    status: pending
    dependencies:
      - refactor-composer
      - create-toast
      - create-call-options
  - id: verify-lint
    content: 检查 lint 错误并修复
    status: pending
    dependencies:
      - update-chatpage
---

## 用户需求

### 1. 增加阿里语音识别模型配置

- 在 `backend/app/config.py` 中新增 `asr_sample_rate` 配置项，替代 `asr_client.py` 中的硬编码 `sample_rate=16000`
- 不需要在前端 Web 页面暴露此配置

### 2. 重新设计聊天页面底部交互（参考微信风格）

- 默认状态（文字模式）：左侧「语音/键盘」切换按钮 + 文字输入框 + 发送按钮 + 右侧通话按钮
- 语音模式：左侧「语音/键盘」切换按钮 + 居中「按住说话」大按钮 + 右侧通话按钮
- 「按住说话」交互增强：上滑到取消区域取消发送；上滑到「转文字」区域显示提示（本次仅 UI 占位）
- 点击通话按钮（📞）后弹出两个选项：「语音通话」和「视频通话」
- 「语音通话」：导航到 `/call/${sessionId}`（已有实现）
- 「视频通话」：本次仅 UI 占位，点击 toast 提示"视频通话功能暂未实现"

## 核心功能

- 阿里 ASR 模型配置项补充（后端 config.py + asr_client.py）
- 聊天页面底部交互重构：文字/语音模式切换，保留发送按钮
- 微信风格「按住说话」按钮（大号样式）+ 上滑取消/转文字交互
- 点击通话按钮弹出「语音通话」和「视频通话」选项
- Toast 提示组件（用于视频通话占位提示）

## 技术栈

- 前端：React + TypeScript + Tailwind CSS（现有栈）
- 后端：Python + FastAPI + Pydantic Settings（现有栈）

## 实施方案

### 一、后端 ASR 配置完善

#### `backend/app/config.py`

- 新增 `asr_sample_rate: int = 16000` 配置项

#### `backend/app/services/asr_client.py`

- 将 `sample_rate=16000` 硬编码改为 `settings.asr_sample_rate`

#### `backend/.env.example`

- 补充 `ASR_SAMPLE_RATE=16000` 配置项

### 二、前端交互重构

#### 1. 新增 `frontend/src/components/Toast.tsx`

- Props: `message: string`, `visible: boolean`, `onClose: () => void`
- 样式：fixed 底部居中，深色半透明背景，白色文字，圆角-lg
- 自动 2 秒后触发 `onClose`，组件卸载时 `clearTimeout`

#### 2. 新增 `frontend/src/components/CallOptionsPopup.tsx`

- Props: `visible: boolean`, `onClose: () => void`, `onVoiceCall: () => void`, `onVideoCall: () => void`
- 样式：fixed 居中弹出层，白色背景，圆角-lg，shadow-xl，w-64
- 两个选项：「语音通话」（正常样式）、「视频通话」（opacity-50 占位）
- 底部「取消」按钮，点击遮罩层关闭

#### 3. 改造 `frontend/src/components/VoiceHoldButton.tsx`

- 新增 `size?: "sm" | "lg"` prop，默认 `"sm"`
- 新增 `onStop: (action: "send" | "cancel") => void` 回调
- `size="lg"`：高度 h-11，flex-1，居中显示「按住说话」白色文字
- 上滑取消交互：通过 `onPointerMove` 检测手指位置，松手时根据位置决定 send/cancel

#### 4. 重构 `frontend/src/components/Composer.tsx`

- 新增 `mode` state：`"text" | "voice"` 切换输入模式
- 左侧「🎤/⌨️」切换按钮
- `mode="text"` 布局：`[切换按钮] [输入框 flex-1] [发送按钮] [通话按钮]`
- `mode="voice"` 布局：`[切换按钮] [按住说话大按钮 flex-1] [通话按钮]`
- 通话按钮点击触发 `onCall` 回调（显示 CallOptionsPopup）

#### 5. 调整 `frontend/src/pages/ChatPage.tsx`

- 新增 `toastMsg` / `showToast` state 管理 toast 显示
- 新增 `showCallOptions` state 管理通话选项弹出层
- `Composer` 的 `onCall` 改为调用 `setShowCallOptions(true)`
- 在组件底部渲染 `<Toast>` 和 `<CallOptionsPopup>` 组件

## 目录结构

```
frontend/src/
├── components/
│   ├── Composer.tsx          [MODIFY] 重构底部交互栏
│   ├── VoiceHoldButton.tsx   [MODIFY] 支持大号样式 + 上滑取消
│   ├── Toast.tsx             [NEW] Toast 提示组件
│   └── CallOptionsPopup.tsx  [NEW] 通话选项弹出层
└── pages/
    └── ChatPage.tsx          [MODIFY] 增加 toast/弹窗状态管理

backend/
├── app/
│   ├── config.py             [MODIFY] 新增 asr_sample_rate
│   └── services/
│       └── asr_client.py     [MODIFY] sample_rate 改为读取配置
└── .env.example              [MODIFY] 补充 ASR_SAMPLE_RATE
```

## 设计风格

参考微信聊天页面底部交互设计，采用简洁现代的 UI 风格。

### 整体风格

- 背景色：`#f7f7f7`（底部栏）
- 主色调：`#07c160`（微信绿）
- 录音状态：`#ff4444`（红色）

### 底部交互栏设计（Composer）

#### 默认状态（文字模式）

- 左侧：🎤 切换按钮（w-10 h-10，圆角-full，hover 时背景变浅灰）
- 中间：输入框（flex-1，h-9，白色背景，圆角-md，focus 时边框变绿）
- 右侧：发送按钮（h-9，px-4，绿色背景，白色文字，圆角-md）
- 最右侧：📞 通话按钮（w-10 h-10，圆角-full，bg-[#f5f5f5]）

#### 语音模式

- 左侧：⌨️ 切换按钮（w-10 h-10，圆角-full）
- 中间：「按住说话」大按钮（flex-1，h-11，绿色背景，白色文字，圆角-full，文字居中）
- 按住时：背景变红 `#ff4444`，scale-105 放大效果
- 最右侧：📞 通话按钮

#### 通话选项弹出层（CallOptionsPopup）

- 居中弹出层，白色背景，圆角-lg，shadow-xl，w-64
- 两个选项：语音通话（正常）、视频通话（opacity-50 占位）
- 底部取消按钮

#### Toast 组件设计

- 位置：fixed 底部居中
- 样式：bg-[#333]/80，白色文字，px-4 py-2，圆角-lg
- 自动 2 秒后消失

## Agent Extensions

### SubAgent

- **code-explorer**
- Purpose: 探索后端代码结构，确认 ASR 相关配置项
- Expected outcome: 获取 `asr_client.py` 完整代码，确认需要修改的位置