---
name: 微信风格聊天底部交互重构 + ASR配置
overview: 重新设计 ChatPage 底部交互栏，参考微信风格：文本输入框内右侧有语音识别图标、支持「按住说话」语音按钮与文字输入切换、上滑取消/滑到转文字区域、点击通话按钮弹出语音/视频通话选项（视频占位）；同时在后端 config.py 中完善阿里 ASR 模型配置。
design:
  architecture:
    framework: react
  styleKeywords:
    - 微信风格
    - 简洁现代
    - 底部交互栏
    - 模式切换
    - 按住说话
    - 上滑取消
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
todos:
  - id: backend-asr-config
    content: 补充后端 ASR 配置（config.py 新增 asr_sample_rate，asr_client.py 改为读取配置，.env.example 同步更新）
    status: completed
  - id: create-toast
    content: 新增 Toast 组件（frontend/src/components/Toast.tsx）
    status: completed
  - id: create-call-options
    content: 新增 CallOptionsPopup 组件（frontend/src/components/CallOptionsPopup.tsx）
    status: completed
  - id: modify-voice-button
    content: 改造 VoiceHoldButton 支持大号样式和上滑取消交互
    status: completed
  - id: refactor-composer
    content: 重构 Composer 组件（文字/语音模式切换 + 输入框内语音图标 + 通话入口 + 上滑取消）
    status: completed
    dependencies:
      - create-toast
      - create-call-options
      - modify-voice-button
  - id: update-chatpage
    content: 调整 ChatPage.tsx（toast 状态管理 + 通话选项弹窗逻辑 + onVoiceStop 逻辑）
    status: completed
    dependencies:
      - refactor-composer
      - create-toast
      - create-call-options
  - id: verify-lint
    content: 检查 lint 错误并修复
    status: completed
    dependencies:
      - update-chatpage
---

## 用户需求

### 1. 增加阿里语音识别模型配置

- 在 `backend/app/config.py` 中新增 `asr_sample_rate` 配置项，替代 `asr_client.py` 中的硬编码 `sample_rate=16000`
- 不需要在前端 Web 页面暴露此配置

### 2. 重新设计聊天页面底部交互（参考微信风格）

- 默认状态（文字模式）：左侧「语音/键盘」切换按钮 + 文字输入框（右侧有语音识别图标 🎤）+ 发送按钮 + 右侧通话按钮
- 语音模式：左侧「语音/键盘」切换按钮 + 居中「按住说话」大按钮 + 右侧通话按钮
- 输入框内语音识别图标：在文本输入框内部的右侧显示 🎤 图标，点击切换到语音模式
- 「按住说话」交互增强：上滑到取消区域取消发送；上滑到「转文字」区域显示提示（本次仅 UI 占位）
- 点击通话按钮（📞）后弹出两个选项：「语音通话」和「视频通话」
- 「语音通话」：导航到 `/call/${sessionId}`（已有实现）
- 「视频通话」：本次仅 UI 占位，点击 toast 提示"视频通话功能暂未实现"

## 核心功能

- 阿里 ASR 模型配置项补充（后端 config.py + asr_client.py）
- 聊天页面底部交互重构：文字/语音模式切换，保留发送按钮
- 文本输入框内右侧增加语音识别图标，点击切换到语音模式
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
- 为 `asr_model` 补充注释说明可选值

#### `backend/app/services/asr_client.py`

- 将 `sample_rate=16000` 硬编码改为 `settings.asr_sample_rate`

#### `backend/.env.example`

- 补充 `ASR_SAMPLE_RATE=16000` 配置项

### 二、前端交互重构

#### 1. 新增 `frontend/src/components/Toast.tsx`

- Props: `message: string`, `visible: boolean`, `onClose: () => void`
- 样式：fixed 底部居中（`bottom-20 left-1/2 -translate-x-1/2`），深色半透明背景 `bg-[#333]/80`，白色文字，px-4 py-2，圆角-lg
- `transition-opacity duration-300` 淡入淡出
- 自动 2 秒后触发 `onClose`
- 使用 `setTimeout` 自动关闭，组件卸载时 `clearTimeout`

#### 2. 新增 `frontend/src/components/CallOptionsPopup.tsx`

- Props: `visible: boolean`, `onClose: () => void`, `onVoiceCall: () => void`, `onVideoCall: () => void`
- 样式：fixed 居中弹出层，白色背景，圆角-lg，shadow-xl，w-64
- 两个选项：「语音通话」（📞 图标，正常样式）、「视频通话」（📹 图标，`opacity-50 cursor-not-allowed`，占位）
- 底部「取消」按钮，点击遮罩层或取消按钮关闭

