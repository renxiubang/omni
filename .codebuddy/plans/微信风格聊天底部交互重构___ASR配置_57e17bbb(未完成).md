---
name: 微信风格聊天底部交互重构 + ASR配置
overview: 重新设计 ChatPage 底部交互栏，参考微信风格：支持「按住说话」语音按钮与文字输入切换、增加视频通话入口（UI占位）；同时在后端 config.py 中完善阿里 ASR 模型配置。
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
    - Toast 提示
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
      - "#333333"
    text:
      - "#111111"
      - "#ffffff"
    functional:
      - "#07c160"
      - "#ff4444"
      - "#dddddd"
      - "#ff4444"
todos:
  - id: backend-asr-config
    content: 补充后端 ASR 配置说明（config.py + .env.example）
    status: pending
  - id: create-toast
    content: 新增 Toast 组件（frontend/src/components/Toast.tsx）
    status: pending
  - id: modify-voice-button
    content: 改造 VoiceHoldButton 支持大号样式（size prop）
    status: pending
  - id: refactor-composer
    content: 重构 Composer 组件（文字/语音模式切换 + 视频通话入口）
    status: pending
    dependencies:
      - create-toast
      - modify-voice-button
  - id: update-chatpage
    content: 调整 ChatPage.tsx（toast 状态管理 + onCall 逻辑）
    status: pending
    dependencies:
      - refactor-composer
  - id: verify-lint
    content: 检查 lint 错误并修复
    status: pending
    dependencies:
      - update-chatpage
---

## 用户需求

### 1. 增加阿里语音识别模型配置

- 在 `backend/app/config.py` 中补充阿里 ASR 相关配置参数
- 不需要在前端 Web 页面暴露此配置
- 当前已有 `asr_model = "paraformer-v2"` 配置项，需补充注释说明可选值

### 2. 重新设计聊天页面底部交互（参考微信）

- 默认状态：左侧「语音/键盘」切换按钮 + 文字输入框 + 右侧视频通话入口
- 语音模式：点击切换按钮后，输入框替换为居中的「按住说话」大按钮
- 增加视频通话入口按钮（UI 占位，本次不做具体实现）

### 3. 视频通话入口

- 在底部栏增加视频通话图标按钮
- 本次仅做 UI 占位，不实现具体逻辑
- 点击可显示 toast 提示"视频通话功能暂未实现"

## 核心功能

- 阿里 ASR 模型配置项补充（后端 config.py）
- 聊天页面底部交互重构：文字/语音模式切换
- 微信风格「按住说话」按钮（大号样式）
- 视频通话入口 UI 占位 + toast 提示

## 技术栈

- 前端：React + TypeScript + Tailwind CSS（现有栈）
- 后端：Python + FastAPI + Pydantic Settings（现有栈）

## 实施方案

### 后端改动

#### `backend/app/config.py`

- 为 `asr_model` 补充注释，说明可选值（如 `paraformer-v2`, `paraformer-realtime-v2` 等阿里 ASR 模型）
- 可选：增加 `asr_sample_rate: int = 16000` 配置项（当前硬编码在 `asr_client.py` 中）
- 可选：增加 `asr_language: str = "zh"` 配置项

#### `backend/.env.example`

- 补充 `ASR_MODEL` 的可选值说明

#### `backend/app/services/asr_client.py`

- 如增加了 `asr_sample_rate` 配置项，将硬编码的 `sample_rate=16000` 改为 `settings.asr_sample_rate`

### 前端改动

#### 新增 `frontend/src/components/Toast.tsx`

- 简单 toast 提示组件
- Props: `message: string`, `visible: boolean`, `onClose: () => void`
- 样式：fixed 底部居中，深色半透明背景，白色文字，圆角，`px-4 py-2`
- 自动 2 秒后触发 `onClose`
- 使用 `transition-opacity duration-300` 实现淡入淡出

#### 改造 `frontend/src/components/VoiceHoldButton.tsx`

- 增加 `size?: "sm" | "lg"` prop，默认 `"sm"`
- `size="sm"`：保持现有样式（w-10 h-10）
- `size="lg"`：
- 高度 h-11，flex-1，居中显示
- 绿色背景（`bg-[#07c160]`），白色文字"按住说话"
- 按住时背景变红（`bg-[#ff4444]`），显示录音动画
- 增加 `scale` 动画效果

#### 重构 `frontend/src/components/Composer.tsx`（核心）

- 新增 `mode` state：`"text" | "voice"` 切换输入模式
- 左侧增加切换按钮：
- `mode="text"` 时显示 🎤 图标（点击切换到语音模式）
- `mode="voice"` 时显示 ⌨️ 图标（点击切换到文字模式）
- `mode="text"` 布局：`[切换按钮] [输入框 flex-1] [发送按钮] [视频通话按钮]`
- `mode="voice"` 布局：`[切换按钮] [按住说话大按钮 flex-1] [视频通话按钮]`
- 视频通话按钮：📹 图标，半透明样式（表示未启用），点击触发 `onCall` 回调
- 模式切换时增加 `transition-all duration-200` 平滑过渡

