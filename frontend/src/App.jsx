import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import LandingPage from "./pages/Landing";
import ReviewPage from "./pages/Review";
import CaseBuilderPage from "./pages/CaseBuilder";
import PlayPage from "./pages/Play";
import LoadingGamePage from "./pages/LoadingGame";
import RouletteCreatePage from "./pages/RouletteCreate";
import RoulettePlayPage from "./pages/RoulettePlay";
import RouletteRoomPage from "./pages/RouletteRoom";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/review" element={<ReviewPage />} />
        <Route path="/me/:sessionId" element={<CaseBuilderPage />} />
        <Route path="/play/:caseId" element={<PlayPage />} />
        <Route path="/loading-game" element={<LoadingGamePage />} />
        <Route path="/roulette" element={<RouletteCreatePage />} />
        <Route path="/roulette/:gameId" element={<RoulettePlayPage />} />
        <Route path="/roulette-room" element={<RouletteRoomPage />} />
        <Route path="/roulette-room/:roomId" element={<RouletteRoomPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
