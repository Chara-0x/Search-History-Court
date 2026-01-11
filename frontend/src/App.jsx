import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import LandingPage from "./pages/Landing";
import ReviewPage from "./pages/Review";
import CaseBuilderPage from "./pages/CaseBuilder";
import PlayPage from "./pages/Play";
import LoadingGamePage from "./pages/LoadingGame";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/review" element={<ReviewPage />} />
        <Route path="/me/:sessionId" element={<CaseBuilderPage />} />
        <Route path="/play/:caseId" element={<PlayPage />} />
        <Route path="/loading-game" element={<LoadingGamePage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