#### 3. 改造 `frontend/src/components/VoiceHoldButton.tsx`

- 新增 `size?: "sm" | "lg"` prop，默认 `"sm"`
- 新增 `onStop: (action: "send" | "cancel") => void` 回调（替换原来的 `onStop: () => void`）
- `size="sm"`：保持现有样式（w-10 h-10）
- `size="lg"`：
- 高度 h-11，flex-1，居中显示「按住说话」白色文字
- 绿色背景（`bg-[#07c160]`），圆角-full，文字居中
- 按住时背景变红（`bg-[#ff4444]`），scale-105 放大效果
- **上滑取消交互**：
- 使用 `onPointerMove` 监听手指位置
- 计算相对于按钮的 Y 轴偏移，上滑超过阈值（如 -50px）进入取消区域
- 取消区域：按钮上方通过 state 显示一个浮层提示「松开取消」
- 松手时根据最终位置决定：正常发送（`"send"`）或取消发送（`"cancel"`）
- **上滑转文字交互**（本次仅 UI 占位）：
- 继续上滑（超过 -120px）进入「转文字」区域
- 显示「松手转文字」提示浮层
- 松手时触发 `onStop("cancel")`，由 ChatPage 中的回调显示 toast 提示"转文字功能暂未实现"

#### 4. 重构 `frontend/src/components/Composer.tsx`（核心）

- 新增 `mode` state：`"text" | "voice"` 切换输入模式
- 左侧增加切换按钮：
- `mode="text"` 时显示 🎤 图标（点击切换到语音模式）
- `mode="voice"` 时显示 ⌨️ 图标（点击切换到文字模式）
- **输入框内语音识别图标**：
- 在输入框内部右侧增加一个 🎤 图标按钮
- 使用 `relative` 定位输入框，`absolute right-2` 定位图标按钮
- 点击图标：切换到语音模式（`setMode("voice")`）
- `mode="text"` 布局：`[切换按钮 w-10] [输入框 flex-1，右侧有🎤图标] [发送按钮 px-4] [通话按钮 w-10]`
- `mode="voice"` 布局：`[切换按钮 w-10] [按住说话大按钮 flex-1] [通话按钮 w-10]`
- 通话按钮：📞 图标，点击触发 `onCall` 回调（显示 CallOptionsPopup）
- 模式切换时增加 `transition-all duration-200` 平滑过渡
- Props 调整：`onVoiceStop` 改为 `(action: "send" | "cancel") => void`

#### 5. 调整 `frontend/src/pages/ChatPage.tsx`

- 新增 `toastMsg` / `showToast` state 管理 toast 显示
- 新增 `showToastMsg` 函数：设置 toast 消息，2 秒后自动清除
- 新增 `showCallOptions` / `setShowCallOptions` state 管理通话选项弹出层
- 新增 `handleVoiceCall` 函数：关闭弹出层，导航到 `/call/${sessionId}`
- 新增 `handleVideoCall` 函数：关闭弹出层，显示 toast 提示"视频通话功能暂未实现"
- 修改 `onVoiceStop` 函数：
- 接收 `action: "send" | "cancel"` 参数
- `action === "cancel"`：停止录音，不发送，直接返回
- `action === "send"`：正常发送语音（调用原有的 `onVoiceStop` 逻辑）
- `Composer` 的 `onCall` prop 改为调用 `setShowCallOptions(true)`
- 在组件底部渲染 `<Toast>` 和 `<CallOptionsPopup>` 组件

## 目录结构

```
frontend/src/
├── components/
│   ├── Composer.tsx          [MODIFY] 重构底部交互栏，支持文字/语音模式切换，输入框内语音图标
│   ├── VoiceHoldButton.tsx   [MODIFY] 支持大号样式 + 上滑取消/转文字
│   ├── Toast.tsx             [NEW] 简单 toast 提示组件
│   └── CallOptionsPopup.tsx  [NEW] 通话选项弹出层
└── pages/
    └── ChatPage.tsx          [MODIFY] 增加 toast 状态管理，调整 onCall 和 onVoiceStop 逻辑

backend/
├── app/
│   ├── config.py             [MODIFY] 新增 asr_sample_rate 配置项
│   └── services/
│       └── asr_client.py     [MODIFY] sample_rate 改为读取 settings.asr_sample_rate
└── .env.example              [MODIFY] 补充 ASR_SAMPLE_RATE
```

