import { Link } from "react-router-dom";
import "./Home.css";

export default function Home() {
  return (
    <div className="home">
      <h1>🍔 FoodLens AI</h1>
      <p>AI-powered food recommendations based on your mood</p>

      <div className="buttons">
        <Link to="/login">Login</Link>
        <Link to="/register">Register</Link>
      </div>
    </div>
  );
}
