import { NavLink, Route, Routes } from "react-router-dom";
import { QueryPage } from "./pages/QueryPage";
import { StatusPage } from "./pages/StatusPage";
import { NodesPage } from "./pages/NodesPage";
import { QueuesPage } from "./pages/QueuesPage";

export function App() {
  return (
    <div className="app">
      <header>
        <h1>Plex Director</h1>
        <nav>
          <NavLink to="/" end>
            Query
          </NavLink>
          <NavLink to="/status">Server Status</NavLink>
          <NavLink to="/nodes">Node Utilization</NavLink>
          <NavLink to="/queues">Queues</NavLink>
        </nav>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<QueryPage />} />
          <Route path="/status" element={<StatusPage />} />
          <Route path="/nodes" element={<NodesPage />} />
          <Route path="/queues" element={<QueuesPage />} />
        </Routes>
      </main>
    </div>
  );
}