#### 调整 `frontend/src/pages/ChatPage.tsx`

- 新增 `toastMsg` / `showToast` state 管理 toast 显示
- 新增 `handleCall` 函数：设置 toast 消息，2 秒后自动清除
- `Composer` 的 `onCall` prop 改为调用 `handleCall`
- 在组件底部渲染 `Toast` 组件

## 目录结构

```
frontend/src/
├── components/
│   ├── Composer.tsx          [MODIFY] 重构底部交互栏，支持文字/语音模式切换
│   ├── VoiceHoldButton.tsx   [MODIFY] 支持大号样式（size prop）
│   └── Toast.tsx             [NEW] 简单 toast 提示组件
└── pages/
    └── ChatPage.tsx          [MODIFY] 增加 toast 状态管理，调整 onCall 逻辑

backend/
├── app/
│   ├── config.py             [MODIFY] 补充 ASR 配置项注释，可选增加 asr_sample_rate
│   └── services/
│       └── asr_client.py     [MODIFY] 如 config 增加 asr_sample_rate，同步修改
└── .env.example              [MODIFY] 补充 ASR_MODEL 可选值说明
```

## 关键代码结构设计

### Composer Props

```typescript
interface Props {
  disabled?: boolean;
  isRecording: boolean;
  onSendText: (text: string) => void;
  onVoiceStart: () => void;
  onVoiceStop: () => void;
  onCall: () => void;  // 视频通话入口点击回调
}
```

### Composer 内部 State

```typescript
const [mode, setMode] = useState<"text" | "voice">("text");
const [text, setText] = useState("");
```

### Toast Props

```typescript
interface ToastProps {
  message: string;
  visible: boolean;
  onClose: () => void;
}
```

## 性能与可靠性考虑

- Toast 组件使用 `setTimeout` 自动关闭，需在组件卸载时 `clearTimeout`
- 模式切换时，输入框的 `text` state 保持不变，避免用户切换模式时丢失输入
- `VoiceHoldButton` 的 `size="lg"` 样式复用现有动画逻辑，避免重复代码

## 设计风格

参考微信聊天页面底部交互设计，采用简洁现代的 UI 风格。

### 整体风格

- 背景色：`#f7f7f7`（底部栏），与微信一致
- 主色调：`#07c160`（微信绿）
- 录音状态：`#ff4444`（红色）
- 边框：`#ddd` 浅灰

### 底部交互栏设计（Composer）

#### 默认状态（文字模式）

- 左侧：🎤 切换按钮（w-10 h-10，圆角-full，hover 时背景变浅灰）
- 中间：输入框（flex-1，h-9，白色背景，圆角-md，focus 时边框变绿）
- 右侧：发送按钮（h-9，px-4，绿色背景，白色文字，圆角-md）
- 最右侧：📹 视频通话按钮（w-10 h-10，圆角-full，opacity-50 表示未启用）

#### 语音模式

- 左侧：⌨️ 切换按钮（w-10 h-10，圆角-full）
- 中间：「按住说话」大按钮（flex-1，h-11，绿色背景 `#07c160`，白色文字"按住说话"，圆角-full，文字居中）
- 按住时：背景变红 `#ff4444`，显示录音动画（scale 放大 + pulse effect）
- 松开：恢复绿色背景
- 最右侧：📹 视频通话按钮（w-10 h-10，圆角-full，opacity-50）

#### 模式切换动画

- 使用 `transition-all duration-200` 实现平滑过渡
- 输入框和大按钮之间切换时，使用 `opacity` 和 `transform` 动画

#### 视频通话按钮

- 样式：w-10 h-10，圆角-full，bg-[#f5f5f5]，opacity-50
- Hover 时：opacity-75（表示可点击但功能未实现）
- 点击：触发 toast 提示

### Toast 组件设计

- 位置：fixed 底部居中（`bottom-20 left-1/2 -translate-x-1/2`）
- 样式：bg-[#333]/80，白色文字，px-4 py-2，圆角-lg
- 动画：`opacity` 过渡（`transition-opacity duration-300`）
- 显示时：opacity-100
- 隐藏时：opacity-0
- 自动 2 秒后消失

### 响应式设计

- 宽度：max-w-lg mx-auto（与现有聊天页面一致）
- 在移动端和桌面端均能正常显示

## Agent Extensions

### SubAgent

- **code-explorer**
- Purpose: 探索后端代码结构，确认 ASR 相关配置项和 DashScope ASR 模型可选值
- Expected outcome: 获取 `asr_client.py` 完整代码，确认需要补充的配置项