## 性能与可靠性考虑

- Toast 组件使用 `setTimeout` 自动关闭，需在组件卸载时 `clearTimeout`
- 模式切换时，输入框的 `text` state 保持不变，避免用户切换模式时丢失输入
- `VoiceHoldButton` 的 `size="lg"` 样式复用现有动画逻辑，避免重复代码
- `onPointerMove` 事件需要合理处理，避免过于频繁的位置计算影响性能
- 录音取消时，需要正确释放麦克风资源（`stream.getTracks().forEach(t => t.stop())`）

## 设计风格

参考微信聊天页面底部交互设计，采用简洁现代的 UI 风格，实现微信风格的「按住说话」交互体验。

### 整体风格

- 背景色：`#f7f7f7`（底部栏），与微信一致
- 主色调：`#07c160`（微信绿）
- 录音状态：`#ff4444`（红色）
- 边框：`#ddd` 浅灰

### 底部交互栏设计（Composer）

#### 默认状态（文字模式）

- 左侧：🎤 切换按钮（w-10 h-10，圆角-full，hover 时背景变浅灰 `bg-[#e0e0e0]`）
- 中间：输入框（flex-1，h-9，白色背景，圆角-md，focus 时边框变绿 `border-[#07c160]`）
- 输入框内部右侧：🎤 语音识别图标按钮（absolute 定位，`right-2 top-1/2 -translate-y-1/2`，w-7 h-7，rounded-full，hover:bg-[#f0f0f0]）
- 右侧：发送按钮（h-9，px-4，绿色背景 `bg-[#07c160]`，白色文字，圆角-md）
- 最右侧：📞 通话按钮（w-10 h-10，圆角-full，`bg-[#f5f5f5]`）

#### 语音模式

- 左侧：⌨️ 切换按钮（w-10 h-10，圆角-full）
- 中间：「按住说话」大按钮（flex-1，h-11，绿色背景 `#07c160`，白色文字"按住说话"，圆角-full，文字居中，text-[17px] font-medium）
- 按住时：背景变红 `#ff4444`，scale-105 放大效果
- 松开：恢复绿色背景
- 最右侧：📞 通话按钮（w-10 h-10，圆角-full）

#### 上滑取消交互（录音状态时显示浮层）

- 在按钮上方显示一个浮层（absolute 定位，`bottom-full mb-4 left-1/2 -translate-x-1/2`）
- 浮层分为两个区域：
- 上方：「松开取消」区域（红色背景 `#ff4444`，白色文字）
- 下方：「松手转文字」区域（绿色背景 `#07c160`，白色文字，本次仅 UI 占位）
- 手指在取消区域时：浮层高亮「松开取消」区域
- 手指在转文字区域时：浮层高亮「松手转文字」区域
- 浮层使用 `transition-all duration-150` 平滑过渡

#### 模式切换动画

- 使用 `transition-all duration-200` 实现平滑过渡
- 输入框和大按钮之间切换时，使用 `opacity` 和 `transform` 动画

#### 通话选项弹出层（CallOptionsPopup）

- 居中弹出层，白色背景，圆角-lg，shadow-xl，w-64
- 两个选项：语音通话（正常样式）、视频通话（opacity-50 占位）
- 底部取消按钮
- 遮罩层：`bg-black/30`，点击关闭

#### 视频通话按钮

- 样式：w-10 h-10，圆角-full，`bg-[#f5f5f5] opacity-50`
- Hover 时：`opacity-75`（表示可点击但功能未实现）
- 点击：触发 toast 提示

### Toast 组件设计

- 位置：fixed 底部居中（`bottom-20 left-1/2 -translate-x-1/2`）
- 样式：`bg-[#333]/80`，白色文字，px-4 py-2，圆角-lg，`text-[15px]`
- 动画：`opacity` 过渡（`transition-opacity duration-300`）
- 显示时：opacity-100
- 隐藏时：opacity-0 pointer-events-none
- 自动 2 秒后消失

### 响应式设计

- 宽度：max-w-lg mx-auto（与现有聊天页面一致）
- 在移动端和桌面端均能正常显示

## Agent Extensions

### SubAgent

- **code-explorer**
- Purpose: 探索后端代码结构，确认 ASR 相关配置项和 DashScope ASR 模型可选值
- Expected outcome: 获取 `asr_client.py` 完整代码，确认需要补充的配置项