import React, { useState, useEffect, useCallback } from 'react';
import { GoogleMap, LoadScript, Marker, Autocomplete, DirectionsRenderer, InfoWindow, HeatmapLayer } from '@react-google-maps/api'; // Added HeatmapLayer
import axios from 'axios';
import './App.css'; // You can add some basic styling

// Imports for Chart.js
import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  TimeScale, // Import TimeScale for time-based x-axis
} from 'chart.js';
import 'chartjs-adapter-date-fns'; // Adapter for date/time formatting

// Register Chart.js components
ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  TimeScale // Register TimeScale
);


const GOOGLE_MAPS_API_KEY = process.env.REACT_APP_GOOGLE_MAPS_API_KEY // !!! REPLACE THIS !!!
const API_BASE_URL = "http://localhost:8000"; // Your FastAPI backend URL

const mapContainerStyle = {
  width: '100vw',
  height: '100vh',
};

// Initial center for Manchester, UK
const initialCenter = {
  lat: 53.4808,
  lng: -2.2426,
};

function App() {
  const [map, setMap] = useState(null);
  const [sensors, setSensors] = useState([]);
  const [selectedSensor, setSelectedSensor] = useState(null);
  const [predictionData, setPredictionData] = useState(null);
  const [historicalData, setHistoricalData] = useState(null);
  const [isLoadingHistorical, setIsLoadingHistorical] = useState(false);
  const [showHistoricalChart, setShowHistoricalChart] = useState(false); // New state
  const [showNoSensorsMessage, setShowNoSensorsMessage] = useState(false);

  // New state for directions
  const [origin, setOrigin] = useState('');
  const [destination, setDestination] = useState('');
  const [directionsResponse, setDirectionsResponse] = useState(null);
  const [travelTime, setTravelTime] = useState('');
  const [distance, setDistance] = useState('');
  const [selectedTimeOffset, setSelectedTimeOffset] = useState(0);
  const [routeTrafficCondition, setRouteTrafficCondition] = useState(null); // New state

  // Refs for Autocomplete inputs
  const originRef = React.useRef();
  const destinationRef = React.useRef();

  const onMapLoad = useCallback((mapInstance) => {
    setMap(mapInstance);
  }, []);

  const fetchSensorsInView = useCallback(async () => {
    if (!map) return;
    setShowNoSensorsMessage(false); // Clear message at the start of a fetch

    const bounds = map.getBounds();
    if (!bounds) return;

    const ne = bounds.getNorthEast();
    const sw = bounds.getSouthWest();

    console.log("Requesting sensors for bounds:", { // Log the bounds being sent
      min_lat: sw.lat(), max_lat: ne.lat(),
      min_lon: sw.lng(), max_lon: ne.lng()
    });

    try {
      const response = await axios.get(`${API_BASE_URL}/api/sensors_in_view`, {
        params: {
          min_lon: sw.lng(),
          min_lat: sw.lat(),
          max_lon: ne.lng(),
          max_lat: ne.lat(),
        },
      });
      console.log(`Received ${response.data.length} sensors from backend:`, response.data); // Log received data
      setSensors(response.data);
      if (response.data.length === 0) {
        setShowNoSensorsMessage(true); // Show message if no sensors are found
      }
    } catch (error) {
      console.error("Error fetching sensors:", error);
      setSensors([]); // Clear sensors on error
      setShowNoSensorsMessage(true); // Also show message on error, as no sensors are available
    }
  }, [map]);

  // Fetch sensors when map is idle (after move/zoom)
  const onMapIdle = useCallback(() => {
    fetchSensorsInView();
  }, [fetchSensorsInView]);
  
  // Fetch initial sensors once map is loaded
  useEffect(() => {
    if (map) {
        fetchSensorsInView();
    }
  }, [map, fetchSensorsInView]);


  async function calculateRoute() {
    let originValue = '';
    if (originRef.current) {
        const place = originRef.current.getPlace();
        if (place && place.formatted_address) {
            originValue = place.formatted_address;
        } else {
            // Fallback to raw input if no place selected from autocomplete
            const originInput = document.querySelector('input[placeholder="Origin"]');
            if (originInput) originValue = originInput.value;
        }
    }

    let destinationValue = '';
    if (destinationRef.current) {
        const place = destinationRef.current.getPlace();
        if (place && place.formatted_address) {
            destinationValue = place.formatted_address;
        } else {
            // Fallback to raw input
            const destinationInput = document.querySelector('input[placeholder="Destination"]');
            if (destinationInput) destinationValue = destinationInput.value;
        }
    }

    setOrigin(originValue); // Update state with the value being used
    setDestination(destinationValue); // Update state with the value being used

    if (!originValue || !destinationValue) {
      alert("Please enter both origin and destination.");
      return;
    }

    if (!window.google || !window.google.maps || !window.google.maps.DirectionsService) {
        console.error("Google Maps DirectionsService not loaded yet.");
        alert("Map services are still loading, please try again shortly.");
        return;
    }

    const directionsService = new window.google.maps.DirectionsService();
    try {
      const results = await directionsService.route({
        origin: originValue, // Use the derived originValue
        destination: destinationValue, // Use the derived destinationValue
        travelMode: window.google.maps.TravelMode.DRIVING,
      });
      setDirectionsResponse(results);
      if (results.routes && results.routes.length > 0) {
        const route = results.routes[0];
        if (route.legs && route.legs.length > 0) {
          setTravelTime(route.legs[0].duration.text);
          setDistance(route.legs[0].distance.text);
        }
      }
    } catch (error) {
      console.error("Error calculating directions:", error);
      alert("Failed to calculate directions. Please check the console.");
      setDirectionsResponse(null);
      setTravelTime('');
      setDistance('');
    }
  }

  function clearRoute() {
    setDirectionsResponse(null);
    setTravelTime('');
    setDistance('');
    // Clear input fields if needed, though Autocomplete might handle this
    const originInput = document.querySelector('input[placeholder="Origin"]');
    const destinationInput = document.querySelector('input[placeholder="Destination"]');
    if (originInput) originInput.value = '';
    if (destinationInput) destinationInput.value = '';
    setOrigin('');
    setDestination('');
  }

  const handleMarkerClick = async (sensor) => {
    setSelectedSensor(sensor);
    setPredictionData(null); // Clear previous prediction
    
    // Reset historical data and chart visibility
    setHistoricalData(null);
    setShowHistoricalChart(false);
    setIsLoadingHistorical(false); // Ensure loading is reset

    // Fetch prediction
    try {
      const predictionResponse = await axios.get(`${API_BASE_URL}/api/sensor_prediction/${sensor.detid}`);
      setPredictionData(predictionResponse.data);
    } catch (error) {
      console.error("Error fetching prediction:", error);
      setPredictionData(null);
    }

    // Fetch historical data
    try {
      const historyResponse = await axios.get(`${API_BASE_URL}/api/sensor_history/${sensor.detid}`, {
        params: { hours: 24 } 
      });
      console.log("Raw historical data from backend:", historyResponse.data); // Keep this for debugging
      // Ensure historyResponse.data and historyResponse.data.readings exist before setting
      if (historyResponse.data && historyResponse.data.readings) {
        setHistoricalData(historyResponse.data.readings); // CORRECTED: Extract the 'readings' array
      } else {
        console.error("Historical data readings are missing in the response:", historyResponse.data);
        setHistoricalData([]); // Set to empty if readings are not found
      }
    } catch (error) {
      console.error("Error fetching historical data:", error);
      setHistoricalData([]); 
    } finally {
      setIsLoadingHistorical(false);
    }
  };

  // New function to fetch and show historical data
  const fetchAndShowHistoricalData = async (sensorId) => {
    if (!sensorId) return;

    setIsLoadingHistorical(true);
    setHistoricalData(null); 
    // setShowHistoricalChart(true); // We'll set this after data is attempted to be fetched or on success

    try {
      const historyResponse = await axios.get(`${API_BASE_URL}/api/sensor_history/${sensorId}`);
      if (historyResponse.data && historyResponse.data.readings) {
        setHistoricalData(historyResponse.data.readings);
        setShowHistoricalChart(true); // Show modal only if data fetch was initiated
      } else {
        console.error("Historical data readings are missing in the response:", historyResponse.data);
        setHistoricalData([]); 
        setShowHistoricalChart(true); // Still show modal to display error/no data message
      }
    } catch (error) {
      console.error("Error fetching historical data:", error);
      setHistoricalData([]); 
      setShowHistoricalChart(true); // Still show modal to display error message
    } finally {
      setIsLoadingHistorical(false);
    }
  };

  // Helper to determine marker color based on speed (example)
  const getMarkerColor = (speed, speedLimit) => {
    if (speed === null || speed === undefined || speedLimit === null || speedLimit === undefined) return 'grey'; // Default for no data
    const ratio = speed / speedLimit;
    if (ratio < 0.5) return 'red';    // Heavy congestion
    if (ratio < 0.8) return 'orange'; // Moderate
    return 'green';  // Free flow
  };

  // Directions handling
  const handleDirections = async () => {
    if (!origin || !destination) {
        alert("Please select both origin and destination.");
        return;
    }

    if (!window.google || !window.google.maps || !window.google.maps.DirectionsService) {
        console.error("Google Maps DirectionsService not loaded yet.");
        alert("Map services are still loading, please try again shortly.");
        return;
    }

    setRouteTrafficCondition(null); // Clear previous condition

    try {
      const directionsService = new window.google.maps.DirectionsService();
      
      const drivingOptions = {};
      if (selectedTimeOffset > 0) {
        const departureTime = new Date();
        departureTime.setHours(departureTime.getHours() + selectedTimeOffset);
        drivingOptions.departureTime = departureTime;
        // You can choose a traffic model:
        // BEST_GUESS: (default if departureTime is set) uses historical and real-time traffic.
        // OPTIMISTIC: Assumes light traffic.
        // PESSIMISTIC: Assumes heavy traffic.
        drivingOptions.trafficModel = window.google.maps.TrafficModel.BEST_GUESS; 
      }

      const request = {
        origin,
        destination,
        travelMode: window.google.maps.TravelMode.DRIVING,
      };

      if (Object.keys(drivingOptions).length > 0) {
        request.drivingOptions = drivingOptions;
      }

      const result = await directionsService.route(request);
      setDirectionsResponse(result);

      if (result.routes && result.routes.length > 0 && result.routes[0].legs && result.routes[0].legs.length > 0) {
        const route = result.routes[0]; // Get the first route
        const leg = route.legs[0];
        setDistance(leg.distance.text);
        // If departureTime was set, durationInTraffic might be available and more relevant
        if (leg.duration_in_traffic) {
          setTravelTime(`${leg.duration_in_traffic.text} (with traffic)`);
        } else {
          setTravelTime(leg.duration.text);
        }

        // ---- NEW: Call backend for traffic analysis ----
        if (route.overview_polyline) {
          try {
            setRouteTrafficCondition({ condition: "Analyzing route traffic...", average_congestion_ratio: null, sensors_considered:0, sensors_with_data:0 }); // Set loading state
            const analysisResponse = await axios.post(`${API_BASE_URL}/api/route_traffic_analysis`, {
              overview_polyline: route.overview_polyline
            });
            setRouteTrafficCondition(analysisResponse.data);
          } catch (analysisError) {
            console.error("Error fetching route traffic analysis:", analysisError);
            setRouteTrafficCondition({ condition: "Error analyzing traffic", average_congestion_ratio: null, sensors_considered:0, sensors_with_data:0 });
          }
        }
        // ---- END NEW ----

      } else {
        setTravelTime('');
        setDistance('');
        setRouteTrafficCondition(null); // Clear on no routes
        alert("No routes found.");
      }
    } catch (error) {
      console.error("Error fetching directions:", error);
      setDirectionsResponse(null);
      setTravelTime('');
      setDistance('');
      setRouteTrafficCondition(null); // Clear on error
      if (error.code === window.google.maps.DirectionsStatus.ZERO_RESULTS) {
        alert("No route could be found between the origin and destination.");
      } else if (error.code === window.google.maps.DirectionsStatus.NOT_FOUND || error.code === window.google.maps.DirectionsStatus.INVALID_REQUEST) {
        alert("Could not geocode origin or destination. Please check your inputs.");
      }
      else {
        alert("Failed to fetch directions. Please try again.");
      }
    }
  };

  // Prepare data for the historical chart
  const historicalChartData = historicalData && historicalData.length > 0 ? {
    labels: historicalData.map(d => new Date(d.timestamp)), // Use Date objects for TimeScale
    datasets: [
      {
        label: 'Historical Speed',
        data: historicalData.map(d => d.speed),
        borderColor: 'rgb(75, 192, 192)',
        tension: 0.1,
        fill: false,
      },
    ],
  } : null;

  const historicalChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      x: {
        type: 'time', // Use 'time' scale
        time: {
          unit: 'hour', // Display units in hours
          tooltipFormat: 'MMM d, yyyy HH:mm', // Format for tooltips
          displayFormats: {
             hour: 'HH:mm' // Format for x-axis labels
          }
        },
        title: {
          display: true,
          text: 'Time',
        },
      },
      y: {
        title: {
          display: true,
          text: 'Speed (units)',
        },
        beginAtZero: true,
      },
    },
    plugins: {
      legend: {
        position: 'top',
      },
      title: {
        display: true,
        text: 'Sensor Speed Over Time',
      },
    },
  };


  return (
    <LoadScript googleMapsApiKey={GOOGLE_MAPS_API_KEY} libraries={["places", "visualization"]}>
      <div style={{ display: 'flex', height: '100vh', flexDirection: 'column' }}>
        <div style={{ padding: '10px', background: '#f0f0f0', zIndex: 1, display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
          <Autocomplete
            onLoad={(autocomplete) => (originRef.current = autocomplete)}
            onPlaceChanged={() => {
              if (originRef.current) {
                const place = originRef.current.getPlace();
                if (place && place.formatted_address) {
                  setOrigin(place.formatted_address);
                } else {
                  // Optionally handle cases where no valid place is selected
                  // For example, you might want to use the raw input value
                  // or clear the origin state if the input is invalid.
                  // For now, we'll just avoid setting it if invalid.
                  console.log("Origin: No valid place selected from Autocomplete.");
                }
              }
            }}
          >
            <input type="text" placeholder="Origin" style={{ padding: '8px', width: '200px' }}/>
          </Autocomplete>
          <Autocomplete
            onLoad={(autocomplete) => (destinationRef.current = autocomplete)}
            onPlaceChanged={() => {
              if (destinationRef.current) {
                const place = destinationRef.current.getPlace();
                if (place && place.formatted_address) {
                  setDestination(place.formatted_address);
                } else {
                  console.log("Destination: No valid place selected from Autocomplete.");
                }
              }
            }}
          >
            <input type="text" placeholder="Destination" style={{ padding: '8px', width: '200px' }}/>
          </Autocomplete>
          
          {/* New Dropdown for Departure Time */}
          <select 
            value={selectedTimeOffset} 
            onChange={(e) => setSelectedTimeOffset(parseInt(e.target.value))}
            style={{ padding: '8px', marginLeft: '10px' }}
          >
            <option value="0">Depart Now</option>
            <option value="1">In 1 hour</option>
            <option value="2">In 2 hours</option>
            <option value="3">In 3 hours</option>
            <option value="4">In 4 hours</option>
            <option value="5">In 5 hours</option>
            <option value="6">In 6 hours</option>
            <option value="7">In 7 hours</option>
            <option value="8">In 8 hours</option>
          </select>

          <button onClick={handleDirections} style={{ padding: '8px 15px' }}>Get Directions</button>
          {travelTime && <p style={{ margin: 0 }}>Travel Time: {travelTime}</p>}
          {distance && <p style={{ margin: 0 }}>Distance: {distance}</p>}
          {/* ---- NEW: Display Route Traffic Condition ---- */}
          {routeTrafficCondition && (
            <p style={{ 
                margin: 0, 
                color: routeTrafficCondition.condition === "Heavy" ? "red" : 
                       routeTrafficCondition.condition === "Moderate" ? "orange" :
                       routeTrafficCondition.condition.startsWith("Unknown") || routeTrafficCondition.condition.startsWith("Error") ? "grey" :
                       "green",
                fontWeight: 'bold'
            }}>
              Route Traffic: {routeTrafficCondition.condition}
              {routeTrafficCondition.average_congestion_ratio !== null && ` (Avg. Ratio: ${routeTrafficCondition.average_congestion_ratio.toFixed(2)}, Sensors: ${routeTrafficCondition.sensors_with_data}/${routeTrafficCondition.sensors_considered})`}
            </p>
          )} 
          {/* ---- E=ND NEW ---- */}
          <button onClick={() => {
            setDirectionsResponse(null); 
            // ... (existing origin/destination clearing) ...
            setTravelTime(''); 
            setDistance('');
            setRouteTrafficCondition(null); // ---- NEW: Clear traffic condition ----
          }} style={{ padding: '8px 15px', marginLeft: '10px' }}>Clear Route</button>
        </div>

        <div style={{ flexGrow: 1, position: 'relative' }}> {/* Map container */}
          <GoogleMap
            mapContainerStyle={{ width: '100%', height: '100%' }}
            center={initialCenter}
            zoom={14} // Adjusted for wider view
            onLoad={onMapLoad} // new comment test
            onIdle={onMapIdle}
            options={{ streetViewControl: false, mapTypeControl: false }}
          >
            {sensors.map((sensor) => (
              <Marker
                key={sensor.detid}
                position={{ lat: sensor.lat, lng: sensor.lon }}
                onClick={() => handleMarkerClick(sensor)}
                icon={{
                  path: window.google.maps.SymbolPath.CIRCLE,
                  fillColor: getMarkerColor(sensor.current_speed, sensor.speed_limit),
                  fillOpacity: 0.9,
                  scale: 7,
                  strokeColor: 'white',
                  strokeWeight: 1,
                }}
                title={`DetID: ${sensor.detid}\nSpeed: ${sensor.current_speed || 'N/A'}`}
              />
            ))}

            {/* Display the route */}
            {directionsResponse && (
              <DirectionsRenderer directions={directionsResponse} />
            )}

            {/* Heatmap Layer - Feature 2 */}
            {sensors.length > 0 && window.google && window.google.maps && window.google.maps.visualization && (
              <HeatmapLayer
                data={sensors.map(sensor => ({
                  location: new window.google.maps.LatLng(sensor.lat, sensor.lon),
                  weight: sensor.speed_limit && sensor.current_speed !== null && sensor.current_speed !== undefined ? 
                          Math.max(0.1, (sensor.speed_limit - sensor.current_speed) / sensor.speed_limit * 5 + 0.1) // Example weight: higher for more congestion
                          : 0.5 // Default weight if data is missing
                }))}
                options={{
                  radius: 20, // Adjust radius as needed
                  opacity: 0.6,
                }}
              />
            )}
          </GoogleMap>

          {/* "No Sensors Found" Message Overlay */}
          {showNoSensorsMessage && sensors.length === 0 && (
            <div style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              backgroundColor: 'rgba(0, 0, 0, 0.7)',
              color: 'white',
              padding: '15px 25px',
              borderRadius: '8px',
              zIndex: 10,
              textAlign: 'center'
            }}>
              <p style={{ margin: 0 }}>No sensors found in this area.</p>
            </div>
          )}

          {/* Info Panel for selected sensor (Chart is REMOVED from here) */}
          {selectedSensor && !showHistoricalChart && ( // Hide info panel if chart modal is shown for simplicity
            <div className="info-panel">
              <h3>Sensor: {selectedSensor.detid}</h3>
              <p>Road: {selectedSensor.road_name || 'N/A'}</p>
              <p>Current Speed: {selectedSensor.current_speed !== null && selectedSensor.current_speed !== undefined ? `${selectedSensor.current_speed} units` : 'N/A'}</p>
              <p>Speed Limit: {selectedSensor.speed_limit !== null && selectedSensor.speed_limit !== undefined ? `${selectedSensor.speed_limit} units` : 'N/A'}</p>
              
              {predictionData && predictionData.detid === selectedSensor.detid ? (
                <div>
                  <h4>Prediction:</h4>
                  <p>Predicted Speed: {predictionData.predicted_speed_for_next_interval} units</p>
                  {/* MODIFIED LINE BELOW */}
                  <p>Prediction for: Next 15-min period</p> 
                </div>
              ) : predictionData === null && selectedSensor ? ( 
                 <p>Loading prediction...</p>
              ): null}

              {/* Button to show historical chart MODAL */}
              {!isLoadingHistorical && ( // Simpler condition, button always available if panel is open
                <button 
                  onClick={() => fetchAndShowHistoricalData(selectedSensor.detid)} 
                  style={{ marginTop: '10px' }}
                >
                  Show Historical Speed Chart
                </button>
              )}
              {isLoadingHistorical && <p>Loading chart data...</p> } 
              
              <button 
                 onClick={() => {
                     setSelectedSensor(null); 
                     setPredictionData(null); 
                     setHistoricalData(null); 
                     setShowHistoricalChart(false); // Ensure modal state is reset
                 }} 
                 style={{marginTop: '15px'}}
             >
                 Close Panel
             </button>
            </div>
          )}

          {/* Historical Chart Modal */}
          {showHistoricalChart && selectedSensor && (
            <div className="chart-modal-overlay">
              <div className="chart-modal-content">
                <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
                   <h3>Historical Speed: {selectedSensor.detid}</h3>
                   <button 
                       onClick={() => {
                           setShowHistoricalChart(false);
                           setHistoricalData(null); // Clear data when closing modal
                       }} 
                       className="chart-modal-close-button"
                   >
                       &times; {/* Close icon */}
                   </button>
                </div>
                
                <div className="historical-chart-container" style={{borderTop: '1px solid #eee', paddingTop: '10px', marginTop: '10px'}}>
                  {isLoadingHistorical && <p>Loading historical data...</p>}
                  
                  {!isLoadingHistorical && historicalData && historicalData.length > 0 && historicalChartData && (
                    <div style={{ height: '400px', width: '100%' }}> {/* Larger chart area */}
                      <Line options={{...historicalChartOptions, maintainAspectRatio: false}} data={historicalChartData} />
                    </div>
                  )}

                  {!isLoadingHistorical && historicalData && historicalData.length === 0 && (
                    <p>No historical data available for this period.</p>
                  )}

                  {!isLoadingHistorical && historicalData === null && ( 
                    <p>Could not load historical data.</p>
                  )}
                </div>
              </div>
            </div>
          )}

        </div>
      </div>
    </LoadScript>
  );
}
export default App;
