import { Routes, Route, Navigate } from "react-router-dom";
import { Home } from "./pages/Home";
import { Board } from "./pages/Board";
import { Admin } from "./pages/Admin";
import { Play } from "./pages/Play";

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/board/:code" element={<Board />} />
      <Route path="/admin/:code" element={<Admin />} />
      <Route path="/play/:code" element={<Play />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
