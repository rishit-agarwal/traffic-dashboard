# --- main.py (FastAPI version) ---
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pymongo import MongoClient, GEOSPHERE, ASCENDING
import joblib
import pandas as pd
from datetime import datetime, timedelta # Ensure datetime is imported from datetime
from typing import List, Dict, Any, Optional # For type hinting
from pydantic import BaseModel # For request/response models (optional but good practice)
import os
from dotenv import load_dotenv # For loading environment variables
load_dotenv() # Load environment variables from .env file
from contextlib import asynccontextmanager
import polyline # Add this import

print("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!")
print("!!!!!!!!!!!! RUNNING THE LATEST VERSION OF MAIN.PY !!!!!!!!!!!!")
print(f"!!!!!!!!!!!! Version Timestamp: {datetime.now()} !!!!!!!!!!!!")
print("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!")

# --- Configuration ---
BASE_DIR = os.path.abspath(os.path.dirname(__file__))
MODEL_PATH = os.path.join(BASE_DIR, "traffic_speed_predictor_xgb.joblib")

MONGO_ATLAS_CONNECTION_STRING = os.getenv("MONGO_ATLAS_CONNECTION_STRING")
DATABASE_NAME = "manchester_traffic"
COLLECTION_NAME = "traffic_readings" # This collection will be used for historical data too

# --- FastAPI App Initialization ---
app = FastAPI(
    title="Manchester Traffic Prediction API",
    description="API to get traffic sensor data, speed predictions, and historical data for Manchester.",
    version="1.0.1" # Incremented version
)

