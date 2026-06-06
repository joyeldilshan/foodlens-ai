import { useState } from 'react'
import reactLogo from './assets/react.svg'
import viteLogo from '/vite.svg'
import './App.css'
import AIRecommend from "./pages/AIRecommend.jsx";

function App() {
   return (
    <div>
      <h1>Welcome to FoodLens AI 🍴</h1>
      <AIRecommend />
    </div>
  );
}

export default App
