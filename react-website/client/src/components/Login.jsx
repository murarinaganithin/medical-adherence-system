import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Link } from "react-router-dom";
import "./login.css";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3000";

function Login() {
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const navigate = useNavigate();


  const handleLogin = async (e) => {
    e.preventDefault();
    try {
      const response = await fetch(`${API_URL}/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          phone,
          password
        })
      });
      const data = await response.json();
      if (!response.ok) {
        alert(data.message);
        return;
      }
      // Save logged-in user
      localStorage.setItem("user", JSON.stringify(data.user));
      // Go to dashboard
      navigate("/dashboard");
    } catch (error) {
      console.error(error);
      alert("Unable to connect to server");
    }
  };

  return (
    <div className="login-page">
      <div className="login-container">
        <div className="one">
          <h1>
            Welcome back User, Please sign in to your account to continue
          </h1>
        </div>

        <form onSubmit={handleLogin}>
          <h3 id="sing">Sign in with your phone number</h3>

          <input
            className="sec"
            type="tel"
            placeholder="Enter your phone number"
            value={phone}
            onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))}
            maxLength="10"
            required
          />

          <input
            className="thi"
            type="password"
            placeholder="Enter your password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />

          <button type="submit" className="login-btn">Login</button>

          <p>
            Don't have an account?{" "}
            <Link to="/signup">Sign Up</Link>
          </p>
        </form>
      </div>
    </div>
  );
}

export default Login;