# --- CORS (Cross-Origin Resource Sharing) ---
origins = [
    "http://localhost:3000",
    "http://127.0.0.1:3000"  # Default React dev port
    # Add your deployed frontend URL here
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Global Variables & Lifespan Events for Resource Management ---
# Using FastAPI's lifespan context manager for cleaner startup/shutdown
model_resource = {} # To store loaded model
db_resource = {}    # To store DB connection

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Load the ML model and DB connection on startup
    print("Lifespan event: Loading XGBoost model...")
    try:
        model_resource["model"] = joblib.load(MODEL_PATH)
        print("Model loaded successfully.")
    except Exception as e:
        print(f"FATAL: Error loading model: {e}")
        model_resource["model"] = None # Ensure it's None if loading fails

    print("Lifespan event: Connecting to MongoDB...")
    try:
        db_resource["client"] = MongoClient(MONGO_ATLAS_CONNECTION_STRING)
        db_resource["client"].admin.command('ping') # Verify connection
        db_resource["db"] = db_resource["client"][DATABASE_NAME]
        db_resource["collection"] = db_resource["db"][COLLECTION_NAME]
        # Ensure indexes for historical queries if not already present
        # db_resource["collection"].create_index([("detid", 1), ("timestamp", -1)])
        print("MongoDB connection successful.")
    except Exception as e:
        print(f"FATAL: Error connecting to MongoDB: {e}")
        # Clear db resources if connection failed
        db_resource.clear()
    
    yield # Application runs here

    # Clean up resources on shutdown
    if db_resource.get("client"):
        db_resource["client"].close()
        print("Lifespan event: MongoDB connection closed.")

app.router.lifespan_context = lifespan # Assign the lifespan manager

# --- Helper function to prepare features for prediction (same as before) ---
def prepare_features_for_sensor(sensor_data_list: List[Dict[str, Any]], current_dt: datetime) -> pd.DataFrame:
    if not sensor_data_list:
        return pd.DataFrame()

    df_sensor = pd.DataFrame(sensor_data_list)
    df_sensor['timestamp'] = pd.to_datetime(df_sensor['timestamp'])
    df_sensor.sort_values('timestamp', ascending=False, inplace=True)

    latest_readings = df_sensor.head(3)
    if len(latest_readings) < 3:
        print("Warning: Not enough historical data for all lags for prediction.")
        # Fallback: use 0 for missing lags if you want to proceed, or return empty to signal error
        # For now, returning empty as it's safer if model expects all lags.
        return pd.DataFrame()


    features_for_prediction = {
        'hour_of_day': current_dt.hour,
        'day_of_week': current_dt.weekday(),
        'is_weekend': 1 if current_dt.weekday() >= 5 else 0,
        'speed_lag1': latest_readings.iloc[0]['speed'] if len(latest_readings) >= 1 and 'speed' in latest_readings.iloc[0] else 0,
        'speed_lag2': latest_readings.iloc[1]['speed'] if len(latest_readings) >= 2 and 'speed' in latest_readings.iloc[1] else 0,
        'speed_lag3': latest_readings.iloc[2]['speed'] if len(latest_readings) >= 3 and 'speed' in latest_readings.iloc[2] else 0,
        'flow_lag1': latest_readings.iloc[0]['flow'] if len(latest_readings) >= 1 and 'flow' in latest_readings.iloc[0] else 0,
        'speed_limit': latest_readings.iloc[0].get('speed_limit', 50), # Assuming 50 as a default if not present
        'occupancy': latest_readings.iloc[0].get('occupancy', 0),
        'flow': latest_readings.iloc[0].get('flow', 0)
    }
    
    feature_order = ['hour_of_day', 'day_of_week', 'is_weekend',
                     'speed_lag1', 'speed_lag2', 'speed_lag3', 'flow_lag1', 
                     'speed_limit', 'occupancy', 'flow']
    
    return pd.DataFrame([features_for_prediction])[feature_order]
# --- main.py (continued) ---
class SensorData(BaseModel):
    detid: str
    lat: float
    lon: float
    current_speed: Optional[float] = None
    current_flow: Optional[int] = None
    road_name: Optional[str] = None
    speed_limit: Optional[int] = None
    last_updated: Optional[datetime] = None

class HistoricalSpeedPoint(BaseModel):
    timestamp: datetime # Pydantic will parse ISO string to datetime
    speed: Optional[float] = None

class SensorPredictionResponse(BaseModel):
    detid: str
    predicted_speed_for_next_interval: float
    prediction_target_time: datetime
    historical_speeds: List[HistoricalSpeedPoint] # This was already here, good!

# New Pydantic model for the historical data endpoint response
class SensorHistoryResponse(BaseModel):
    detid: str
    readings: List[HistoricalSpeedPoint]

class RouteAnalysisRequest(BaseModel):
    overview_polyline: str # Encoded polyline from Google Directions

class RouteTrafficAnalysisResponse(BaseModel):
    condition: str # e.g., "Light", "Moderate", "Heavy"
    average_congestion_ratio: Optional[float] = None # (current_speed / speed_limit)
    sensors_considered: int = 0
    sensors_with_data: int = 0

# --- API Endpoints ---

@app.get("/api/sensors_in_view", response_model=List[SensorData])
async def get_sensors_in_view(
    min_lon: float = Query(..., description="Minimum longitude of bounding box"),
    min_lat: float = Query(..., description="Minimum latitude of bounding box"),
    max_lon: float = Query(..., description="Maximum longitude of bounding box"),
    max_lat: float = Query(..., description="Maximum latitude of bounding box")
):
    traffic_collection = db_resource.get("collection")
    if traffic_collection is None:
        raise HTTPException(status_code=503, detail="Traffic collection not available.")
    
    bbox_query = {
        "location": {
            "$geoWithin": {
                "$box": [
                    [min_lon, min_lat],
                    [max_lon, max_lat]
                ]
            }
        }
    }
    
    sensors_output = []
    try:
        pipeline = [
            {"$match": bbox_query},
            {"$sort": {"timestamp": -1}},
            {"$group": {
                "_id": "$detid",
                "latest_doc": {"$first": "$$ROOT"}
            }},
            {"$replaceRoot": {"newRoot": "$latest_doc"}},
            {"$limit": 200} 
        ]
        latest_docs_cursor = traffic_collection.aggregate(pipeline)

        for doc in latest_docs_cursor:
            road_name_val = doc.get("road_name")
            if pd.isna(road_name_val): # Check if it's pandas NaN or Python None
                road_name_val = None    # Pydantic Optional[str] handles None gracefully

            current_speed_val = doc.get("speed")
            if pd.isna(current_speed_val):
                current_speed_val = None
            
            current_flow_val = doc.get("flow")
            if pd.isna(current_flow_val):
                current_flow_val = None
            
            speed_limit_val = doc.get("speed_limit")
            if pd.isna(speed_limit_val):
                speed_limit_val = None
            
            last_updated_val = doc.get("timestamp")
            if pd.isna(last_updated_val): # Though timestamp should ideally always exist
                last_updated_val = None
            sensors_output.append(SensorData(
                detid=doc.get("detid", "Unknown detid"), # Add defaults for safety
                lat=doc.get("location", {}).get("coordinates", [0,0])[1], # Safer access
                lon=doc.get("location", {}).get("coordinates", [0,0])[0], # Safer access
                current_speed=current_speed_val,
                current_flow=current_flow_val,
                road_name=road_name_val,
                speed_limit= speed_limit_val,
                last_updated= last_updated_val
            ))
        return sensors_output
    except HTTPException: # Re-raise HTTPExceptions so FastAPI handles them
        raise
    except Exception as e: # <--- CATCH THE EXCEPTION
        print(f"!!!!!!!!!!!!!!!!! UNHANDLED ERROR IN /api/sensors_in_view !!!!!!!!!!!!!!!!!")
        import traceback
        traceback.print_exc() # This will print the full traceback to your Uvicorn terminal
        # You can re-raise an HTTPException to send a structured error to the client
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

# --- main.py (continued) ---
# In your main.py

@app.get("/api/sensor_prediction/{detid_val}", response_model=SensorPredictionResponse)
async def get_sensor_prediction(detid_val: str):
    model = model_resource.get("model")
    traffic_collection = db_resource.get("collection")
    if traffic_collection is None:
        raise HTTPException(status_code=503, detail="Traffic collection not available.")
    if not model:
        raise HTTPException(status_code=503, detail="AI Model not available.")
    

    try: # <--- ADD TRY BLOCK HERE
        latest_sensor_doc = traffic_collection.find_one({"detid": detid_val}, sort=[("timestamp", -1)])
        if not latest_sensor_doc or not latest_sensor_doc.get("timestamp"):
            raise HTTPException(status_code=404, detail=f"No recent data for sensor {detid_val}.")
        
        prediction_target_time = latest_sensor_doc["timestamp"] + timedelta(minutes=15)

        historical_cursor = traffic_collection.find(
            {"detid": detid_val}
        ).sort("timestamp", -1).limit(5)
        historical_data_list = list(historical_cursor)
        
        if len(historical_data_list) < 3:
             raise HTTPException(status_code=404, detail=f"Not enough historical data for {detid_val}.")

        features_df = prepare_features_for_sensor(historical_data_list, prediction_target_time)
        if features_df.empty:
            # This is a likely place for an error if prepare_features_for_sensor has issues
            print(f"DEBUG: features_df is empty for detid {detid_val}")
            raise HTTPException(status_code=500, detail=f"Could not prepare features for {detid_val}.")
            
        predicted_speed_array = model.predict(features_df)
        predicted_speed = round(float(predicted_speed_array[0]), 2)

        historical_data_for_chart = sorted(
            [HistoricalSpeedPoint(timestamp=doc["timestamp"], speed=doc.get("speed"))
             for doc in historical_data_list if doc.get("speed") is not None and doc.get("timestamp") is not None],
            key=lambda x: x.timestamp
        )

        return SensorPredictionResponse(
            detid=detid_val,
            predicted_speed_for_next_interval=predicted_speed,
            prediction_target_time=prediction_target_time,
            historical_speeds=historical_data_for_chart
        )
    except HTTPException: # Re-raise HTTPExceptions so FastAPI handles them
        raise
    except Exception as e: # <--- CATCH OTHER UNEXPECTED EXCEPTIONS
        print(f"!!!!!!!!!!!!!!!!! ERROR IN /api/sensor_prediction/{detid_val} !!!!!!!!!!!!!!!!!")
        import traceback
        traceback.print_exc() # This will print the full traceback
        raise HTTPException(status_code=500, detail=f"Internal server error processing prediction: {str(e)}")


# --- NEW ENDPOINT FOR HISTORICAL DATA ---
@app.get("/api/sensor_history/{detid_val}", response_model=SensorHistoryResponse)
async def get_sensor_historical_data(
    detid_val: str,
    # The 'hours' param is currently unused due to hardcoded 2017 range
    hours: int = Query(24, ge=1, le=(365 * 24 * 10), description="Number of past hours of data to retrieve")
):
    """
    Retrieves historical speed readings for a given sensor ID,
    aggregated into 10-minute intervals.
    FOR DEMO PURPOSES WITH OLD DATASET, THIS IS HARDCODED TO SEPTEMBER 2017.
    """
    traffic_collection = db_resource.get("collection")
    if traffic_collection is None:
        raise HTTPException(status_code=503, detail="Traffic collection not available for historical data.")

    try:
        # Hardcoded date range for September 2017
        query_start_time = datetime(2017, 9, 1, 0, 0, 0)
        query_end_time = datetime(2017, 9, 30, 23, 59, 59)
        print(f"DEBUG: Hardcoded query range for historical data: {query_start_time} to {query_end_time}")
    except Exception as e:
        print(f"Error creating hardcoded dates: {e}")
        raise HTTPException(status_code=500, detail="Internal error setting date range.")

    try:
        # MongoDB Aggregation Pipeline
        pipeline = [
            {
                "$match": {
                    "detid": detid_val,
                    "timestamp": {
                        "$gte": query_start_time,
                        "$lte": query_end_time
                    },
                    "speed": {"$ne": None}
                }
            },
            {
                "$project": { # Project to ensure timestamp is a date and speed is numeric
                    "timestamp": "$timestamp", # Assuming it's already a BSON date
                    "speed": "$speed", # Assuming it's already numeric
                    "year": {"$year": "$timestamp"},
                    "month": {"$month": "$timestamp"},
                    "day": {"$dayOfMonth": "$timestamp"},
                    "hour": {"$hour": "$timestamp"},
                    "minute": {"$minute": "$timestamp"}
                }
            },
            {
                "$group": {
                    "_id": { # Define the 10-minute interval bucket
                        "detid": "$detid", # Though detid is already matched, good to keep if grouping multiple sensors later
                        "year": "$year",
                        "month": "$month",
                        "day": "$day",
                        "hour": "$hour",
                        "minute_interval": {
                            "$subtract": [
                                "$minute",
                                {"$mod": ["$minute", 10]} # Calculates floor(minute / 10) * 10
                            ]
                        }
                    },
                    "average_speed": {"$avg": "$speed"},
                    # To get a representative timestamp for the interval (start of the interval)
                    # We'll reconstruct it in the next stage, or take the first original timestamp
                    "first_timestamp_in_interval": {"$min": "$timestamp"} 
                }
            },
            {
                "$project": {
                    "_id": 0, # Exclude the default _id
                    "timestamp": { # Reconstruct the timestamp for the start of the 10-min interval
                        "$dateFromParts": {
                            "year": "$_id.year",
                            "month": "$_id.month",
                            "day": "$_id.day",
                            "hour": "$_id.hour",
                            "minute": "$_id.minute_interval",
                            "second": 0,
                            "millisecond": 0
                            # "timezone": "UTC" # Optional: specify timezone if needed, default is UTC
                        }
                    },
                    # "timestamp": "$first_timestamp_in_interval", # Simpler alternative if $dateFromParts is complex/problematic
                    "speed": {"$round": ["$average_speed", 2]} # Round the average speed
                }
            },
            {
                "$sort": {"timestamp": ASCENDING}
            },
            {
                "$limit": 750 # Limit the number of 10-minute intervals. Max for a month is ~4320. Adjust as needed.
            }
        ]

        aggregated_results = list(traffic_collection.aggregate(pipeline))
        
        readings_data = []
        for doc in aggregated_results:
            readings_data.append(HistoricalSpeedPoint(timestamp=doc["timestamp"], speed=doc["speed"]))
        
        print(f"DEBUG: Found {len(readings_data)} aggregated 10-min intervals for sensor {detid_val} in hardcoded range.")
            
        return SensorHistoryResponse(detid=detid_val, readings=readings_data)

    except Exception as e:
        print(f"Error aggregating historical data for sensor {detid_val}: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"An error occurred while aggregating historical data: {str(e)}")

# --- NEW ENDPOINT FOR ROUTE TRAFFIC ANALYSIS ---
@app.post("/api/route_traffic_analysis", response_model=RouteTrafficAnalysisResponse)
async def get_route_traffic_analysis(request: RouteAnalysisRequest):
    traffic_collection = db_resource.get("collection")
    if traffic_collection is None:
        raise HTTPException(status_code=503, detail="Traffic collection not available.")

    try:
        # 1. Decode the polyline
        # The polyline library decodes to (lat, lon) tuples
        decoded_route_points_lat_lon = polyline.decode(request.overview_polyline)
        if not decoded_route_points_lat_lon:
            raise HTTPException(status_code=400, detail="Invalid or empty polyline provided.")

        # Convert to (lon, lat) for MongoDB GeoJSON queries
        decoded_route_points_lon_lat = [(lon, lat) for lat, lon in decoded_route_points_lat_lon]

        # 2. Find sensors near the route
        # To avoid too many queries, we can sample points along the route
        # Or, for simplicity, query for sensors near a few key points (e.g., every Nth point)
        # Let's sample up to 10 points along the route for sensor searching
        sample_points = []
        if len(decoded_route_points_lon_lat) <= 10:
            sample_points = decoded_route_points_lon_lat
        else:
            step = len(decoded_route_points_lon_lat) // 10
            for i in range(0, len(decoded_route_points_lon_lat), step):
                sample_points.append(decoded_route_points_lon_lat[i])
            if len(decoded_route_points_lon_lat) -1 not in range(0, len(decoded_route_points_lon_lat), step): # ensure last point is included
                 sample_points.append(decoded_route_points_lon_lat[-1])


        nearby_sensor_detids = set() # Use a set to store unique detids
        all_congestion_ratios = []
        sensors_with_speed_data = 0

        # Define search radius (e.g., 100 meters)
        # MongoDB $nearSphere requires distance in radians if using legacy coordinates,
        # or meters if using GeoJSON. Assuming GeoJSON 'Point' for sensor locations.
        # Earth's radius in meters: 6371000
        # search_radius_meters = 150 # Search within 150 meters of route points

        for point_lon, point_lat in sample_points:
            # Find distinct sensors near this point
            # Using an aggregation pipeline to get the latest reading for each sensor near the point
            pipeline = [
                {
                    "$geoNear": {
                        "near": {"type": "Point", "coordinates": [point_lon, point_lat]},
                        "distanceField": "dist.calculated",
                        "maxDistance": 75, # TRY REDUCING THIS (e.g., from 150 to 75 or 100)
                        "spherical": True,
                        "key": "location"
                    }
                },
                {"$sort": {"timestamp": -1}}, 
                {"$group": { 
                    "_id": "$detid",
                    "latest_doc": {"$first": "$$ROOT"}
                }},
                {"$replaceRoot": {"newRoot": "$latest_doc"}},
                {"$limit": 5} 
            ]
            cursor = traffic_collection.aggregate(pipeline, allowDiskUse=True)
            for sensor_doc in cursor:
                detid = sensor_doc.get("detid")
                if detid:
                    nearby_sensor_detids.add(detid)

        if not nearby_sensor_detids:
            return RouteTrafficAnalysisResponse(condition="Unknown - No sensors found near route", sensors_considered=0)

        latest_sensor_data_pipeline = [
            {"$match": {"detid": {"$in": list(nearby_sensor_detids)}}},
            {"$sort": {"timestamp": -1}},
            {"$group": {
                "_id": "$detid",
                "latest_doc": {"$first": "$$ROOT"}
            }},
            {"$replaceRoot": {"newRoot": "$latest_doc"}}
        ]
        # And ensure this one ALSO has allowDiskUse=True
        final_sensor_docs = list(traffic_collection.aggregate(latest_sensor_data_pipeline, allowDiskUse=True)) 

        for sensor_doc in final_sensor_docs:
            current_speed = sensor_doc.get("speed")
            speed_limit = sensor_doc.get("speed_limit")

            if current_speed is not None and speed_limit is not None and speed_limit > 0:
                ratio = current_speed / speed_limit
                all_congestion_ratios.append(ratio)
                sensors_with_speed_data += 1
        
        if not all_congestion_ratios:
            return RouteTrafficAnalysisResponse(
                condition="Unknown - No speed data from sensors near route",
                sensors_considered=len(nearby_sensor_detids),
                sensors_with_data=0
            )

        # 4. Calculate overall traffic condition
        average_ratio = sum(all_congestion_ratios) / len(all_congestion_ratios)
        
        condition = "Unknown"
        if average_ratio >= 0.8: # Example thresholds
            condition = "Light"
        elif average_ratio >= 0.5:
            condition = "Moderate"
        else:
            condition = "Heavy"

        return RouteTrafficAnalysisResponse(
            condition=condition,
            average_congestion_ratio=round(average_ratio, 3),
            sensors_considered=len(nearby_sensor_detids),
            sensors_with_data=sensors_with_speed_data
        )

    except HTTPException:
        raise
    except Exception as e:
        print(f"Error in route traffic analysis: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Internal server error during route analysis: {str(e)}")

# ... rest of your main.py ...
