import { useState } from "react";

function AIRecommend() {
  const [foods, setFoods] = useState([]);
  const [mood, setMood] = useState("");

  const getRecommendation = async () => {
    if (!mood) return alert("Please select a mood!");
    try {
      const res = await fetch(`http://localhost:5000/api/ai/recommend/${mood}`);
      const data = await res.json();
      setFoods(data);
    } catch (err) {
      console.error(err);
      alert("Error fetching AI recommendation");
    }
  };

  return (
    <div style={{ padding: "20px" }}>
      <h2>AI Meal Recommendation 🍽️</h2>

      {/* Mood selector */}
      <select value={mood} onChange={(e) => setMood(e.target.value)}>
        <option value="">Select Mood</option>
        <option value="tired">Tired</option>
        <option value="stressed">Stressed</option>
        <option value="happy">Happy</option>
      </select>
      <button onClick={getRecommendation} style={{ marginLeft: "10px" }}>
        Recommend
      </button>

      {/* Display food items */}
      <ul>
        {foods.map((food) => (
          <li key={food.id}>
            <strong>{food.name}</strong> - ${food.price} ({food.tags})
          </li>
        ))}
      </ul>
    </div>
  );
}

export default AIRecommend;
