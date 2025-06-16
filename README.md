# Traffic Dashboard

**Live Demo:** [traffic-dashboard-one.vercel.app](https://traffic-dashboard-one.vercel.app)

A web application for visualizing traffic sensor data, making traffic predictions, and analyzing potential route congestion.  
This project combines a React frontend with a Python FastAPI backend, integrating with a traffic sensor database and leveraging AI for speed predictions.

---

## Features

- **Interactive Map:**  
  Visualize traffic sensors on a Google Map, color-coded by congestion.
- **Sensor Data:**  
  Click on any sensor to view its current speed, speed limit, and recent trends.
- **AI Predictions:**  
  Get predicted traffic speeds for the next 15 minutes at any selected sensor.
- **Historical Data:**  
  View historical speed charts for individual sensors.
- **Route Analysis:**  
  Enter an origin and destination to calculate a route and analyze congestion along the way.
- **Heatmap Layer:**  
  Visualize congestion hotspots using a heatmap overlay.

---

## Tech Stack

- **Frontend:** React (Create React App), Google Maps JavaScript API, Axios
- **Backend:** FastAPI (Python), MongoDB, Scikit-learn (or similar) for ML predictions
- **Deployment:** [Vercel](https://traffic-dashboard-one.vercel.app) (frontend)

---

## Getting Started

### Prerequisites

- Node.js & npm (for frontend)
- Python 3.8+ (for backend)
- Access to a MongoDB instance
- Google Maps API Key

### Frontend Setup

```bash
cd traffic-frontend
npm install
npm start
```

- Runs on [http://localhost:3000](http://localhost:3000)
- Configure the Google Maps API key and backend URL in your environment or as needed.

### Backend Setup

```bash
cd traffic_api
pip install -r requirements.txt
uvicorn main:app --reload
```

- Make sure to set up environment variables or configuration for MongoDB connection.
- The backend exposes API endpoints under `/api/`.

---

## Key API Endpoints

- `GET /api/sensors_in_view`  
  Returns sensors within a bounding box of the map view.
- `GET /api/sensor_prediction/{detid}`  
  Predicts the next speed for a sensor using an AI model.
- `GET /api/sensor_history/{detid}`  
  Returns historical speed data for a sensor.
- `POST /api/route_traffic_analysis`  
  Analyzes congestion along a custom route.

---

## Project Structure

```
traffic-dashboard/
├── traffic-frontend/   # React frontend
│   └── src/
│       └── App.js      # Main application logic
├── traffic_api/        # FastAPI backend
│   └── main.py         # API endpoints & ML predictions
└── README.md           # (You are here)
```

---

