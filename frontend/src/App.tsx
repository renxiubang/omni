import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { CallScreen } from "./components/CallScreen";
import { ChatPage } from "./pages/ChatPage";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<ChatPage />} />
        <Route path="/call/:sessionId" element={<CallScreen />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
